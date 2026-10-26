// Spreadsheet import/export helpers - run with: node --test tests/table.test.mjs
// The functions are read from index.html itself, so the tests always exercise the shipped code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const fn = name => {
  const m = html.match(new RegExp(`\\n(?:async )?function ${name}\\(.*?\\n}\\n`, 's'));
  assert.ok(m, `function ${name} not found in index.html`);
  return m[0];
};
const cst = name => {
  const m = html.match(new RegExp(`\\nconst ${name} = .*?;\\n`, 's'));
  assert.ok(m, `const ${name} not found in index.html`);
  return m[0];
};
const NAMES = { columnLabel: 'Colonne', colName_number: 'N°', colName_time: 'Temps', colName_code: 'Code', colName_quote: 'Citation', colName_section: 'Section' };
const ctx = vm.createContext({ t: k => NAMES[k] || k, TextDecoder });
vm.runInContext([
  cst('segId'), cst('SPEAKER_COL_RE'), cst('TEXT_COL_RE'), cst('DATA_CELL_RE'),
  cst('CORPUS_ROLES'),
  ...['decodeText', 'detectDelimiter', 'parseCsv', 'toCsv', 'sheetToGrid', 'guessColumnRoles', 'tableToParsed',
    'uniqueSheetName', 'assignWorkbookSpeakerLabels', 'bankTags', 'anonSpeakers'].map(fn),
  'this.api = { decodeText, detectDelimiter, parseCsv, toCsv, sheetToGrid, guessColumnRoles, tableToParsed, uniqueSheetName, assignWorkbookSpeakerLabels, anonSpeakers };',
].join('\n'), ctx);
const api = ctx.api;
// Plain values: objects from the vm context have another prototype
const plain = v => JSON.parse(JSON.stringify(v));

// ── CSV ──
test('parses quotes, escaped quotes, delimiters and newlines inside fields', () => {
  const csv = 'Participant;Citation;Thème\r\nMarie;"Je dis ""oui""; puis\nje pars.";Travail\r\nPaul;Court;Loisirs';
  assert.deepEqual(plain(api.parseCsv(csv, ';')), [
    ['Participant', 'Citation', 'Thème'],
    ['Marie', 'Je dis "oui"; puis\nje pars.', 'Travail'],
    ['Paul', 'Court', 'Loisirs'],
  ]);
});
test('detects the delimiter', () => {
  assert.equal(api.detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(api.detectDelimiter('a;b;c\n"1,5";2;3'), ';');
  assert.equal(api.detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
});
test('decodes UTF-8 (with BOM) and falls back to Windows-1252', () => {
  const utf8 = new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode('Thème;Été')]);
  assert.equal(api.decodeText(utf8.buffer), 'Thème;Été');
  const cp1252 = new Uint8Array([0x54, 0x68, 0xE8, 0x6D, 0x65]); // "Thème" in Windows-1252
  assert.equal(api.decodeText(cp1252.buffer), 'Thème');
});
test('CSV round trip keeps every value', () => {
  const rows = [['A', 'B'], ['x;y', 'il a dit "non"'], ['ligne\nsuivante', '']];
  assert.deepEqual(plain(api.parseCsv(api.toCsv(rows, ';'), ';')), rows);
});

// ── Grid and column roles ──
test('grid skips leading/empty rows and names missing headers', () => {
  const g = plain(api.sheetToGrid([[], ['', ''], ['Citation', '', 'Page'], ['Bonjour', '', '3'], ['', '', ''], ['Salut']]));
  assert.deepEqual(g.headers, ['Citation', 'Colonne 2', 'Page']);
  assert.deepEqual(g.body, [['Bonjour', '', '3'], ['Salut', '', '']]);
});
test('guesses column roles', () => {
  const headers = ['Participant', 'Citation', 'Thème', 'Vide', 'Notes longues'];
  const long = 'Une phrase assez longue pour ressembler à une citation libre.';
  const body = [['Marie', 'Oui.', 'Travail', '', long], ['Paul', 'Non.', 'Loisirs', '', long]];
  assert.deepEqual(plain(api.guessColumnRoles(headers, body)), ['speaker', 'text', 'keep', 'skip', 'text']);
});
test('falls back to the longest column when no text column is recognised', () => {
  assert.deepEqual(plain(api.guessColumnRoles(['A', 'B'], [['x', 'un peu plus long'], ['y', 'encore']])), ['keep', 'text']);
});

// ── Rows to segments ──
test('one text cell = one segment, with the row speaker; other columns kept on the row', () => {
  const grid = { headers: ['Participant', 'Citation', 'Thème', 'Ignoré'], body: [['Marie', 'Je viens de Lyon.', 'Travail', 'x'], ['Paul', '', 'Loisirs', 'y']] };
  const p = plain(api.tableToParsed(grid, ['speaker', 'text', 'keep', 'skip']));
  assert.deepEqual(p.segments.map(s => [s.id, s.speaker, s.text]), [['seg_0001', 'Marie', 'Je viens de Lyon.']]);
  assert.deepEqual(p.table.columns.map(c => [c.key, c.name, c.role]), [['c0', 'Participant', 'speaker'], ['c1', 'Citation', 'text'], ['c2', 'Thème', 'keep']]);
  assert.deepEqual(p.table.rows, [
    { id: 'row_0001', segs: { c1: 'seg_0001' }, values: { c2: 'Travail' }, speaker: 'Marie' },
    { id: 'row_0002', segs: {}, values: { c2: 'Loisirs' }, speaker: 'Paul' },
  ]);
  assert.equal(p.idsStable, true);
});

