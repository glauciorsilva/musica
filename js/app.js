import {
  DURATIONS, KEYS, createScore, diatonicStep, keyAlterations, makeNote, noteName, validateScore,
} from './score.js';
import { renderScore, hitTest } from './render.js';
import { Transcriber, eventsToNotes } from './pitch.js';
import { analyzeFile, playScore, previewNote, startMetronome, startMic } from './audio.js';
import { toMidi, toMusicXML } from './export.js';

const $ = (id) => document.getElementById(id);
const STORE_CURRENT = 'partitura:atual';
const STORE_LIBRARY = 'partitura:biblioteca';

const state = {
  score: loadCurrent(),
  sel: null, // índice da nota selecionada (tocada na partitura)
  last: null, // última nota inserida (recebe ♯, ♭, ▲, ▼…)
  caret: 0, // posição de inserção quando nada está selecionado
  dur: 'q',
  dots: 0,
  mode: 'insert',
  pianoLow: 60, // primeira tecla do piano (Dó4)
  undo: [],
  redo: [],
  layout: null,
  player: null,
  rec: null,
};
state.caret = state.score.notes.length;

// ---------- Persistência ----------

function loadCurrent() {
  try {
    const raw = localStorage.getItem(STORE_CURRENT);
    if (raw) return validateScore(JSON.parse(raw));
  } catch (e) {
    console.warn(e);
  }
  return createScore();
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_CURRENT, JSON.stringify(state.score));
    } catch (e) {
      console.warn(e);
    }
  }, 300);
}

function library() {
  try {
    return JSON.parse(localStorage.getItem(STORE_LIBRARY) || '[]');
  } catch {
    return [];
  }
}

// ---------- Histórico (desfazer/refazer) ----------

function snapshot() {
  state.undo.push(JSON.stringify(state.score));
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
}

function change(fn) {
  snapshot();
  fn(state.score);
  save();
  render();
}

function restore(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(state.score));
  state.score = JSON.parse(from.pop());
  state.sel = null;
  state.last = null;
  state.caret = Math.min(state.caret, state.score.notes.length);
  syncSettings();
  save();
  render();
}

// ---------- Desenho ----------

function render() {
  const s = state.score;
  if (state.sel !== null && state.sel >= s.notes.length) state.sel = null;
  if (state.last !== null && state.last >= s.notes.length) state.last = null;
  state.layout = renderScore($('score'), s, {
    selected: target(),
    caret: state.sel === null ? state.caret : null,
  });
  $('emptyHint').hidden = s.notes.length > 0;
  updateTools();
}

