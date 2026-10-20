import test from 'node:test';
import assert from 'node:assert/strict';
import { Transcriber, analyzeFrame, detectPitch, eventsToNotes, freqToMidi, midiToFreq } from '../js/pitch.js';

const SR = 44100;
function sine(freq, n = 2048, amp = 0.3) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    b[i] = amp * (Math.sin((2 * Math.PI * freq * i) / SR) + 0.4 * Math.sin((4 * Math.PI * freq * i) / SR));
  }
  return b;
}

test('YIN detecta frequências conhecidas', () => {
  for (const f of [82.41, 196, 261.63, 440, 880, 1318.5]) {
    const p = detectPitch(sine(f), SR);
    assert.ok(p, `sem altura para ${f}`);
    assert.ok(Math.abs(freqToMidi(p.freq) - freqToMidi(f)) < 0.1, `${f} -> ${p.freq}`);
  }
});

test('silêncio não gera nota', () => {
  const r = analyzeFrame(new Float32Array(2048), SR);
  assert.equal(r.midi, null);
});

// Simula uma melodia: lista de [midi|null, semínimas] a 120 BPM (500 ms por semínima)
function simulate(melody, { tempo = 120, gapMs = 30 } = {}) {
  const tr = new Transcriber({ tempo, gridTicks: 2, minRestTicks: 4 });
  let t = 1000;
  const msQ = 60000 / tempo;
  for (const [midi, q] of melody) {
    const end = t + q * msQ;
    for (; t < end; t += 20) {
      const sounding = midi !== null && t < end - gapMs;
      const f = sounding ? analyzeFrame(sine(midiToFreq(midi)), SR) : analyzeFrame(new Float32Array(2048), SR);
      tr.feed(t, f.midi, f.level);
    }
  }
  return tr.finish(t);
}

test('transcreve melodia simples com ritmo', () => {
  const ev = simulate([[60, 1], [62, 1], [64, 2], [null, 1], [67, 0.5], [65, 0.5], [64, 1]]);
  assert.deepEqual(ev.map((e) => e.midi), [60, 62, 64, null, 67, 65, 64]);
  assert.deepEqual(ev.slice(0, 6).map((e) => e.ticks), [8, 8, 16, 8, 4, 4]);
});

test('notas repetidas com articulação são separadas', () => {
  const ev = simulate([[69, 1], [69, 1], [69, 1]], { gapMs: 80 });
  assert.deepEqual(ev.map((e) => e.midi), [69, 69, 69]);
});

test('eventos viram notas, com ligaduras quando necessário', () => {
  const notes = eventsToNotes([{ midi: 60, ticks: 10 }, { midi: null, ticks: 8 }]);
  assert.deepEqual(notes.map((n) => [n.dur, n.tie, n.rest]), [['q', true, false], ['16', false, false], ['q', false, true]]);
});

import { polyToEvents } from '../js/poly.js';

test('polifonia: acordes, melodia e baixo', () => {
  // 120 BPM: semínima = 500 ms. Dó maior (2 tempos) e depois Sol maior (2 tempos), melodia por cima.
  const n = (start, dur, midi, amp = 0.5) => ({ start: 1000 + start, dur, midi, amp });
  const notes = [
    n(0, 990, 48), n(0, 990, 64), n(0, 990, 67), // acorde C (baixo + mi/sol)
    n(0, 480, 72), n(500, 480, 74), // melodia dó, ré
    n(1000, 990, 43), n(1000, 990, 62), n(1000, 990, 71), // acorde G
    n(1000, 980, 79),
  ];
  const all = polyToEvents(notes, { tempo: 120 });
  assert.deepEqual(all.map((e) => [e.midis.join(','), e.ticks]), [
    ['48,64,67,72', 8], ['48,64,67,74', 8], ['43,62,71,79', 16],
  ]);
  assert.equal(all[0].tie, true); // baixo e acorde continuam ligados

  const top = polyToEvents(notes, { tempo: 120, mode: 'top' });
  assert.deepEqual(top.map((e) => [e.midis[0], e.ticks]), [[72, 8], [74, 8], [79, 16]]);

  const bass = polyToEvents(notes, { tempo: 120, mode: 'bottom' });
  assert.deepEqual(bass.map((e) => [e.midis[0], e.ticks, e.tie]), [[48, 16, false], [43, 16, false]]);
});

test('eventos de acordes viram notas com acorde', () => {
  const notes = eventsToNotes([{ midis: [60, 64, 67], ticks: 8, tie: true }, { midis: [60, 64, 67], ticks: 8 }]);
  assert.deepEqual(notes.map((x) => [x.midi, x.chord, x.tie]), [[67, [60, 64], true], [67, [60, 64], false]]);
});
