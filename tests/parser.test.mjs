// Speaker detection of the .txt/.md/.docx parser - run with: node --test tests/parser.test.mjs
// Parsers.txt is read from index.html itself, so the tests always exercise the shipped code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/\n {2}txt\(text\) \{.*?\n {2}\},\n/s);
assert.ok(m, 'Parsers.txt not found in index.html');
const ctx = vm.createContext({});
vm.runInContext(`const Parsers = {${m[0]}}; this.txt = t => Parsers.txt(t);`, ctx);

// Plain objects: arrays from the vm context have another prototype
const parse = text => JSON.parse(JSON.stringify(ctx.txt(text).segments))
  .map(s => ({ speaker: s.speaker, interviewer: s.isInterviewer, text: s.text }));
const allText = text => parse(text).map(s => s.text).join(' ');

// ── A colon alone must not create a speaker: the words stay in the text ──
test('bullet with a colon stays text', () => {
  const segs = parse('Notes\n* Tiktokable songs: could be from every genre\n* Dance trends: mostly short loops');
  assert.deepEqual(segs.map(s => s.speaker), ['', '', '']);
  assert.match(allText('* Tiktokable songs: could be from every genre'), /Tiktokable songs: could be from every genre/);
});
for (const line of [
  '- Pros: cheap and fast',
  '• Budget : 300 €',
  '1. Contexte : rachat en 2019',
  '2) Suite : à voir',
  'a) Note : relancer Marie',
  '> Citation : « on verra »',
  '# Thème : le travail',
  'Remarque : à revoir avec l’équipe.',
  'Bon, en gros : ça dépend.',
  'Réunion à 14:30 avec la direction.',
  'Paris - Lyon, ça fait trois heures.',
]) {
  test(`one-off label stays text: ${JSON.stringify(line)}`, () => {
    const segs = parse(line);
    assert.deepEqual(segs.map(s => s.speaker), ['']);
    assert.equal(segs[0].text, line);
  });
}

// ── Real transcripts keep their speakers ──
test('I / P transcript', () => {
  const segs = parse('I : Bonjour.\nP : Bonjour, merci.\nI : Vous travaillez où ?\nP : À Lyon.\n* Remarque : depuis 2019.');
  assert.deepEqual(segs.map(s => s.speaker), ['I', 'P', 'I', 'P']);
  assert.equal(segs[3].text, 'À Lyon. * Remarque : depuis 2019.');
});
test('free names repeated, interviewer marked with (I)', () => {
  const segs = parse('Jérémie (I) : Bonjour.\nMarie Dupont : Bonjour.\nJérémie (I) : Et ensuite ?\nMarie Dupont : Ensuite, Lyon.');
  assert.deepEqual(segs.map(s => [s.speaker, s.interviewer]),
    [['Jérémie', true], ['Marie Dupont', false], ['Jérémie', true], ['Marie Dupont', false]]);
});
test('hyphenated speaker name', () => {
  const segs = parse('Jean-Pierre : Salut.\nClaire : Salut.\nJean-Pierre : Ça va ?\nClaire : Oui.');
  assert.deepEqual(segs.map(s => s.speaker), ['Jean-Pierre', 'Claire', 'Jean-Pierre', 'Claire']);
});
test('dash separator with repeated names', () => {
  const segs = parse('Marie — Bonjour.\nPaul — Bonjour.\nMarie — Ça va ?\nPaul - Oui.');
  assert.deepEqual(segs.map(s => s.speaker), ['Marie', 'Paul', 'Marie', 'Paul']);
});
test('role words count even when used once', () => {
  const segs = parse('Interviewer: Hello.\nParticipant: Hi.');
  assert.deepEqual(segs.map(s => s.speaker), ['Interviewer', 'Participant']);
  const fr = parse('Enquêtrice : Bonjour.\nEnquêté : Bonjour.');
  assert.deepEqual(fr.map(s => s.speaker), ['Enquêtrice', 'Enquêté']);
});
test('short codes count even when used once', () => {
  assert.deepEqual(parse('Q: Why?\nR: Because.').map(s => s.speaker), ['Q', 'R']);
  assert.deepEqual(parse('E1 : Oui.\nJP : Non.').map(s => s.speaker), ['E1', 'JP']);
});
test('mixed notes and transcript: bullets join the current turn', () => {
  const segs = parse('Entretien du 12/09\nI : Parlez-moi des outils.\nP : Surtout deux :\n* Slack: pour tout\n* Notion: pour les docs\nI : Merci.');
  assert.deepEqual(segs.map(s => s.speaker), ['', 'I', 'P', 'I']);
  assert.equal(segs[2].text, 'Surtout deux : * Slack: pour tout * Notion: pour les docs');
});
test('a free name used only once is kept as text (no words lost)', () => {
  const segs = parse('I : Bonjour.\nP : Bonjour.\nMarc : je passe juste.\nI : Reprenons.\nP : Oui.');
  assert.deepEqual(segs.map(s => s.speaker), ['I', 'P', 'I', 'P']);
  assert.equal(segs[1].text, 'Bonjour. Marc : je passe juste.');
});

// ── Other formats handled by the same parser are unchanged ──
test('Rescribe timestamped format', () => {
  const segs = parse('[0:25] Jérémie (I) :  Bonjour\n[0:31] Marie :  Salut');
  assert.deepEqual(segs.map(s => [s.speaker, s.interviewer, s.text]), [['Jérémie', true, 'Bonjour'], ['Marie', false, 'Salut']]);
});
test('bare inline timestamps', () => {
  const segs = parse('02:47 Vous publiez combien ? 02:50 Entre 40 et 50 par jour, selon les jours et les sujets.');
  assert.equal(segs.length, 2);
});
