// Transcrição polifônica (várias notas ao mesmo tempo) com o modelo Basic Pitch, do Spotify.
// O modelo (~1,6 MB) só é baixado na primeira vez que for usado.

const BUNDLE_URL = new URL('../vendor/basic-pitch/basic-pitch.js', import.meta.url).href;
const MODEL_URL = new URL('../vendor/basic-pitch/model.json', import.meta.url).href;
const SAMPLE_RATE = 22050;

let loading = null;
function load() {
  if (!loading) {
    loading = (async () => {
      const lib = await import(BUNDLE_URL);
      await lib.tf.ready();
      const bp = new lib.BasicPitch(MODEL_URL);
      await bp.model; // carrega os pesos fora do escopo de limpeza de memória
      return { lib, bp };
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

// O modelo espera áudio mono a 22050 Hz.
async function toModelRate(audioBuffer) {
  const length = Math.ceil(audioBuffer.duration * SAMPLE_RATE);
  const off = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

// Retorna as notas detectadas: { start (ms), dur (ms), midi, amp }.
export async function detectNotesPoly(audioBuffer, onProgress = () => {}) {
  onProgress(0, 'Carregando o modelo de IA…');
  const { lib, bp } = await load();
  const data = await toModelRate(audioBuffer);
  const frames = [];
  const onsets = [];
  const contours = [];
  lib.tf.engine().startScope();
  try {
    await bp.evaluateModel(
      data,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      (p) => onProgress(p, 'Reconhecendo as notas…'),
    );
  } finally {
    lib.tf.engine().endScope();
  }
  const notes = lib.noteFramesToTime(
    lib.addPitchBendsToNoteEvents(contours, lib.outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)),
  );
  return notes.map((n) => ({
    start: n.startTimeSeconds * 1000,
    dur: n.durationSeconds * 1000,
    midi: n.pitchMidi,
    amp: n.amplitude,
  }));
}

// Instrumentos e voz geram harmônicos (oitava, oitava + quinta…) que o modelo às vezes
// reconhece como notas. Remove notas fracas que coincidem com um harmônico de uma nota mais forte.
const HARMONICS = [12, 19, 24, 28, 31];
export function removeHarmonics(notes) {
  return notes.filter((n) => !notes.some((o) => {
    if (o === n || !HARMONICS.includes(n.midi - o.midi) || n.amp >= o.amp * 0.6) return false;
    const overlap = Math.min(n.start + n.dur, o.start + o.dur) - Math.max(n.start, o.start);
    return overlap > n.dur * 0.5;
  }));
}

// Transforma notas soltas no tempo em eventos quantizados na grade rítmica.
// mode: 'all' (acordes), 'top' (só a nota mais aguda = melodia), 'bottom' (só a mais grave = baixo).
// Retorna [{ midis: [...], ticks, tie }], onde midis vazio é pausa.
export function polyToEvents(notes, {
  tempo = 90, gridTicks = 2, mode = 'all', maxVoices = 4, minDurMs = 100, origin = null, minRestTicks = 1,
} = {}) {
  const msPerTick = 60000 / tempo / 8;
  let list = removeHarmonics(notes.filter((n) => n.dur >= minDurMs));
  if (origin !== null) list = list.filter((n) => n.start + n.dur > origin);
  if (!list.length) return [];
  const org = origin ?? Math.min(...list.map((n) => n.start));
  const q = (t) => Math.max(0, Math.round((t - org) / msPerTick / gridTicks) * gridTicks);
  list = list.map((n) => {
    const s = q(n.start);
    let e = q(n.start + n.dur);
    if (e <= s) e = s + gridTicks;
    return { ...n, s, e };
  });
  // Ataques quase simultâneos (ex.: o baixo entrando um pouco antes do acorde) vão para o
  // ponto onde começa a maior parte das notas.
  const weight = new Map();
  for (const n of list) weight.set(n.s, (weight.get(n.s) || 0) + n.amp);
  for (const n of list) {
    const len = n.e - n.s;
    for (const t of [n.s - gridTicks, n.s + gridTicks]) {
      if (t >= 0 && (weight.get(t) || 0) > 1.5 * weight.get(n.s)) {
        n.s = t;
        n.e = Math.max(t + gridTicks, n.s + len);
        break;
      }
    }
  }
  // Finais de nota perto de um ataque são alinhados a ele (legato)
  const onsetTimes = [...new Set(list.map((n) => n.s))].sort((x, y) => x - y);
  for (const n of list) {
    const near = onsetTimes.filter((t) => t > n.s && t >= n.e - gridTicks && t <= n.e + Math.max(4, gridTicks));
    if (near.length) n.e = near.reduce((x, y) => (Math.abs(y - n.e) < Math.abs(x - n.e) ? y : x));
  }
  if (mode === 'bottom') {
    // Baixo: só as notas da metade grave
    const sorted = list.map((n) => n.midi).sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)];
    list = list.filter((n) => n.midi < median);
  }

  const bounds = [...new Set([0, ...list.flatMap((n) => [n.s, n.e])])].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    // Notas soando neste trecho (uma por altura, a mais forte)
    const byPitch = new Map();
    for (const n of list) {
      if (n.s <= a && n.e > a) {
        const cur = byPitch.get(n.midi);
        if (!cur || n.s === a || n.amp > cur.amp) byPitch.set(n.midi, n);
      }
    }
    let chosen = [...byPitch.values()];
    if (mode === 'top' && chosen.length) chosen = [chosen.reduce((x, y) => (y.midi > x.midi ? y : x))];
    else if (mode === 'bottom' && chosen.length) chosen = [chosen.reduce((x, y) => (y.midi < x.midi ? y : x))];
    else chosen = chosen.sort((x, y) => y.amp - x.amp).slice(0, maxVoices);
    segs.push({
      midis: chosen.map((n) => n.midi).sort((x, y) => x - y),
      onsets: new Set(chosen.filter((n) => n.s === a).map((n) => n.midi)),
      ticks: b - a,
    });
  }

  const out = [];
  for (const seg of segs) {
    const prev = out[out.length - 1];
    if (!prev) {
      if (seg.midis.length || origin !== null) out.push({ midis: seg.midis, ticks: seg.ticks, tie: false });
      continue;
    }
    const same = prev.midis.join() === seg.midis.join();
    if (!seg.midis.length && seg.ticks < minRestTicks && prev.midis.length) {
      prev.ticks += seg.ticks; // pausa curta: estende a nota anterior
    } else if (same && (!seg.midis.length || !seg.midis.some((m) => seg.onsets.has(m)))) {
      prev.ticks += seg.ticks;
    } else {
      prev.tie = seg.midis.some((m) => prev.midis.includes(m) && !seg.onsets.has(m));
      out.push({ midis: seg.midis, ticks: seg.ticks, tie: false });
    }
  }
  while (out.length && !out[out.length - 1].midis.length) out.pop();
  if (out.length) out[out.length - 1].tie = false;
  return out;
}
