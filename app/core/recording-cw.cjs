'use strict';
const { readMono16k } = require('./wav.cjs');
const { frameToUTC } = require('./audio.cjs');
const { MorseDetector } = require('./morse.cjs');
function decodeRecordingCW(metadata, file) {
  const identifiers = [], rate = metadata.format.sampleRate;
  const sourceFrame = (seconds, end = false) => {
    const frame = Math.round(seconds * rate);
    const span = metadata.spans.find(s => end ? frame > s.outputStart && frame <= s.outputEnd : frame >= s.outputStart && frame < s.outputEnd);
    return span ? span.sourceStart + frame - span.outputStart : null;
  };
  const detector = new MorseDetector(16000, 1, identifier => {
    const start = identifier.sourceStart / 16000, end = identifier.sourceEnd / 16000;
    identifiers.push({ ...identifier, start, end,
      sourceStart: sourceFrame(start), sourceEnd: sourceFrame(end, true),
      startUTC: frameToUTC(metadata.spans, start * rate, rate),
      endUTC: frameToUTC(metadata.spans, end * rate, rate, 'end'),
      decodedFrom: 'saved-audio', method: 'final saved-audio CW recovery; verify against audio' });
  });
  for (let offset = 0; offset < metadata.duration; offset += 3) {
    detector.ingest(readMono16k(file, offset, Math.min(3, metadata.duration - offset)), Math.round(offset * 16000), -65);
  }
  detector.ingest(new Float32Array(32000), Math.round(metadata.duration * 16000), -65);
  detector.flush();
  return identifiers;
}
module.exports = { decodeRecordingCW };
