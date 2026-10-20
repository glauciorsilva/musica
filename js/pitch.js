// Detecção de altura (algoritmo YIN) e transcrição de sons monofônicos em notas.
// Não depende do DOM, para poder ser testado no Node.

import { decompose, makeNote } from './score.js';

export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

// Retorna { freq, clarity } ou null se não houver altura definida.
export function detectPitch(buf, sampleRate, { minFreq = 60, maxFreq = 1500, threshold = 0.15 } = {}) {
  const half = Math.floor(buf.length / 2);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(half, Math.ceil(sampleRate / minFreq));
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // Diferença normalizada cumulativa
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    d[tau] = running ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 < tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return null;
  // Interpolação parabólica para precisão sub-amostra
  let better = tau;
  if (tau > 1 && tau < tauMax) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    if (den) better = tau + (a - c) / (2 * den);
  }
  return { freq: sampleRate / better, clarity: 1 - d[tau] };
}

export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Analisa um quadro de áudio e devolve { midi (arredondado ou null), exact, freq, level }.
export function analyzeFrame(buf, sampleRate, { silence = 0.01, minFreq, maxFreq } = {}) {
  const level = rms(buf);
  if (level < silence) return { midi: null, exact: null, freq: null, level };
  const p = detectPitch(buf, sampleRate, { minFreq, maxFreq });
  if (!p) return { midi: null, exact: null, freq: null, level };
  const exact = freqToMidi(p.freq);
  return { midi: Math.round(exact), exact, freq: p.freq, level };
}

// Recebe quadros (tempo em ms, nota MIDI ou null, nível) e produz notas quantizadas
// na grade rítmica de acordo com o andamento.
export class Transcriber {
  constructor({ tempo = 90, gridTicks = 2, origin = null, minRestTicks = 2, stableFrames = 3, silenceFrames = 4 } = {}) {
    this.msPerTick = 60000 / tempo / 8;
    this.gridTicks = gridTicks;
    this.origin = origin; // se definido (metrônomo), o silêncio inicial vira pausa
    this.minRestTicks = minRestTicks;
    this.stableFrames = stableFrames;
    this.silenceFrames = silenceFrames;
    this.current = null; // MIDI soando ou null
    this.candidate = undefined;
    this.candStart = 0;
    this.candCount = 0;
    this.levels = [];
    this.lastOnsetTime = -Infinity;
    this.prev = null; // último evento ainda aberto { qt, midi }
    this.done = []; // { midi|null, ticks }
    this.lastTime = 0;
  }

  quantize(t) {
    const ticks = (t - this.origin) / this.msPerTick;
    return Math.max(0, Math.round(ticks / this.gridTicks) * this.gridTicks);
  }

  feed(t, midi, level) {
    this.lastTime = t;
    if (this.origin !== null && t < this.origin) return;

    // Nova articulação da mesma nota (ataque súbito de volume)
    const minRecent = this.levels.length ? Math.min(...this.levels) : level;
    this.levels.push(level);
    if (this.levels.length > 6) this.levels.shift();
    if (
      midi !== null &&
      midi === this.current &&
      level > minRecent * 2.5 &&
      t - this.lastOnsetTime > 150
    ) {
      this.emit(t, midi);
    }

    if (midi === this.candidate) {
      this.candCount++;
    } else {
      this.candidate = midi;
      this.candStart = t;
      this.candCount = 1;
    }
    const need = midi === null ? this.silenceFrames : this.stableFrames;
    if (this.candidate !== this.current && this.candCount >= need) {
      this.current = this.candidate;
      this.emit(this.candStart, this.candidate);
    }
  }

  emit(t, midi) {
    if (midi !== null) this.lastOnsetTime = t;
    if (this.origin === null) {
      if (midi === null) return; // ignora silêncio antes da primeira nota
      this.origin = t;
    }
    const qt = this.quantize(t);
    if (!this.prev) {
      if (qt > 0) this.done.push({ midi: null, ticks: qt });
      this.prev = { qt, midi };
      return;
    }
    const dur = qt - this.prev.qt;
    if (dur <= 0) {
      // Curto demais para a grade: o novo evento toma o lugar do anterior
      this.prev.midi = midi;
      return;
    }
    this.close(dur);
    this.prev = { qt, midi };
  }

  close(dur) {
    const p = this.prev;
    const last = this.done[this.done.length - 1];
    if (p.midi === null && dur < this.minRestTicks && last && last.midi !== null) {
      last.ticks += dur; // pausa muito curta: estende a nota anterior
    } else if (last && last.midi === null && p.midi === null) {
      last.ticks += dur;
    } else {
      this.done.push({ midi: p.midi, ticks: dur });
    }
  }

  // Lista de eventos, incluindo (opcionalmente) o que ainda está soando até o instante "now".
  events(now = this.lastTime, includeOpen = true) {
    const list = this.done.map((e) => ({ ...e }));
    if (includeOpen && this.prev && this.prev.midi !== null) {
      const dur = Math.max(this.gridTicks, this.quantize(now) - this.prev.qt);
      list.push({ midi: this.prev.midi, ticks: dur });
    }
    return list;
  }

  finish(t = this.lastTime) {
    if (this.prev) {
      const dur = this.quantize(t) - this.prev.qt;
      if (this.prev.midi !== null) this.done.push({ midi: this.prev.midi, ticks: Math.max(this.gridTicks, dur) });
      this.prev = null;
    }
    // remove pausas no final
    while (this.done.length && this.done[this.done.length - 1].midi === null) this.done.pop();
    return this.done;
  }
}

// Converte eventos { midi, ticks } em notas da partitura (figuras longas viram notas ligadas).
export function eventsToNotes(events) {
  const notes = [];
  for (const e of events) {
    const parts = decompose(e.ticks);
    parts.forEach((p, i) => {
      const n = makeNote(e.midi ?? 71, p.dur, p.dots, e.midi === null);
      n.tie = e.midi !== null && i < parts.length - 1;
      notes.push(n);
    });
  }
  return notes;
}
