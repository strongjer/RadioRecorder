'use strict';
const fs = require('node:fs'), path = require('node:path');
const ort = require('onnxruntime-node');
const { readMono16k } = require('./wav.cjs');
let model;
async function speechRegions(file, begin, end) {
  model ||= ort.InferenceSession.create(fs.readFileSync(path.join(__dirname, 'models/silero_vad.onnx')), { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1 }).catch(error => { model = null; throw error; });
  const session = await model, regions = [];
  let state = new ort.Tensor('float32', new Float32Array(256), [2,1,128]), context = new Float32Array(64), first = null, lastVoice = begin;
  const sr = new ort.Tensor('int64', BigInt64Array.of(16000n), []);
  const commit = () => { if (first !== null && lastVoice - first >= .15) regions.push({ start: Math.max(begin, first - .18), end: Math.min(end, lastVoice + .2) }); first = null; };
  // 96 complete 512-sample windows per read keep recurrent context continuous.
  for (let offset = begin; offset < end; offset += 3.072) {
    const audio = readMono16k(file, offset, Math.min(3.072, end - offset));
    for (let n = 0; n < audio.length; n += 512) {
      const input = new Float32Array(576); input.set(context); input.set(audio.subarray(n, n + 512), 64);
      const result = await session.run({ input: new ort.Tensor('float32', input, [1,576]), state, sr });
      state = result.stateN; context = input.slice(-64);
      const time = offset + n / 16000, probability = result.output.data[0];
      if (probability >= (first === null ? .5 : .35)) { if (first === null) first = time; lastVoice = Math.min(end, time + .032); }
      else if (first !== null && time - lastVoice > .3) commit();
    }
  }
  commit(); return regions;
}
module.exports = { speechRegions };
