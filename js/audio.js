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
    const gain = 0.25 / Math.sqrt(Math.max(1, e.midis.length));
    for (const m of e.midis) tone(ac, m, t0 + (s - offset) * secPerQ, len * secPerQ * 0.95, gain);
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

// Toca uma nota (ou acorde) curta, ao tocar no teclado virtual.
export function previewNote(midi) {
  const ac = audioContext();
  const list = Array.isArray(midi) ? midi : [midi];
  for (const m of list) tone(ac, m, ac.currentTime + 0.01, 0.35, 0.25 / Math.sqrt(list.length));
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

export const canCaptureTab = () => !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function getMicStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
}

// Som de uma aba do navegador (ex.: um vídeo do YouTube). O Chrome pede para escolher a aba
// e marcar "Compartilhar áudio". Retorna um stream só com o áudio.
export async function getTabStream() {
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    systemAudio: 'include',
  });
  const audio = display.getAudioTracks();
  if (!audio.length) {
    display.getTracks().forEach((t) => t.stop());
    throw new Error('sem-audio');
  }
  const stream = new MediaStream(audio);
  stream.release = () => display.getTracks().forEach((t) => t.stop());
  return stream;
}

// Analisa um stream ao vivo (altura a cada ~20 ms) e, opcionalmente, grava o áudio para a IA.
export function listen(stream, onFrame, { silence = 0.01, record = false, onEnded } = {}) {
  const ac = audioContext();
  const source = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    onFrame(ac.currentTime * 1000, analyzeFrame(buf, ac.sampleRate, { silence }));
  }, 20);
  let recorder = null;
  const chunks = [];
  const startMs = ac.currentTime * 1000;
  if (record) {
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(1000);
  }
  stream.getAudioTracks()[0]?.addEventListener('ended', () => onEnded?.());
  return {
    startMs,
    // Para tudo; se estava gravando, devolve o áudio gravado (Blob).
    stop() {
      clearInterval(timer);
      source.disconnect();
      const done = new Promise((resolve) => {
        if (!recorder || recorder.state === 'inactive') return resolve(chunks.length ? new Blob(chunks) : null);
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
        recorder.stop();
      });
      return done.finally(() => {
        stream.getTracks().forEach((t) => t.stop());
        stream.release?.();
      });
    },
  };
}

export async function decodeAudio(blob) {
  return audioContext().decodeAudioData(await blob.arrayBuffer());
}

// Analisa um áudio inteiro (melodia), chamando onFrame para cada quadro de 20 ms.
export async function analyzeBuffer(audio, onFrame, { silence = 0.01, onProgress } = {}) {
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
