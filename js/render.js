// Desenho da partitura com VexFlow (carregado globalmente em vendor/vexflow.js).
// Clave "grand" = pauta dupla de piano: notas a partir do Dó central na clave de Sol, abaixo na de Fá.

import { keyFifths, layoutMeasures, spell, vexKey } from './score.js';

const VF = window.Vex.Flow;

const TOP = 10;
const SIDE = 8;
const LINE_GAP = 14;
const SELECT_COLOR = '#1565c0';
const SPLIT = 60; // Dó central
const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const MIDDLE_LINE = { treble: 4 * 7 + 6, bass: 3 * 7 + 1 }; // Si4 e Ré3

function noteMinWidth(part) {
  return (part.dur === 'w' || part.dur === 'h' ? 34 : 28) + (part.midis.length > 2 ? 6 : 0);
}

const stavesFor = (clef) => (clef === 'grand' ? ['treble', 'bass'] : [clef]);

function staffPitches(part, staff, clef) {
  if (part.rest) return [];
  if (clef !== 'grand') return part.midis;
  return part.midis.filter((m) => (staff === 'treble' ? m >= SPLIT : m < SPLIT));
}

// Espaço vertical (relativo ao y da pauta no VexFlow) ocupado pelas notas de uma linha.
function verticalExtent(staff, midis, keySig) {
  let top = 22; // número do compasso
  let bottom = 100;
  for (const m of midis) {
    const s = spell(m, keySig);
    const steps = s.octave * 7 + LETTERS.indexOf(s.letter) - MIDDLE_LINE[staff];
    const y = 60 - steps * 5;
    top = Math.min(top, y - (steps < 0 ? 38 : 12));
    bottom = Math.max(bottom, y + (steps > 0 ? 38 : 12));
  }
  return { top, bottom };
}

