// Modelo da partitura: notas em lista contínua, divididas em compassos na hora de desenhar.
// Unidade de tempo interna: "ticks" (1 fusa = 1 tick, semínima = 8 ticks).

export const DURATIONS = [
  { id: 'w', ticks: 32, name: 'Semibreve', label: '1' },
  { id: 'h', ticks: 16, name: 'Mínima', label: '½' },
  { id: 'q', ticks: 8, name: 'Semínima', label: '¼' },
  { id: '8', ticks: 4, name: 'Colcheia', label: '⅛' },
  { id: '16', ticks: 2, name: 'Semicolcheia', label: '1/16' },
  { id: '32', ticks: 1, name: 'Fusa', label: '1/32' },
];

const BASE_TICKS = Object.fromEntries(DURATIONS.map((d) => [d.id, d.ticks]));

// Valores representáveis por uma única figura (com ou sem ponto), do maior para o menor.
const SINGLE_VALUES = [];
for (const d of DURATIONS) {
  SINGLE_VALUES.push({ ticks: d.ticks, dur: d.id, dots: 0 });
  if (d.ticks >= 2) SINGLE_VALUES.push({ ticks: d.ticks * 1.5, dur: d.id, dots: 1 });
}
SINGLE_VALUES.sort((a, b) => b.ticks - a.ticks);

export function noteTicks(note) {
  const base = BASE_TICKS[note.dur];
  return note.dots ? base * 1.5 : base;
}

// Quebra uma quantidade de ticks em figuras (ligadas entre si).
export function decompose(ticks) {
  const out = [];
  let rest = Math.round(ticks);
  while (rest > 0) {
    const v = SINGLE_VALUES.find((s) => s.ticks <= rest);
    out.push({ dur: v.dur, dots: v.dots });
    rest -= v.ticks;
  }
  return out;
}

// ---------- Tonalidades e grafia das notas ----------

export const KEYS = [
  { id: 'C', label: 'Dó maior / Lá menor', fifths: 0 },
  { id: 'G', label: 'Sol maior / Mi menor', fifths: 1 },
  { id: 'D', label: 'Ré maior / Si menor', fifths: 2 },
  { id: 'A', label: 'Lá maior / Fá♯ menor', fifths: 3 },
  { id: 'E', label: 'Mi maior / Dó♯ menor', fifths: 4 },
  { id: 'B', label: 'Si maior / Sol♯ menor', fifths: 5 },
  { id: 'F#', label: 'Fá♯ maior / Ré♯ menor', fifths: 6 },
  { id: 'C#', label: 'Dó♯ maior / Lá♯ menor', fifths: 7 },
  { id: 'F', label: 'Fá maior / Ré menor', fifths: -1 },
  { id: 'Bb', label: 'Si♭ maior / Sol menor', fifths: -2 },
  { id: 'Eb', label: 'Mi♭ maior / Dó menor', fifths: -3 },
  { id: 'Ab', label: 'Lá♭ maior / Fá menor', fifths: -4 },
  { id: 'Db', label: 'Ré♭ maior / Si♭ menor', fifths: -5 },
  { id: 'Gb', label: 'Sol♭ maior / Mi♭ menor', fifths: -6 },
  { id: 'Cb', label: 'Dó♭ maior / Lá♭ menor', fifths: -7 },
];

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const NATURAL_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SHARP_ORDER = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const FLAT_ORDER = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const PT_NAMES = { c: 'Dó', d: 'Ré', e: 'Mi', f: 'Fá', g: 'Sol', a: 'Lá', b: 'Si' };

export function keyFifths(keyId) {
  return (KEYS.find((k) => k.id === keyId) || KEYS[0]).fifths;
}

// Alteração de cada letra na armadura (+1 sustenido, -1 bemol).
export function keyAlterations(keyId) {
  const f = keyFifths(keyId);
  const alt = { c: 0, d: 0, e: 0, f: 0, g: 0, a: 0, b: 0 };
  if (f > 0) SHARP_ORDER.slice(0, f).forEach((l) => (alt[l] = 1));
  if (f < 0) FLAT_ORDER.slice(0, -f).forEach((l) => (alt[l] = -1));
  return alt;
}

const mod12 = (n) => ((n % 12) + 12) % 12;

// Retorna { letter, alter, octave } para um MIDI, de acordo com a tonalidade e a preferência da nota.
export function spell(midi, keyId = 'C', pref = null) {
  const pc = mod12(midi);
  const alt = keyAlterations(keyId);
  const build = (letter, alter) => ({
    letter,
    alter,
    octave: (midi - NATURAL_PC[letter] - alter) / 12 - 1,
  });
  const candidates = [];
  for (const l of LETTERS) {
    for (const a of [-1, 0, 1]) {
      if (mod12(NATURAL_PC[l] + a) === pc) candidates.push({ l, a });
    }
  }
  if (pref === 'sharp') {
    const c = candidates.find((c) => c.a === 1);
    if (c) return build(c.l, c.a);
  } else if (pref === 'flat') {
    const c = candidates.find((c) => c.a === -1);
    if (c) return build(c.l, c.a);
  }
  // Nota pertencente à escala da tonalidade
  const diat = candidates.find((c) => alt[c.l] === c.a);
  if (diat) return build(diat.l, diat.a);
  // Fora da escala: natural, senão sustenido (tons com ♯) ou bemol (tons com ♭)
  const nat = candidates.find((c) => c.a === 0);
  if (nat) return build(nat.l, 0);
  const wantFlat = keyFifths(keyId) < 0;
  const c = candidates.find((c) => c.a === (wantFlat ? -1 : 1)) || candidates[0];
  return build(c.l, c.a);
}