function updateTools() {
  const n = state.sel !== null ? state.score.notes[state.sel] : null;
  const t = target() !== null ? state.score.notes[target()] : null;
  const dur = n ? n.dur : state.dur;
  const dots = n ? n.dots : state.dots;
  document.querySelectorAll('[data-dur]').forEach((b) => b.classList.toggle('on', b.dataset.dur === dur));
  $('btnDot').classList.toggle('on', !!dots);
  $('btnRest').classList.toggle('on', !!(n && n.rest));
  $('btnTie').classList.toggle('on', !!(t && t.tie));
  for (const id of ['btnSharp', 'btnFlat', 'btnUp', 'btnDown', 'btnOctUp', 'btnOctDown', 'btnTie', 'btnEnh']) {
    $(id).disabled = !t || t.rest;
  }
  $('btnDelete').disabled = !n && state.caret === 0;
  $('btnUndo').disabled = !state.undo.length;
  $('btnRedo').disabled = !state.redo.length;
  const m = $('btnMode');
  m.textContent = state.mode === 'insert' ? 'Inserir' : 'Substituir';
  m.classList.toggle('replace', state.mode === 'replace');
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ---------- Edição ----------

// Nota que recebe as alterações de altura: a selecionada ou a recém-inserida.
function target() {
  return state.sel ?? state.last;
}

function insertPos() {
  return state.sel !== null ? state.sel + 1 : state.caret;
}

function lastPitchBefore(pos) {
  for (let i = pos - 1; i >= 0; i--) if (!state.score.notes[i].rest) return state.score.notes[i].midi;
  return state.score.clef === 'bass' ? 48 : 67;
}

function insertNote(midi, rest = false) {
  const pos = insertPos();
  const note = makeNote(rest ? lastPitchBefore(pos) : midi, state.dur, state.dots, rest);
  change((s) => s.notes.splice(pos, 0, note));
  state.sel = null;
  state.last = pos;
  state.caret = pos + 1;
  render();
  scrollToSelection();
}

function pianoInput(midi) {
  previewNote(midi);
  if (state.mode === 'replace' && state.sel !== null) {
    const i = state.sel;
    change((s) => {
      s.notes[i].midi = midi;
      s.notes[i].rest = false;
      s.notes[i].pref = null;
    });
    if (i + 1 < state.score.notes.length) select(i + 1);
    else {
      state.sel = null;
      state.caret = state.score.notes.length;
      render();
    }
  } else {
    insertNote(midi);
  }
}

function editSelected(fn, preview = true) {
  const i = target();
  if (i === null) return;
  change((s) => fn(s.notes[i]));
  const n = state.score.notes[i];
  if (preview && n && !n.rest) previewNote(n.midi);
}

function select(i) {
  state.sel = i;
  state.last = null;
  if (i !== null) state.caret = i + 1;
  render();
  scrollToSelection();
}

function scrollToSelection() {
  if (target() === null || !state.layout) return;
  const h = state.layout.hits.find((x) => x.src === target());
  if (!h) return;
  const box = state.layout.lineBoxes[h.line];
  const wrap = $('scoreWrap');
  const top = box.top + $('score').offsetTop;
  if (top < wrap.scrollTop || top + 130 > wrap.scrollTop + wrap.clientHeight) {
    wrap.scrollTo({ top: Math.max(0, top - 20), behavior: 'smooth' });
  }
}

function setDuration(dur) {
  state.dur = dur;
  if (state.sel !== null) editSelected((n) => (n.dur = dur), false);
  else updateTools();
}

function toggleDot() {
  if (state.sel !== null) {
    const v = state.score.notes[state.sel].dots ? 0 : 1;
    state.dots = v;
    editSelected((n) => (n.dots = v), false);
  } else {
    state.dots = state.dots ? 0 : 1;
    updateTools();
  }
}

function toggleRest() {
  if (state.sel !== null) editSelected((n) => (n.rest = !n.rest));
  else insertNote(null, true);
}

function deleteNote() {
  state.last = null;
  if (state.sel !== null) {
    const i = state.sel;
    change((s) => s.notes.splice(i, 1));
    if (i > 0) {
      state.sel = i - 1;
    } else {
      state.sel = null;
      state.caret = 0;
    }
    render();
  } else if (state.caret > 0) {
    const i = state.caret - 1;
    change((s) => s.notes.splice(i, 1));
    state.caret = i;
    render();
  }
}

function move(dir) {
  const len = state.score.notes.length;
  if (!len) return;
  state.last = null;
  if (state.sel === null) select(Math.max(0, Math.min(len - 1, dir > 0 ? state.caret : state.caret - 1)));
  else if (dir > 0 && state.sel === len - 1) {
    state.sel = null;
    state.caret = len;
    render();
  } else select(Math.max(0, Math.min(len - 1, state.sel + dir)));
}

// ---------- Interface: edição ----------

function buildDurationButtons() {
  const row = $('durRow');
  const first = row.firstChild;
  DURATIONS.forEach((d) => {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.dur = d.id;
    b.textContent = d.label;
    b.title = d.name;
    b.addEventListener('click', () => setDuration(d.id));
    row.insertBefore(b, first);
  });
}

function buildPiano() {
  const piano = $('piano');
  piano.innerHTML = '';
  const low = state.pianoLow;
  // Quantidade de teclas conforme a largura da tela (teclas com ~36px no celular)
  const whiteCount = Math.max(8, Math.min(22, Math.floor(piano.clientWidth / 30)));
  const octaves = whiteCount >= 15 ? 2 : whiteCount >= 11 ? 1.5 : 1;
  const high = low + (octaves === 1.5 ? 17 : octaves * 12); // termina em Dó (ou Fá)
  const whites = [];
  for (let m = low; m <= high; m++) if (!isBlackKey(m)) whites.push(m);
  const ww = 100 / whites.length;
  whites.forEach((m) => {
    const k = document.createElement('div');
    k.className = 'key white';
    k.dataset.midi = m;
    if (m % 12 === 0) k.textContent = noteName(m);
    piano.appendChild(k);
  });
  for (let m = low; m <= high; m++) {
    if (!isBlackKey(m)) continue;
    const idx = whites.indexOf(m - 1);
    const k = document.createElement('div');
    k.className = 'key black';
    k.dataset.midi = m;
    k.style.left = `${(idx + 1 - 0.32) * ww}%`;
    k.style.width = `${ww * 0.64}%`;
    piano.appendChild(k);
  }
  $('pianoRange').textContent = `${noteName(low)} – ${noteName(high)}`;
}

function setupPiano() {
  buildPiano();
  const piano = $('piano');
  piano.addEventListener('pointerdown', (e) => {
    const k = e.target.closest('.key');
    if (!k) return;
    e.preventDefault();
    k.classList.add('down');
    setTimeout(() => k.classList.remove('down'), 180);
    pianoInput(Number(k.dataset.midi));
  });
  $('btnPianoDown').onclick = () => {
    state.pianoLow = Math.max(24, state.pianoLow - 12);
    buildPiano();
  };
  $('btnPianoUp').onclick = () => {
    state.pianoLow = Math.min(84, state.pianoLow + 12);
    buildPiano();
  };
}

const isBlackKey = (midi) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

// Meio tom acima/abaixo; teclas pretas são escritas com o acidente do botão usado.
function shift(n, delta, pref) {
  n.midi += delta;
  n.pref = isBlackKey(n.midi) ? pref : null;
}

function setupEditTools() {
  buildDurationButtons();
  $('btnDot').onclick = toggleDot;
  $('btnRest').onclick = toggleRest;
  $('btnSharp').onclick = () => editSelected((n) => shift(n, 1, 'sharp'));
  $('btnFlat').onclick = () => editSelected((n) => shift(n, -1, 'flat'));
  $('btnUp').onclick = () => editSelected((n) => { n.midi = diatonicStep(n.midi, state.score.keySig, 1); n.pref = null; });
  $('btnDown').onclick = () => editSelected((n) => { n.midi = diatonicStep(n.midi, state.score.keySig, -1); n.pref = null; });
  $('btnOctUp').onclick = () => editSelected((n) => (n.midi = Math.min(108, n.midi + 12)));
  $('btnOctDown').onclick = () => editSelected((n) => (n.midi = Math.max(21, n.midi - 12)));
  $('btnTie').onclick = () => editSelected((n) => (n.tie = !n.tie), false);
  $('btnEnh').onclick = () => editSelected((n) => {
    if (!isBlackKey(n.midi)) n.pref = null;
    else n.pref = n.pref === 'flat' ? 'sharp' : 'flat';
  }, false);
  $('btnPrev').onclick = () => move(-1);
  $('btnNext').onclick = () => move(1);
  $('btnDelete').onclick = deleteNote;
  $('btnUndo').onclick = () => restore(state.undo, state.redo);
  $('btnRedo').onclick = () => restore(state.redo, state.undo);
  $('btnMode').onclick = () => {
    state.mode = state.mode === 'insert' ? 'replace' : 'insert';
    updateTools();
    toast(state.mode === 'insert' ? 'O piano insere novas notas' : 'O piano substitui a nota selecionada');
  };

  $('score').addEventListener('click', (e) => {
    if (!state.layout || state.rec) return;
    const r = hitTest(state.layout, e.clientX, e.clientY, state.score.notes.length);
    if (r.select !== undefined) {
      if (state.sel === r.select) {
        const n = state.score.notes[r.select];
        if (!n.rest) previewNote(n.midi);
      }
      select(r.select);
    } else {
      state.sel = null;
      state.last = null;
      state.caret = r.caret;
      render();
    }
  });
}

// ---------- Teclado do computador ----------

const LETTER_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) restore(state.redo, state.undo);
      else restore(state.undo, state.redo);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') {
      e.preventDefault();
      restore(state.redo, state.undo);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k in LETTER_PC) {
      // Escolhe a oitava mais próxima da nota anterior, respeitando a armadura
      const ref = lastPitchBefore(insertPos());
      const pc = LETTER_PC[k] + keyAlterations(state.score.keySig)[k];
      let best = null;
      for (let o = 0; o <= 8; o++) {
        const m = 12 * (o + 1) + pc;
        if (best === null || Math.abs(m - ref) < Math.abs(best - ref)) best = m;
      }
      pianoInput(best);
    } else if ('123456'.includes(k) && k.length === 1) {
      setDuration(DURATIONS[Number(k) - 1].id);
    } else if (k === '.') toggleDot();
    else if (k === '0' || k === 'r') toggleRest();
    else if (k === 'arrowleft') move(-1);
    else if (k === 'arrowright') move(1);
    else if (k === 'arrowup') $('btnUp').click();
    else if (k === 'arrowdown') $('btnDown').click();
    else if (k === '+' || k === '#') $('btnSharp').click();
    else if (k === '-') $('btnFlat').click();
    else if (k === 'delete' || k === 'backspace') deleteNote();
    else if (k === ' ') togglePlay();
    else if (k === 'escape') {
      state.sel = null;
      render();
    } else return;
    e.preventDefault();
  });
}

