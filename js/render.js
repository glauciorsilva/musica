// Desenho da partitura com VexFlow (carregado globalmente em vendor/vexflow.js).

import { keyFifths, layoutMeasures, vexKey } from './score.js';

const VF = window.Vex.Flow;

const LINE_HEIGHT = 130;
const TOP = 20;
const SIDE = 8;
const SELECT_COLOR = '#1565c0';

function noteMinWidth(part) {
  return part.dur === 'w' || part.dur === 'h' ? 34 : 28;
}

export function renderScore(container, score, { selected = null, caret = null } = {}) {
  const width = Math.max(300, container.clientWidth);
  const measures = layoutMeasures(score);
  const keySig = score.keySig;
  const clef = score.clef;
  const timeStr = `${score.timeSig.num}/${score.timeSig.den}`;
  const keyWidth = 14 + Math.abs(keyFifths(keySig)) * 10;

  // Distribui os compassos em linhas conforme a largura disponível
  const avail = width - SIDE * 2;
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

  container.innerHTML = '';
  const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  const height = TOP + lines.length * LINE_HEIGHT + 10;
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  const svg = container.querySelector('svg');

  const hits = []; // { line, x, src }
  const lineBoxes = [];
  const allParts = []; // { part, note, line }
  const lastIndex = measures.length - 1;

  lines.forEach((ln, li) => {
    const y = TOP + li * LINE_HEIGHT;
    const head = headWidth(ln.items[0].index === 0);
    const isLastLine = li === lines.length - 1;
    const sumNatural = ln.items.reduce((s, it) => s + it.natural, 0);
    let scale = (avail - head) / sumNatural;
    if (isLastLine) scale = Math.min(scale, 1.5);
    let x = SIDE;
    lineBoxes.push({ top: y, bottom: y + LINE_HEIGHT, startX: SIDE });

    ln.items.forEach((it, k) => {
      const w = it.natural * scale + (k === 0 ? head : 0);
      const stave = new VF.Stave(x, y, w);
      if (k === 0) {
        stave.addClef(clef).addKeySignature(keySig);
        if (it.index === 0) stave.addTimeSignature(timeStr);
        stave.setMeasure(it.index + 1);
      }
      if (it.index === lastIndex) stave.setEndBarType(VF.Barline.type.END);
      stave.setContext(ctx).draw();

      if (it.parts.length) {
        const notes = it.parts.map((p) => {
          const restKey = clef === 'bass' ? 'd/3' : 'b/4';
          const n = new VF.StaveNote({
            keys: [p.rest ? restKey : vexKey(p.midi, keySig, p.pref)],
            duration: p.dur + (p.rest ? 'r' : ''),
            dots: p.dots,
            clef,
            auto_stem: true,
          });
          if (p.dots) VF.Dot.buildAndAttach([n], { all: true });
          if (p.rest && it.parts.length === 1 && p.dur === 'w') n.setCenterAlignment?.(true);
          if (p.src === selected) {
            n.setStyle({ fillStyle: SELECT_COLOR, strokeStyle: SELECT_COLOR });
            n.setLedgerLineStyle?.({ fillStyle: SELECT_COLOR, strokeStyle: SELECT_COLOR });
          }
          n.setAttribute('id', `src${p.src}-${allParts.length}`);
          allParts.push({ part: p, note: n, line: li });
          return n;
        });
        const voice = new VF.Voice({ num_beats: score.timeSig.num, beat_value: score.timeSig.den });
        voice.setMode(VF.Voice.Mode.SOFT);
        voice.addTickables(notes);
        VF.Accidental.applyAccidentals([voice], keySig);
        let beams = [];
        try {
          beams = VF.Beam.generateBeams(notes, { groups: VF.Beam.getDefaultBeamGroups(timeStr) });
        } catch (e) {
          beams = [];
        }
        new VF.Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        beams.forEach((b) => b.setContext(ctx).draw());
        notes.forEach((n) => {
          const p = allParts.find((a) => a.note === n).part;
          hits.push({ line: li, x: n.getAbsoluteX() + 6, src: p.src });
        });
      }
      x += w;
    });
    lineBoxes[li].endX = x;
  });

  // Ligaduras de prolongamento
  for (let i = 0; i < allParts.length - 1; i++) {
    const a = allParts[i];
    if (!a.part.tie || a.part.rest) continue;
    const b = allParts[i + 1];
    if (b.part.rest || b.part.midi !== a.part.midi) continue;
    if (a.line === b.line) {
      new VF.StaveTie({ first_note: a.note, last_note: b.note, first_indices: [0], last_indices: [0] })
        .setContext(ctx)
        .draw();
    } else {
      new VF.StaveTie({ first_note: a.note, first_indices: [0] }).setContext(ctx).draw();
      new VF.StaveTie({ last_note: b.note, last_indices: [0] }).setContext(ctx).draw();
    }
  }

  // Marca os elementos SVG de cada nota (para destacar durante a reprodução)
  const elementsBySrc = new Map();
  allParts.forEach(({ part, note }) => {
    const el = note.getSVGElement?.();
    if (!el) return;
    if (!elementsBySrc.has(part.src)) elementsBySrc.set(part.src, []);
    elementsBySrc.get(part.src).push(el);
  });

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
    const top = lineBoxes[li].top + 30;
    const ns = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', cx);
    line.setAttribute('x2', cx);
    line.setAttribute('y1', top);
    line.setAttribute('y2', top + 60);
    line.setAttribute('class', 'caret');
    svg.appendChild(line);
  }

  return { svg, hits, lineBoxes, elementsBySrc };
}

// Converte um toque/clique em seleção de nota ou posição de inserção.
export function hitTest(layout, clientX, clientY, noteCount) {
  const rect = layout.svg.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let li = layout.lineBoxes.findIndex((b) => y >= b.top && y < b.bottom);
  if (li === -1) li = layout.lineBoxes.length - 1;
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