export function renderScore(container, score, { selected = null, caret = null } = {}) {
  const width = Math.max(300, container.clientWidth);
  const measures = layoutMeasures(score);
  const { keySig, clef } = score;
  const staffNames = stavesFor(clef);
  const timeStr = `${score.timeSig.num}/${score.timeSig.den}`;
  const keyWidth = 14 + Math.abs(keyFifths(keySig)) * 10;

  // Distribui os compassos em linhas conforme a largura disponível
  const avail = width - SIDE * 2 - (clef === 'grand' ? 12 : 0);
  const headWidth = (isFirst) => 40 + keyWidth + (isFirst ? 30 : 0);
  const lines = [];
  let line = null;
  measures.forEach((m, i) => {
    const natural = 30 + m.reduce((s, p) => s + noteMinWidth(p) + (p.rest ? 0 : 6), 0);
    const head = headWidth(i === 0);
    if (!line || line.used + natural > avail) {
      line = { items: [], used: head };
      lines.push(line);
    }
    line.items.push({ index: i, parts: m, natural });
    line.used += natural;
  });

  // Posição vertical de cada linha, com espaço para notas fora da pauta
  let cursorY = TOP;
  const lineBoxes = lines.map((ln) => {
    const parts = ln.items.flatMap((it) => it.parts);
    const ys = [];
    let top = null;
    let bottom = cursorY;
    staffNames.forEach((staff, si) => {
      const ext = verticalExtent(staff, parts.flatMap((p) => staffPitches(p, staff, clef)), keySig);
      const y = si === 0 ? cursorY - ext.top : Math.max(bottom - ext.top, ys[0] + 110);
      ys.push(y);
      if (top === null) top = y + ext.top;
      bottom = y + ext.bottom;
    });
    cursorY = bottom + LINE_GAP;
    return { top, bottom, ys, startX: SIDE };
  });

  container.innerHTML = '';
  const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  renderer.resize(width, cursorY + 6);
  const ctx = renderer.getContext();
  const svg = container.querySelector('svg');

  const hits = []; // { line, x, src }
  const entries = staffNames.map(() => []); // por pauta: { part, note, line, midis }
  const lastIndex = measures.length - 1;
  const restKey = { treble: 'b/4', bass: 'd/3' };

  lines.forEach((ln, li) => {
    const box = lineBoxes[li];
    const head = headWidth(ln.items[0].index === 0);
    const isLastLine = li === lines.length - 1;
    const sumNatural = ln.items.reduce((s, it) => s + it.natural, 0);
    let scale = (avail - head) / sumNatural;
    if (isLastLine) scale = Math.min(scale, 1.5);
    let x = SIDE + (clef === 'grand' ? 12 : 0);

    ln.items.forEach((it, k) => {
      const w = it.natural * scale + (k === 0 ? head : 0);
      const staves = staffNames.map((staff, si) => {
        const stave = new VF.Stave(x, box.ys[si], w);
        if (k === 0) {
          stave.addClef(staff).addKeySignature(keySig);
          if (it.index === 0) stave.addTimeSignature(timeStr);
          if (si === 0) stave.setMeasure(it.index + 1);
        }
        if (it.index === lastIndex) stave.setEndBarType(VF.Barline.type.END);
        return stave;
      });
      if (staves.length > 1) {
        const startX = Math.max(...staves.map((s) => s.getNoteStartX()));
        staves.forEach((s) => s.setNoteStartX(startX));
      }
      staves.forEach((s) => s.setContext(ctx).draw());
      if (staves.length > 1) {
        if (k === 0) {
          new VF.StaveConnector(staves[0], staves[1]).setType('brace').setContext(ctx).draw();
          new VF.StaveConnector(staves[0], staves[1]).setType('singleLeft').setContext(ctx).draw();
        }
        const type = it.index === lastIndex ? 'boldDoubleRight' : 'singleRight';
        new VF.StaveConnector(staves[0], staves[1]).setType(type).setContext(ctx).draw();
      }

      if (it.parts.length) {
        const voices = staffNames.map((staff, si) => {
          const notes = it.parts.map((p) => {
            const midis = staffPitches(p, staff, clef);
            const rest = !midis.length;
            const n = new VF.StaveNote({
              keys: rest ? [restKey[staff]] : midis.map((m) => vexKey(m, keySig, m === p.midi ? p.pref : null)),
              duration: p.dur + (rest ? 'r' : ''),
              dots: p.dots,
              clef: staff,
              auto_stem: true,
            });
            if (p.dots) VF.Dot.buildAndAttach([n], { all: true });
            if (rest && it.parts.length === 1 && p.dur === 'w') n.setCenterAlignment?.(true);
            if (p.src === selected) {
              n.setStyle({ fillStyle: SELECT_COLOR, strokeStyle: SELECT_COLOR });
              n.setLedgerLineStyle?.({ fillStyle: SELECT_COLOR, strokeStyle: SELECT_COLOR });
            }
            n.setStave(staves[si]);
            n.setAttribute('id', `src${p.src}-${si}-${entries[si].length}`);
            entries[si].push({ part: p, note: n, line: li, midis: rest ? [] : midis });
            return n;
          });
          const voice = new VF.Voice({ num_beats: score.timeSig.num, beat_value: score.timeSig.den });
          voice.setMode(VF.Voice.Mode.SOFT);
          voice.addTickables(notes);
          voice.setStave(staves[si]);
          VF.Accidental.applyAccidentals([voice], keySig);
          let beams = [];
          try {
            beams = VF.Beam.generateBeams(notes, { groups: VF.Beam.getDefaultBeamGroups(timeStr) });
          } catch (e) {
            beams = [];
          }
          return { voice, notes, beams };
        });
        const fmt = new VF.Formatter();
        voices.forEach((v) => fmt.joinVoices([v.voice]));
        fmt.format(voices.map((v) => v.voice), staves[0].getNoteEndX() - staves[0].getNoteStartX() - 10, { context: ctx });
        voices.forEach((v, si) => {
          v.voice.draw(ctx, staves[si]);
          v.beams.forEach((b) => b.setContext(ctx).draw());
        });
        voices[0].notes.forEach((n, i) => hits.push({ line: li, x: n.getAbsoluteX() + 6, src: it.parts[i].src }));
      }
      x += w;
    });
    box.endX = x;
  });

  // Ligaduras de prolongamento (em cada pauta, liga as alturas presentes nas duas notas)
  for (const list of entries) {
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (!a.part.tie || !a.midis.length || !b.midis.length) continue;
      const first = [];
      const last = [];
      a.midis.forEach((m, ia) => {
        const ib = b.midis.indexOf(m);
        if (ib >= 0) {
          first.push(ia);
          last.push(ib);
        }
      });
      if (!first.length) continue;
      if (a.line === b.line) {
        new VF.StaveTie({ first_note: a.note, last_note: b.note, first_indices: first, last_indices: last })
          .setContext(ctx)
          .draw();
      } else {
        new VF.StaveTie({ first_note: a.note, first_indices: first }).setContext(ctx).draw();
        new VF.StaveTie({ last_note: b.note, last_indices: last }).setContext(ctx).draw();
      }
    }
  }

  // Elementos SVG de cada nota (para destacar durante a reprodução)
  const elementsBySrc = new Map();
  for (const { part, note } of entries.flat()) {
    const el = note.getSVGElement?.();
    if (!el) continue;
    if (!elementsBySrc.has(part.src)) elementsBySrc.set(part.src, []);
    elementsBySrc.get(part.src).push(el);
  }

  // Cursor de inserção
  if (caret !== null) {
    let cx, li;
    const after = hits.find((h) => h.src >= caret);
    if (after) {
      li = after.line;
      cx = after.x - 16;
    } else if (hits.length) {
      const last = hits[hits.length - 1];
      li = last.line;
      cx = Math.min(last.x + 24, lineBoxes[li].endX - 4);
    } else {
      li = 0;
      cx = SIDE + headWidth(true) + 10;
    }
    const box = lineBoxes[li];
    const ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, 'line');
    el.setAttribute('x1', cx);
    el.setAttribute('x2', cx);
    el.setAttribute('y1', box.ys[0] + 30);
    el.setAttribute('y2', box.ys[box.ys.length - 1] + 90);
    el.setAttribute('class', 'caret');
    svg.appendChild(el);
  }

  return { svg, hits, lineBoxes, elementsBySrc };
}

// Converte um toque/clique em seleção de nota ou posição de inserção.
export function hitTest(layout, clientX, clientY, noteCount) {
  const rect = layout.svg.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let li = layout.lineBoxes.findIndex((b) => y >= b.top - LINE_GAP / 2 && y < b.bottom + LINE_GAP / 2);
  if (li === -1) li = y < (layout.lineBoxes[0]?.top ?? 0) ? 0 : layout.lineBoxes.length - 1;
  const onLine = layout.hits.filter((h) => h.line === li);
  if (!onLine.length) return { caret: noteCount };
  let best = null;
  for (const h of onLine) {
    if (!best || Math.abs(h.x - x) < Math.abs(best.x - x)) best = h;
  }
  if (Math.abs(best.x - x) <= 14) return { select: best.src };
  const after = onLine.find((h) => h.x > x);
  if (after) return { caret: after.src };
  return { caret: onLine[onLine.length - 1].src + 1 };
}