// ---------- Configurações ----------

function syncSettings() {
  const s = state.score;
  $('title').value = s.title;
  $('composer').value = s.composer || '';
  $('tempo').value = s.tempo;
  $('timeSig').value = `${s.timeSig.num}/${s.timeSig.den}`;
  $('keySig').value = s.keySig;
  $('clef').value = s.clef;
}

function setupSettings() {
  $('keySig').innerHTML = KEYS.map((k) => `<option value="${k.id}">${k.label}</option>`).join('');
  syncSettings();
  $('btnSettings').onclick = () => ($('settings').hidden = !$('settings').hidden);
  $('title').addEventListener('change', () => change((s) => (s.title = $('title').value.trim() || 'Sem título')));
  $('composer').addEventListener('change', () => change((s) => (s.composer = $('composer').value.trim())));
  $('tempo').addEventListener('change', () => {
    const v = Math.max(30, Math.min(240, Number($('tempo').value) || 90));
    $('tempo').value = v;
    change((s) => (s.tempo = v));
  });
  $('timeSig').addEventListener('change', () => {
    const [num, den] = $('timeSig').value.split('/').map(Number);
    change((s) => (s.timeSig = { num, den }));
  });
  $('keySig').addEventListener('change', () => change((s) => {
    s.keySig = $('keySig').value;
    s.notes.forEach((n) => (n.pref = null));
  }));
  $('clef').addEventListener('change', () => change((s) => (s.clef = $('clef').value)));
}

