// Privacy scan of the "For analysis" export - run with: node --test tests/scan.test.mjs
// The functions are read from index.html itself, so the tests always exercise the shipped code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const m = html.match(new RegExp(`\\n(?:async )?function ${name}\\(.*?\\n}\\n`, 's'));
  assert.ok(m, `function ${name} not found in index.html`);
  return m[0];
}
function extractConst(name) {
  const m = html.match(new RegExp(`\\nconst ${name} = .*?;\\n`, 's'));
  assert.ok(m, `const ${name} not found in index.html`);
  return m[0];
}

const CONSTS = ['SEP_RE', 'INVISIBLE_RE', 'APOS_RE', 'WORDCH_RE', 'LETTER_FOLD', 'overlaps', 'SCAN_TOKEN_RE', 'FORBIDDEN_KEYS', 'GENERIC_SPEAKERS'];
const FUNCS = ['normMap', 'normForm', 'findForms', 'charBefore', 'charAfter', 'bankTags', 'forbiddenValues', 'scanBundle', 'anonToBase', 'baseToAnon'];
const ctx = vm.createContext({ t: k => k });
vm.runInContext(
  [...CONSTS.map(extractConst), ...FUNCS.map(extractFunction)].join('\n')
  + '\nthis.api = { normMap, normForm, findForms, forbiddenValues, scanBundle, anonToBase, baseToAnon };',
  ctx,
);
const { findForms, forbiddenValues, scanBundle, anonToBase, baseToAnon } = ctx.api;

const BANK = {
  'Martine': { tag: '[PERS_1]', type: 'PERS' },
  "D'Angelo": { tag: '[PERS_2]', type: 'PERS' },
  'Jean-Rémi': { tag: '[PERS_3]', type: 'PERS' },
  'Paris': { tag: '[LIEU_1]', type: 'LIEU' },
  'Jean': { tag: '[PERS_4]', type: 'PERS' },
  'Marie': { tag: '[PERS_5]', type: 'PERS' },
  'Pers': { tag: '[PERS_6]', type: 'PERS' },
};
const SPEAKERS = [{ id: 'sp_1', role: 'interviewer', label: 'Enquêteur' }, { id: 'sp_2', role: 'interviewee', label: 'Lucienne Morel' }];

// Minimal bundle around one segment text, scanned exactly as the export does
function scan(text, { kept = [], extra = {} } = {}) {
  const bundle = {
    format: 'corpus-bundle', schemaVersion: '1.0',
    project: { id: 'p', name: 'Projet' },
    documents: [{ id: 'd', title: 'Entretien 01', speakers: [], segments: [{ id: 'seg_0001', text }], ...extra }],
  };
  const forbidden = forbiddenValues(BANK, [{ speakers: SPEAKERS }]);
  return scanBundle(bundle, forbidden, [[kept]]);
}
// Arrays from the vm context have another prototype: copy them before deep comparisons
const found = text => [...scan(text).leaks].map(l => l.found);

