const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { WAVWriter, readMono16k } = require('../app/core/wav.cjs');
const { speechRegions } = require('../app/core/speech-regions.cjs');
const { decodeRecordingCW } = require('../app/core/recording-cw.cjs');
const { LETTERS } = require('../app/core/morse.cjs');
const codes = Object.fromEntries(Object.entries(LETTERS).map(([code, letter]) => [letter, code]));
function cw(text, rate = 16000) {
  const chunks = []; let length = 0;
  const append = (duration, on) => {
    const chunk = Float32Array.from({ length: Math.round(duration * rate) }, (_, n) => on ? .18 * Math.sin(2 * Math.PI * 1000 * n / rate) : 0);
    chunks.push(chunk); length += chunk.length;
  };
  for (const letter of text) for (let i = 0; i < codes[letter].length; i++) { append(codes[letter][i] === '.' ? .05 : .15, true); append(i === codes[letter].length - 1 ? .15 : .05, false); }
  const result = new Float32Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
}
test('Neural speech evidence keeps spoken words while rejecting CW and stationary noise', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-speech-'));
  try {
    const rate = 16000, voice = readMono16k(path.join(__dirname, 'fixtures/synthetic-speech.wav'), 0, 10), tones = cw('K7ABC/R');
    const voiceStart = 3, toneStart = voiceStart + voice.length / rate + 1;
    const data = new Float32Array(Math.ceil((toneStart + tones.length / rate + 2) * rate));
    let seed = 1949; for (let i = 0; i < data.length; i++) { seed = (1664525 * seed + 1013904223) >>> 0; data[i] = (seed / 4294967296 - .5) * .006; }
    for (let i = 0; i < voice.length; i++) data[voiceStart * rate + i] += voice[i] * .25;
    for (let i = 0; i < tones.length; i++) data[Math.round(toneStart * rate) + i] += tones[i];
    const file = path.join(folder, 'synthetic.wav'), writer = new WAVWriter(file, { sampleRate: rate, channels: 1, bits: 16 }); writer.write(data); writer.close();
    const regions = await speechRegions(file, 0, data.length / rate);
    assert.ok(regions.some(r => r.start <= voiceStart + .4 && r.end >= voiceStart + voice.length / rate - .4), JSON.stringify(regions));
    assert.ok(regions.every(r => r.end < toneStart + .1), JSON.stringify(regions));
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
test('Saved-audio CW recovery timestamps the actual identifier after false blips and a VOX gap', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-cw-recovery-'));
  try {
    const rate = 16000, tones = cw('K7ABC/R'), data = new Float32Array(5 * rate + tones.length + 2 * rate);
    for (let i = 0; i < 160; i++) data[2 * rate + i] = .2 * Math.sin(2 * Math.PI * 1000 * i / rate);
    data.set(tones, 5 * rate);
    const file = path.join(folder, 'synthetic.wav'), writer = new WAVWriter(file, { sampleRate: rate, channels: 1, bits: 16 }); writer.write(data); writer.close();
    const epoch = 1700000000000, metadata = { duration: data.length / rate, format: { sampleRate: rate }, spans: [
      { outputStart: 0, outputEnd: rate, sourceStart: 0, sourceEnd: rate, captureStartUTC: epoch },
      { outputStart: rate, outputEnd: data.length, sourceStart: 11 * rate, sourceEnd: data.length + 10 * rate, captureStartUTC: epoch + 11000 },
    ] };
    const result = decodeRecordingCW(metadata, file).find(id => id.text === 'K7ABC/R');
    assert.ok(result); assert.ok(Math.abs(result.start - 5) < .03, JSON.stringify(result));
    assert.equal(Date.parse(result.startUTC), epoch + result.start * 1000 + 10000);
    assert.equal(result.sourceStart, Math.round((result.start + 10) * rate));
    assert.equal(result.decodedFrom, 'saved-audio');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
