// Reprodução da partitura, metrônomo e captura do microfone.

import { playbackEvents } from './score.js';
import { analyzeFrame, midiToFreq } from './pitch.js';

let ctx = null;
export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(ac, midi, start, len, gainValue = 0.25) {
  const osc = ac.createOscillator();
  const osc2 = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'triangle';
  osc2.type = 'sine';
  osc.frequency.value = midiToFreq(midi);
  osc2.frequency.value = midiToFreq(midi) * 2;
  const g2 = ac.createGain();
  g2.gain.value = 0.25;
  osc.connect(g);
  osc2.connect(g2).connect(g);
  g.connect(ac.destination);
  const end = start + Math.max(0.06, len);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gainValue, start + 0.015);
  g.gain.exponentialRampToValueAtTime(gainValue * 0.6, start + 0.15);
  g.gain.setValueAtTime(gainValue * 0.6, Math.max(start + 0.15, end - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.start(start);
  osc2.start(start);
  osc.stop(end + 0.02);
  osc2.stop(end + 0.02);
}

export function click(ac, time, accent = false) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  osc.connect(g).connect(ac.destination);
  osc.start(time);
  osc.stop(time + 0.06);
}

// Toca a partitura a partir da nota "from". onNote(src|null) é chamado para destacar a nota atual.
export function playScore(score, { from = 0, onNote, onEnd } = {}) {
  const ac = audioContext();
  const { events } = playbackEvents(score);
  const secPerQ = 60 / score.tempo;
  const startEv = events.find((e) => e.srcs.some((s) => s.src >= from));
  if (!startEv) {
    onEnd?.();
    return { stop() {} };
  }
  const offset = startEv.srcs.find((s) => s.src >= from).start;
  const t0 = ac.currentTime + 0.1;
  const timers = [];
  let endPos = offset;
  for (const e of events) {
    if (e.start + e.len <= offset) continue;
    const s = Math.max(e.start, offset);
    const len = e.start + e.len - s;
    if (e.midi !== null) tone(ac, e.midi, t0 + (s - offset) * secPerQ, len * secPerQ * 0.95);
    for (const sp of e.srcs) {
      if (sp.start < offset) continue;
      timers.push(setTimeout(() => onNote?.(sp.src), (t0 - ac.currentTime + (sp.start - offset) * secPerQ) * 1000));
    }
    endPos = Math.max(endPos, e.start + e.len);
  }
  timers.push(
    setTimeout(() => {
      onNote?.(null);
      onEnd?.();
    }, (t0 - ac.currentTime + (endPos - offset) * secPerQ) * 1000 + 100),
  );
  return {
    stop() {
      timers.forEach(clearTimeout);
      onNote?.(null);
      // Silencia rapidamente recriando o contexto
      ctx.close();
      ctx = null;
    },
  };
}

// Toca uma nota curta (ao tocar no teclado virtual).
export function previewNote(midi) {
  const ac = audioContext();
  tone(ac, midi, ac.currentTime + 0.01, 0.35);
}

// Metrônomo contínuo. Retorna o horário (ms, relógio do AudioContext) do primeiro tempo após a contagem.
export function startMetronome(beatsPerBar, tempo, countInBars = 1, beatUnitQ = 1) {
  const ac = audioContext();
  const interval = (60 / tempo) * beatUnitQ;
  const first = ac.currentTime + 0.2;
  let next = first;
  let beat = 0;
  const timer = setInterval(() => {
    while (next < ac.currentTime + 0.3) {
      click(ac, next, beat % beatsPerBar === 0);
      next += interval;
      beat++;
    }
  }, 50);
  return {
    downbeatMs: (first + countInBars * beatsPerBar * interval) * 1000,
    stop: () => clearInterval(timer),
  };
}

// Captura do microfone com análise de altura a cada ~20 ms.
export async function startMic(onFrame, { silence = 0.01 } = {}) {
  const ac = audioContext();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const source = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const opts = { silence };
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    const t = ac.currentTime * 1000;
    onFrame(t, analyzeFrame(buf, ac.sampleRate, opts));
  }, 20);
  return {
    setSilence(v) {
      opts.silence = v;
    },
    stop() {
      clearInterval(timer);
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

// Analisa um arquivo de áudio inteiro, chamando onFrame para cada quadro de 20 ms.
export async function analyzeFile(file, onFrame, { silence = 0.01, onProgress } = {}) {
  const ac = audioContext();
  const data = await file.arrayBuffer();
  const audio = await ac.decodeAudioData(data);
  const sr = audio.sampleRate;
  const ch = audio.getChannelData(0);
  let mono = ch;
  if (audio.numberOfChannels > 1) {
    const other = audio.getChannelData(1);
    mono = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) mono[i] = (ch[i] + other[i]) / 2;
  }
  const win = 2048;
  const hop = Math.round(sr * 0.02);
  const total = Math.max(0, mono.length - win);
  for (let i = 0, k = 0; i < total; i += hop, k++) {
    const frame = mono.subarray(i, i + win);
    onFrame(((i + win / 2) / sr) * 1000, analyzeFrame(frame, sr, { silence }));
    if (k % 100 === 0) {
      onProgress?.(i / total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(1);
  return (mono.length / sr) * 1000;
}