// ── Leaks that must block the export ──
const MUST_BLOCK = [
  ['plain', 'Bonjour Martine.', 'Martine'],
  ['upper case', 'Bonjour MARTINE.', 'MARTINE'],
  ['no accent', 'Merci jean-remi.', 'jean-remi'],
  ['zero-width space inside', 'Bonjour Mar\u200Btine.', 'Mar\u200Btine'],
  ['zero-width joiner inside', 'Bonjour Mar\u200Dtine.', 'Mar\u200Dtine'],
  ['word joiner inside', 'Bonjour Mar\u2060tine.', 'Mar\u2060tine'],
  ['soft hyphen inside', 'Bonjour Mar\u00ADtine.', 'Mar\u00ADtine'],
  ['BOM before', 'Bonjour \uFEFFMartine.', 'Martine'],
  ['typographic apostrophe \u2019', 'Avec D\u2019Angelo.', 'D\u2019Angelo'],
  ['opening quote \u2018 as apostrophe', 'Avec D\u2018Angelo.', 'D\u2018Angelo'],
  ['modifier letter apostrophe \u02BC', 'Avec D\u02BCangelo.', 'D\u02BCangelo'],
  ['prime \u2032 as apostrophe', 'Avec D\u2032Angelo.', 'D\u2032Angelo'],
  ['non-breaking hyphen \u2011', 'Merci Jean\u2011Rémi.', 'Jean\u2011Rémi'],
  ['hyphen \u2010 U+2010', 'Merci Jean\u2010Rémi.', 'Jean\u2010Rémi'],
  ['en dash \u2013', 'Merci Jean\u2013Rémi.', 'Jean\u2013Rémi'],
  ['em dash \u2014', 'Merci Jean\u2014Rémi.', 'Jean\u2014Rémi'],
  ['minus sign \u2212', 'Merci Jean\u2212Rémi.', 'Jean\u2212Rémi'],
  ['fullwidth hyphen \uFF0D', 'Merci Jean\uFF0DRémi.', 'Jean\uFF0DRémi'],
  ['space instead of hyphen', 'Merci Jean Rémi.', 'Jean Rémi'],
  ['non-breaking space', 'Merci Jean\u00A0Rémi.', 'Jean\u00A0Rémi'],
  ['name next to an em dash', 'De Paris\u2014Lyon en train.', 'Paris'],
  ['speaker name in text', 'Merci Lucienne Morel.', 'Lucienne Morel'],
];
for (const [label, text, expected] of MUST_BLOCK) {
  test(`blocks: ${label}`, () => {
    assert.ok(found(text).includes(expected), `expected "${expected}" to be detected in ${JSON.stringify(text)}, got ${JSON.stringify(found(text))}`);
  });
}

// ── Must NOT be flagged (false positives would make the export unusable) ──
const MUST_PASS = [
  ['longer first name', 'Bonjour Jeanne.'],
  ['compound first name', 'Bonjour Jean-Pierre.'],
  ['compound with non-breaking hyphen', 'Bonjour Jean\u2011Pierre.'],
  ['name inside a longer word', 'La Mariette est fermée.'],
  ['soft hyphen inside a longer word', 'La Marie\u00ADtte est fermée.'],
  ['bank value inside a tag', 'Bonjour [PERS_1] et [PERS_6].'],
  ['generic speaker label', 'L\u2019enquêteur pose une question.'],
];
for (const [label, text] of MUST_PASS) {
  test(`passes: ${label}`, () => {
    assert.deepEqual(found(text), [], `false positive in ${JSON.stringify(text)}`);
  });
}

// ── Offsets point at the real characters, invisible ones included ──
test('offsets cover invisible characters inside the match', () => {
  const text = 'Bonjour Mar\u200Btine !';
  const [m] = findForms(text, 'Martine');
  assert.equal(text.slice(m.s, m.e), 'Mar\u200Btine');
  assert.equal(m.exact, false);
});

// ── Deliberately kept occurrences ──
test('kept occurrence asks for confirmation instead of leaking', () => {
  const text = 'Bonjour Martine.';
  const r = scan(text, { kept: [{ s: 8, e: 15, ack: false }] });
  assert.equal(r.leaks.length, 0);
  assert.equal(r.keptHits.length, 1);
});
test('confirmed kept occurrence is allowed', () => {
  const r = scan('Bonjour Martine.', { kept: [{ s: 8, e: 15, ack: true }] });
  assert.equal(r.leaks.length + r.keptHits.length, 0);
});
test('confirmed kept occurrence is reported for the audit trail', () => {
  const r = scan('Bonjour Martine.', { kept: [{ s: 8, e: 15, ack: true }] });
  assert.equal(r.acked.length, 1);
});
test('a leak carries its position in the exported text', () => {
  const [l] = scan('Merci [PERS_1], et Martine aussi.').leaks;
  assert.deepEqual([l.s, l.e, l.found], [19, 26, 'Martine']);
});