// ---------- Reprodução ----------

function togglePlay() {
  if (state.player) {
    state.player.stop();
    return;
  }
  if (!state.score.notes.length) return toast('A partitura está vazia');
  const btn = $('btnPlay');
  let lit = [];
  let ended = false;
  const highlight = (src) => {
    lit.forEach((el) => el.classList.remove('playing'));
    lit = src === null ? [] : state.layout?.elementsBySrc.get(src) || [];
    lit.forEach((el) => el.classList.add('playing'));
  };
  const endPlay = () => {
    ended = true;
    state.player = null;
    btn.textContent = '▶ Tocar';
    btn.classList.remove('on');
  };
  const player = playScore(state.score, { from: state.sel ?? 0, onNote: highlight, onEnd: endPlay });
  if (ended) return;
  btn.textContent = '■ Parar';
  btn.classList.add('on');
  state.player = {
    stop() {
      player.stop();
      endPlay();
    },
  };
}

// ---------- Gravação ----------

function sensitivityToSilence(v) {
  // 1 (pouco sensível) .. 10 (muito sensível)
  return 0.05 * Math.pow(0.6, v - 1);
}

function makeTranscriber(origin = null) {
  return new Transcriber({
    tempo: state.score.tempo,
    gridTicks: Number($('optGrid').value),
    origin,
    minRestTicks: $('optMergeRests').checked ? 4 : 1,
  });
}

function beginCapture() {
  snapshot();
  const pos = insertPos();
  return {
    base: state.score.notes.slice(),
    pos,
  };
}

function applyCapture(cap, events) {
  const notes = eventsToNotes(events);
  state.score.notes = [...cap.base.slice(0, cap.pos), ...notes, ...cap.base.slice(cap.pos)];
  state.sel = null;
  state.last = null;
  state.caret = cap.pos + notes.length;
  render();
  return notes.length;
}

