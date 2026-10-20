import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScore, decompose, layoutMeasures, makeNote, noteName, playbackEvents, spell, vexKey, diatonicStep,
} from '../js/score.js';
import { toMidi, toMusicXML } from '../js/export.js';

test('decompose quebra durações em figuras', () => {
  assert.deepEqual(decompose(8), [{ dur: 'q', dots: 0 }]);
  assert.deepEqual(decompose(12), [{ dur: 'q', dots: 1 }]);
  assert.deepEqual(decompose(10), [{ dur: 'q', dots: 0 }, { dur: '16', dots: 0 }]);
  assert.deepEqual(decompose(20), [{ dur: 'h', dots: 0 }, { dur: '8', dots: 0 }]);
});

test('grafia segue a tonalidade', () => {
  assert.equal(vexKey(66, 'G'), 'f#/4');
  assert.equal(vexKey(70, 'F'), 'bb/4');
  assert.equal(vexKey(61, 'C'), 'c#/4');
  assert.equal(vexKey(61, 'Eb'), 'db/4');
  assert.equal(vexKey(61, 'C', 'flat'), 'db/4');
  assert.equal(vexKey(65, 'F#'), 'e#/4');
  assert.equal(vexKey(71, 'Cb'), 'cb/5');
  assert.equal(noteName(60), 'Dó4');
  assert.deepEqual(spell(72, 'C'), { letter: 'c', alter: 0, octave: 5 });
});

test('passo diatônico respeita a escala', () => {
  assert.equal(diatonicStep(64, 'C', 1), 65); // Mi -> Fá
  assert.equal(diatonicStep(64, 'G', 1), 66); // Mi -> Fá#
  assert.equal(diatonicStep(60, 'C', -1), 59);
});

test('notas que passam da barra viram ligaduras', () => {
  const s = createScore();
  s.timeSig = { num: 3, den: 4 };
  s.notes = [makeNote(60, 'h'), makeNote(62, 'h')];
  const m = layoutMeasures(s);
  assert.equal(m.length, 2);
  assert.deepEqual(m[0].map((p) => [p.dur, p.tie]), [['h', false], ['q', true]]);
  assert.deepEqual(m[1].map((p) => [p.dur, p.tie, p.src]), [['q', false, 1]]);
});

test('reprodução une notas ligadas', () => {
  const s = createScore();
  const a = makeNote(60, 'q');
  a.tie = true;
  s.notes = [a, makeNote(60, '8'), makeNote(62, '8', 0, true)];
  const { events, total } = playbackEvents(s);
  assert.equal(events.length, 2);
  assert.equal(events[0].len, 1.5);
  assert.deepEqual(events[1].midis, []);
  assert.equal(total, 2);
});

test('exporta MusicXML e MIDI', () => {
  const s = createScore();
  s.keySig = 'D';
  s.notes = [makeNote(66, 'w', 1), makeNote(61, 'q')];
  const xml = toMusicXML(s);
  assert.match(xml, /<fifths>2<\/fifths>/);
  assert.match(xml, /<tie type="start"\/>/);
  assert.match(xml, /<tie type="stop"\/>/);
  assert.equal((xml.match(/<measure /g) || []).length, 2);
  const mid = toMidi(s);
  assert.equal(String.fromCharCode(...mid.slice(0, 4)), 'MThd');
});

test('MusicXML em pauta dupla separa as notas pelo Dó central', () => {
  const s = createScore();
  s.clef = 'grand';
  const n = makeNote(72, 'h', 0, false, [48, 64]);
  n.tie = true;
  s.notes = [n, makeNote(72, 'h', 0, false, [48, 64])];
  const xml = toMusicXML(s);
  assert.match(xml, /<staves>2<\/staves>/);
  assert.match(xml, /<backup><duration>32<\/duration><\/backup>/);
  assert.equal((xml.match(/<staff>2<\/staff>/g) || []).length, 2);
  assert.equal((xml.match(/<tie type="start"\/>/g) || []).length, 3);
});