// ── "Export anyway": a position in the anonymized text maps back to the original text ──
test('anonymized offset maps back to the original text', () => {
  const seg = { base: 'Avec Paul Durand et Martine à Lyon.', spans: [{ s: 5, e: 16, tag: '[PERS_2]' }, { s: 30, e: 34, tag: '[LIEU_1]' }] };
  // anonText: "Avec [PERS_2] et Martine à [LIEU_1]."
  const a = 'Avec [PERS_2] et '.length;
  const s = anonToBase(seg, a), e = anonToBase(seg, a + 'Martine'.length);
  assert.equal(seg.base.slice(s, e), 'Martine');
  assert.equal(baseToAnon(seg, s), a);
});

// ── Fields outside the segment text are scanned too ──
test('real name in another field blocks', () => {
  const r = scan('Rien ici.', { extra: { meta: { studyTitle: 'Suivi de Martine' } } });
  assert.deepEqual([...r.leaks].map(l => l.path), ['documents[0].meta.studyTitle']);
});

// ── Internal fields must never reach the bundle ──
test('forbidden internal keys are reported', () => {
  const r = scan('Rien ici.', { extra: { entityBank: {}, ext: { x: { fileName: 'a.mp3' } } } });
  assert.deepEqual([...r.badKeys].sort(), ['documents[0].entityBank', 'documents[0].ext.x.fileName']);
});

// ── Name variants (findForms): every variant must be found, and never as an exact match ──
const hits = (form, text) => [...findForms(text, form)].map(m => ({ found: text.slice(m.s, m.e), exact: m.exact }));
const VARIANTS = [
  ['Jean-Pierre', 'Jean Pierre'],
  ['Jean-Pierre', 'Jean\u2011Pierre'],
  ['Jean-Pierre', 'Jean\u2014Pierre'],
  ['Jean-Pierre', 'Jean\u00ADPierre'],
  ['Jean-Pierre', 'Jean\u2212Pierre'],
  ['Jean-Pierre', 'Jeanpierre'],
  ['Dupont', 'Dup\u200Bont'],
  ['Dupont', 'Dupont\u200B'],
  ['Dupont', 'Dup\u00ADont'],
  ['Dupont', 'D\u200Cupont'],
  ['Dupont', 'DUPONT'],
  ['Dupont', 'Dupónt'],
  ["O'Brien", 'O\u2019Brien'],
  ["O'Brien", 'O\u02BCBrien'],
  ['O\u2019Brien', "O'Brien"],
  ['Marie Curie', 'Marie\u00A0Curie'],
  ['Marie Curie', 'Marie\u202FCurie'],
  ['Strasse', 'Straße'],
  ['Straße', 'STRASSE'],
  ['Oeuvre', 'œuvre'],
  ['Æsa', 'Aesa'],
  ['Fifi', 'ﬁfi'],
  ['Martine', 'Ｍａｒｔｉｎｅ'],
  ['Éloïse', 'E\u0301loi\u0308se'],
  ['E\u0301loi\u0308se', 'Éloïse'],
  ['Søren', 'Soren'],
  ['Łukasz', 'Lukasz'],
  ['Đokic', 'Dokic'],
];
for (const [form, variant] of VARIANTS) {
  test(`variant found: ${form} / ${JSON.stringify(variant)}`, () => {
    const text = `Avant ${variant}, après.`;
    assert.deepEqual(hits(form, text), [{ found: variant, exact: false }]);
  });
}
test('identical spelling stays an exact match', () => {
  assert.deepEqual(hits('Jean-Pierre', 'Avec Jean-Pierre.'), [{ found: 'Jean-Pierre', exact: true }]);
  assert.deepEqual(hits('Éloïse', 'Avec Éloïse.'), [{ found: 'Éloïse', exact: true }]);
});
const NOT_VARIANTS = [
  ['Dupont', 'Dupontel'],
  ['Marie', 'Mariette'],
  ['Jean-Pierre', 'Jean Pierrette'],
  ['Le Roy', 'Le Royaume'],
  ['Straße', 'Strasbourg'],
];
for (const [form, text] of NOT_VARIANTS) {
  test(`not a variant: ${form} in ${JSON.stringify(text)}`, () => {
    assert.deepEqual(hits(form, `Avant ${text}, après.`), []);
  });
}