function showLive(frame, keySig) {
  $('meterBar').style.width = `${Math.min(100, Math.sqrt(frame.level) * 250)}%`;
  if (frame.midi === null) {
    $('liveNote').textContent = '—';
    $('liveFreq').textContent = frame.level > 0.002 ? 'Ouvindo…' : 'Silêncio';
    $('tunerNeedle').style.left = '50%';
    return;
  }
  const cents = Math.round((frame.exact - frame.midi) * 100);
  $('liveNote').textContent = noteName(frame.midi, keySig);
  $('liveFreq').textContent = `${frame.freq.toFixed(1)} Hz · ${cents > 0 ? '+' : ''}${cents} cents`;
  $('tunerNeedle').style.left = `${50 + cents}%`;
}

async function startRecording() {
  if (state.player) state.player.stop();
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Este navegador não permite acesso ao microfone (use HTTPS).');
    return;
  }
  const cap = beginCapture();
  let tr = makeTranscriber();
  let metro = null;
  const rec = { cap, tr, mic: null, metro: null, last: 0 };
  state.rec = rec;
  $('btnRecord').classList.add('on');
  $('liveFreq').textContent = 'Preparando microfone…';
  try {
    rec.mic = await startMic((t, frame) => {
      if (state.rec !== rec) return;
      showLive(frame, state.score.keySig);
      rec.tr.feed(t, frame.midi, frame.level);
      if (t - rec.last > 250) {
        rec.last = t;
        applyCapture(cap, rec.tr.events(t));
      }
    }, { silence: sensitivityToSilence(Number($('optSensitivity').value)) });
  } catch (err) {
    console.error(err);
    state.rec = null;
    state.undo.pop();
    $('btnRecord').classList.remove('on');
    $('liveFreq').textContent = 'Não foi possível usar o microfone.';
    toast('Permita o acesso ao microfone para gravar.');
    return;
  }
  if ($('optMetronome').checked) {
    const { num, den } = state.score.timeSig;
    metro = startMetronome(num, state.score.tempo, 1, 4 / den);
    rec.metro = metro;
    rec.tr = tr = makeTranscriber(metro.downbeatMs);
    toast('Contagem de um compasso…');
  } else {
    toast('Gravando — pode cantar ou tocar!');
  }
}

function stopRecording() {
  const rec = state.rec;
  if (!rec) return;
  state.rec = null;
  rec.mic?.stop();
  rec.metro?.stop();
  const events = rec.tr.finish();
  const n = applyCapture(rec.cap, events);
  save();
  $('btnRecord').classList.remove('on');
  $('liveNote').textContent = '—';
  $('meterBar').style.width = '0';
  $('liveFreq').textContent = n ? `${n} notas adicionadas` : 'Nenhuma nota detectada';
  if (!n) state.undo.pop();
}

async function transcribeFile(file) {
  if (!file) return;
  const cap = beginCapture();
  const tr = makeTranscriber();
  $('liveNote').textContent = '…';
  try {
    const end = await analyzeFile(file, (t, frame) => tr.feed(t, frame.midi, frame.level), {
      silence: sensitivityToSilence(Number($('optSensitivity').value)),
      onProgress: (p) => ($('liveFreq').textContent = `Analisando arquivo… ${Math.round(p * 100)}%`),
    });
    const n = applyCapture(cap, tr.finish(end));
    save();
    $('liveNote').textContent = '—';
    $('liveFreq').textContent = n ? `${n} notas adicionadas` : 'Nenhuma nota detectada';
    if (!n) state.undo.pop();
  } catch (err) {
    console.error(err);
    state.undo.pop();
    $('liveFreq').textContent = 'Não foi possível ler este arquivo de áudio.';
  }
}

function setupRecording() {
  $('btnRecord').onclick = () => (state.rec ? stopRecording() : startRecording());
  $('audioFile').addEventListener('change', (e) => {
    transcribeFile(e.target.files[0]);
    e.target.value = '';
  });
}