export function vexKey(midi, keyId, pref) {
  const s = spell(midi, keyId, pref);
  const acc = s.alter === 1 ? '#' : s.alter === -1 ? 'b' : '';
  return `${s.letter}${acc}/${s.octave}`;
}

export function noteName(midi, keyId = 'C', pref = null) {
  const s = spell(midi, keyId, pref);
  const acc = s.alter === 1 ? '♯' : s.alter === -1 ? '♭' : '';
  return `${PT_NAMES[s.letter]}${acc}${s.octave}`;
}

export function isInKey(midi, keyId) {
  const s = spell(midi, keyId);
  return keyAlterations(keyId)[s.letter] === s.alter;
}

// Próxima nota da escala acima (dir=1) ou abaixo (dir=-1).
export function diatonicStep(midi, keyId, dir) {
  let m = midi + dir;
  while (!isInKey(m, keyId)) m += dir;
  return m;
}

// ---------- Partitura ----------

let idCounter = 1;
export const newId = () => `n${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function createScore() {
  return {
    version: 1,
    title: 'Nova partitura',
    composer: '',
    tempo: 90,
    timeSig: { num: 4, den: 4 },
    keySig: 'C',
    clef: 'treble',
    notes: [],
  };
}

// "midi" é a nota principal; "chord" guarda as outras notas tocadas junto (acorde).
export function makeNote(midi, dur, dots = 0, rest = false, chord = []) {
  return { id: newId(), midi, dur, dots, rest, tie: false, pref: null, chord };
}

// Todas as alturas da nota, da mais grave para a mais aguda.
export function pitchesOf(note) {
  return [...new Set([note.midi, ...(note.chord || [])])].sort((a, b) => a - b);
}

export function measureTicks(score) {
  return (score.timeSig.num * 32) / score.timeSig.den;
}

// Divide a lista de notas em compassos. Notas que atravessam a barra viram partes ligadas.
// Cada parte: { src, dur, dots, rest, midi, tie (ligada à próxima parte), first }
export function layoutMeasures(score) {
  const cap = measureTicks(score);
  const measures = [[]];
  let room = cap;
  score.notes.forEach((note, src) => {
    let t = noteTicks(note);
    let first = true;
    while (t > 0) {
      if (room === 0) {
        measures.push([]);
        room = cap;
      }
      const take = Math.min(t, room);
      const pieces = decompose(take);
      pieces.forEach((p, i) => {
        const lastOfNote = t - take === 0 && i === pieces.length - 1;
        measures[measures.length - 1].push({
          src,
          dur: p.dur,
          dots: p.dots,
          rest: note.rest,
          midi: note.midi,
          midis: pitchesOf(note),
          pref: note.pref,
          tie: note.rest ? false : lastOfNote ? !!note.tie : true,
          first,
        });
        first = false;
      });
      t -= take;
      room -= take;
    }
  });
  return measures;
}

// Converte a partitura em eventos tocáveis (notas ligadas são unidas). Tempo em semínimas.
export function playbackEvents(score) {
  const events = [];
  let pos = 0;
  let open = null;
  score.notes.forEach((n, src) => {
    const len = noteTicks(n) / 8;
    if (!n.rest) {
      const midis = pitchesOf(n);
      if (open && open.midis.join() === midis.join()) {
        open.len += len;
        open.srcs.push({ src, start: pos });
      } else {
        open = { midis, start: pos, len, srcs: [{ src, start: pos }] };
        events.push(open);
      }
      if (!n.tie) open = null;
    } else {
      open = null;
      events.push({ midis: [], start: pos, len, srcs: [{ src, start: pos }] });
    }
    pos += len;
  });
  return { events, total: pos };
}

export function validateScore(obj) {
  if (!obj || !Array.isArray(obj.notes)) throw new Error('Arquivo de partitura inválido');
  const base = createScore();
  const s = { ...base, ...obj };
  s.timeSig = { ...base.timeSig, ...(obj.timeSig || {}) };
  s.notes = obj.notes
    .filter((n) => BASE_TICKS[n.dur])
    .map((n) => ({
      id: n.id || newId(),
      midi: Number.isFinite(n.midi) ? n.midi : 71,
      dur: n.dur,
      dots: n.dots ? 1 : 0,
      rest: !!n.rest,
      tie: !!n.tie,
      pref: n.pref === 'sharp' || n.pref === 'flat' ? n.pref : null,
      chord: Array.isArray(n.chord) ? n.chord.filter(Number.isFinite) : [],
    }));
  return s;
}
