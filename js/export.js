// Exportação: MusicXML (abre no MuseScore, Finale, Sibelius...) e MIDI.

import { keyFifths, layoutMeasures, playbackEvents, spell } from './score.js';

const XML_TYPE = { w: 'whole', h: 'half', q: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' };
const TICKS = { w: 32, h: 16, q: 8, 8: 4, 16: 2, 32: 1 };

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export function toMusicXML(score) {
  const measures = layoutMeasures(score);
  const clef = score.clef === 'bass' ? '<sign>F</sign><line>4</line>' : '<sign>G</sign><line>2</line>';
  let prevTieStop = false;
  const body = measures
    .map((m, i) => {
      let attrs = '';
      if (i === 0) {
        attrs = `<attributes><divisions>8</divisions><key><fifths>${keyFifths(score.keySig)}</fifths></key>` +
          `<time><beats>${score.timeSig.num}</beats><beat-type>${score.timeSig.den}</beat-type></time>` +
          `<clef>${clef}</clef></attributes>` +
          `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>` +
          `<per-minute>${score.tempo}</per-minute></metronome></direction-type><sound tempo="${score.tempo}"/></direction>`;
      }
      const notes = m
        .map((p) => {
          const dur = TICKS[p.dur] * (p.dots ? 1.5 : 1);
          const dot = p.dots ? '<dot/>' : '';
          if (p.rest) {
            prevTieStop = false;
            return `<note><rest/><duration>${dur}</duration><type>${XML_TYPE[p.dur]}</type>${dot}</note>`;
          }
          const s = spell(p.midi, score.keySig, p.pref);
          const alter = s.alter ? `<alter>${s.alter}</alter>` : '';
          const ties = [];
          const tied = [];
          if (prevTieStop) {
            ties.push('<tie type="stop"/>');
            tied.push('<tied type="stop"/>');
          }
          if (p.tie) {
            ties.push('<tie type="start"/>');
            tied.push('<tied type="start"/>');
          }
          prevTieStop = p.tie;
          const notations = tied.length ? `<notations>${tied.join('')}</notations>` : '';
          return `<note><pitch><step>${s.letter.toUpperCase()}</step>${alter}<octave>${s.octave}</octave></pitch>` +
            `<duration>${dur}</duration>${ties.join('')}<type>${XML_TYPE[p.dur]}</type>${dot}${notations}</note>`;
        })
        .join('');
      const bar = i === measures.length - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : '';
      return `<measure number="${i + 1}">${attrs}${notes}${bar}</measure>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
<work><work-title>${esc(score.title)}</work-title></work>
<identification>${score.composer ? `<creator type="composer">${esc(score.composer)}</creator>` : ''}</identification>
<part-list><score-part id="P1"><part-name>Música</part-name></score-part></part-list>
<part id="P1">
${body}
</part>
</score-partwise>
`;
}

function varLen(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

export function toMidi(score) {
  const PPQ = 480;
  const { events } = playbackEvents(score);
  const msgs = [];
  for (const e of events) {
    if (e.midi === null) continue;
    msgs.push({ t: Math.round(e.start * PPQ), d: [0x90, e.midi, 90] });
    msgs.push({ t: Math.round((e.start + e.len) * PPQ), d: [0x80, e.midi, 0] });
  }
  msgs.sort((a, b) => a.t - b.t || a.d[0] - b.d[0]);
  const usPerQ = Math.round(60000000 / score.tempo);
  const den = Math.log2(score.timeSig.den);
  const track = [
    0, 0xff, 0x51, 3, (usPerQ >> 16) & 255, (usPerQ >> 8) & 255, usPerQ & 255,
    0, 0xff, 0x58, 4, score.timeSig.num, den, 24, 8,
    0, 0xff, 0x59, 2, keyFifths(score.keySig) & 255, 0,
  ];
  let last = 0;
  for (const m of msgs) {
    track.push(...varLen(m.t - last), ...m.d);
    last = m.t;
  }
  track.push(0, 0xff, 0x2f, 0);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
  const len = track.length;
  const trk = [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255];
  return new Uint8Array([...header, ...trk, ...track]);
}