// ---------- Menu / arquivos ----------

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const fileBase = () => (state.score.title || 'partitura').replace(/[\\/:*?"<>|]+/g, '').trim() || 'partitura';

function loadScore(score) {
  state.score = validateScore(score);
  state.undo = [];
  state.redo = [];
  state.sel = null;
  state.last = null;
  state.caret = state.score.notes.length;
  syncSettings();
  save();
  render();
}

function saveToLibrary() {
  const lib = library();
  const s = state.score;
  const idx = lib.findIndex((x) => x.score.title === s.title);
  const entry = { date: new Date().toISOString(), score: s };
  if (idx >= 0) lib[idx] = entry;
  else lib.unshift(entry);
  try {
    localStorage.setItem(STORE_LIBRARY, JSON.stringify(lib));
    toast(`“${s.title}” salva no aparelho`);
  } catch {
    toast('Sem espaço para salvar');
  }
}

function showLibrary() {
  const list = $('libraryList');
  const lib = library();
  list.innerHTML = lib.length ? '' : '<li><p class="hint">Nenhuma partitura salva ainda.</p></li>';
  lib.forEach((entry, i) => {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.innerHTML = `${escapeHtml(entry.score.title)}<small>${new Date(entry.date).toLocaleString('pt-BR')} · ${entry.score.notes.length} notas</small>`;
    open.onclick = () => {
      loadScore(entry.score);
      $('library').close();
    };
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '🗑';
    del.setAttribute('aria-label', 'Excluir');
    del.onclick = () => {
      if (!confirm(`Excluir “${entry.score.title}”?`)) return;
      const l = library();
      l.splice(i, 1);
      localStorage.setItem(STORE_LIBRARY, JSON.stringify(l));
      showLibrary();
    };
    li.append(open, del);
    list.appendChild(li);
  });
  if (!$('library').open) $('library').showModal();
}

const escapeHtml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

function printScore() {
  state.layout = renderScore($('score'), state.score, {});
  const t = document.createElement('h1');
  t.className = 'print-title';
  t.textContent = state.score.title;
  const c = document.createElement('div');
  c.className = 'print-composer';
  c.textContent = state.score.composer || '';
  $('score').prepend(t, c);
  setTimeout(() => {
    window.print();
    render();
  }, 50);
}

function setupMenu() {
  const menu = $('menu');
  $('btnMenu').onclick = () => menu.showModal();
  document.querySelectorAll('dialog [data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach((d) =>
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
    }),
  );
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    menu.close();
    switch (action) {
      case 'new':
        if (state.score.notes.length && !confirm('Começar uma partitura nova? A atual continua salva em “Minhas partituras” se você salvou.')) return;
        loadScore(createScore());
        break;
      case 'library':
        showLibrary();
        break;
      case 'saveLocal':
        saveToLibrary();
        break;
      case 'open':
        $('openFile').click();
        break;
      case 'downloadJson':
        download(`${fileBase()}.json`, JSON.stringify(state.score, null, 1), 'application/json');
        break;
      case 'musicxml':
        download(`${fileBase()}.musicxml`, toMusicXML(state.score), 'application/vnd.recordare.musicxml+xml');
        break;
      case 'midi':
        download(`${fileBase()}.mid`, new Blob([toMidi(state.score)], { type: 'audio/midi' }));
        break;
      case 'svg': {
        const svg = renderScore(document.createElement('div'), state.score, {}).svg;
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        download(`${fileBase()}.svg`, svg.outerHTML, 'image/svg+xml');
        break;
      }
      case 'print':
        printScore();
        break;
      case 'help':
        $('help').showModal();
        break;
    }
  });
  $('openFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      snapshot();
      loadScore(JSON.parse(await f.text()));
      toast('Partitura aberta');
    } catch (err) {
      toast('Arquivo inválido');
    }
  });
}

function setupTabs() {
  document.querySelectorAll('.tab[data-tab]').forEach((t) =>
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab[data-tab]').forEach((x) => x.classList.toggle('active', x === t));
      $('tab-edit').hidden = t.dataset.tab !== 'edit';
      $('tab-record').hidden = t.dataset.tab !== 'record';
    }),
  );
  $('btnPlay').onclick = togglePlay;
}

// ---------- Início ----------

setupSettings();
setupEditTools();
setupPiano();
setupKeyboard();
setupRecording();
setupMenu();
setupTabs();
render();

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    render();
    buildPiano();
  }, 150);
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