// ── Workbooks: one participant = one tag across every sheet ──
test('participants are numbered across the whole workbook', () => {
  const sheet1 = [{ id: 'spk_1', role: 'interviewee', label: 'Martine Leroy' }, { id: 'spk_2', role: 'interviewee', label: 'Paul Durand' }];
  const sheet2 = [{ id: 'spk_1', role: 'interviewee', label: 'Claire Martin' }, { id: 'spk_2', role: 'interviewee', label: 'Martine Leroy' }];
  const counter = {};
  api.assignWorkbookSpeakerLabels(sheet1, counter);
  api.assignWorkbookSpeakerLabels(sheet2, counter);
  assert.deepEqual([...sheet1, ...sheet2].map(s => s.label + '=' + s.anonLabel),
    ['Martine Leroy=[ENQ·E_1]', 'Paul Durand=[ENQ·E_2]', 'Claire Martin=[ENQ·E_3]', 'Martine Leroy=[ENQ·E_1]']);
});
test('speaker label: entity bank first, then the workbook label', () => {
  const d = { speakers: [{ id: 'spk_1', role: 'interviewee', label: 'Martine Leroy', anonLabel: '[ENQ·E_4]' },
                         { id: 'spk_2', role: 'interviewee', label: 'Paul Durand', anonLabel: '[ENQ·E_5]' }], segments: [], anonymized: [] };
  const labels = plain(api.anonSpeakers(d, { 'Paul Durand': { tag: '[PERS_2]' } })).map(s => s.label);
  assert.deepEqual(labels, ['[ENQ·E_4]', '[PERS_2]']);
});
test('sheet names: forbidden characters removed, 31 chars max, duplicates numbered', () => {
  const used = new Set();
  const names = ['Citations: 2024/25', 'Citations: 2024/25', 'Un titre de feuille vraiment beaucoup trop long pour Excel', ''].map(n => api.uniqueSheetName(n, used));
  assert.deepEqual(names, ['Citations  2024 25', 'Citations  2024 25 (2)', 'Un titre de feuille vraiment be', 'Feuille']);
  assert.ok(names.every(n => n.length <= 31));
});

// ── Coding tables: title/theme rows, no header row ──
test('coding table without header: theme rows become a Section column, names guessed from content', () => {
  const g = plain(api.sheetToGrid([
    ['Transparence et intelligibilité de l’algorithme'],
    ['1', '1:30:48', '+', 'C’est juste tellement compliqué (...) alors non'],
    ['2', '1:32:10', '-', 'Je ne comprends pas comment le classement se fait, honnêtement.'],
    ['Confiance dans la plateforme'],
    ['3', '0:12:05', '+', 'Moi je leur fais confiance, ils ont l’air sérieux et transparents.'],
  ]));
  assert.deepEqual(g.headers, ['N°', 'Temps', 'Code', 'Citation', 'Section']);
  assert.deepEqual(g.body.map(r => [r[0], r[4]]), [
    ['1', 'Transparence et intelligibilité de l’algorithme'],
    ['2', 'Transparence et intelligibilité de l’algorithme'],
    ['3', 'Confiance dans la plateforme'],
  ]);
});
test('a real header row is still used, and a title above it is dropped', () => {
  const g = plain(api.sheetToGrid([['Grille de codage — vague 2'], ['N°', 'Temps', 'Citation'], ['1', '0:10', 'Une citation assez longue pour être du texte libre.']]));
  assert.deepEqual(g.headers, ['N°', 'Temps', 'Citation']);
  assert.equal(g.body.length, 1);
});
test('a row with only the quote filled stays a data row', () => {
  const g = plain(api.sheetToGrid([['Participant', 'Citation'], ['Marie', 'Bonjour à tous.'], ['', 'Une citation sans participant.']]));
  assert.deepEqual(g.body, [['Marie', 'Bonjour à tous.'], ['', 'Une citation sans participant.']]);
});
test('a single-cell row in a text first column is not a section', () => {
  const g = plain(api.sheetToGrid([['Citation', 'Page'], ['Bonjour', '3'], ['Salut']]));
  assert.deepEqual(g.headers, ['Citation', 'Page']);
  assert.deepEqual(g.body, [['Bonjour', '3'], ['Salut', '']]);
});

test('theme columns (generated Section, repeated labels) are kept as is, not anonymized', () => {
  const long = n => `Une citation suffisamment longue pour ressembler à du texte libre, numéro ${n}.`;
  const body = [1, 2, 3, 4].map(n => [String(n), long(n), n < 3 ? 'Transparence et intelligibilité de l’algorithme' : 'Confiance dans la plateforme de streaming']);
  assert.deepEqual(plain(api.guessColumnRoles(['N°', 'Citation', 'Thème long'], body)), ['keep', 'text', 'keep']);
  assert.deepEqual(plain(api.guessColumnRoles(['N°', 'Citation', 'Section'], body.slice(0, 2))), ['keep', 'text', 'keep']);
});
