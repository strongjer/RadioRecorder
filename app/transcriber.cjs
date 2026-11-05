'use strict';
// Runs outside the capture/UI process. A model download is an explicit action;
// subsequent transcription uses only the cached model and local PCM excerpts.
const { readMono16k } = require('./core/wav.cjs');
const { groupAlignedWords } = require('./core/captions.cjs');
const { frameToUTC } = require('./core/audio.cjs');
const { MODEL_ID } = require('./core/model.cjs');
const { decodeRecordingCW } = require('./core/recording-cw.cjs');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const os = require('node:os'), path = require('node:path');
let pipeline;
function send(data) { process.parentPort.postMessage(data); }
async function load(download) {
  if (pipeline) return;
  const transformers = await import('@huggingface/transformers');
  transformers.env.cacheDir = process.env.SCANNER_MODEL_CACHE;
  pipeline = await transformers.pipeline('automatic-speech-recognition', MODEL_ID, {
    dtype: 'q8', device: 'cpu', local_files_only: !download,
    progress_callback: event => send({ type: 'progress', file: event.file, progress: event.progress, status: event.status }),
  });
}
let queue = Promise.resolve();
process.parentPort.on('message', ({ data }) => {
  queue = queue.then(async () => {
    try {
      await load(data.type === 'download');
      if (data.type === 'download') { send({ type: 'ready' }); return; }
      const { metadata } = data;
      let file = data.file, decoded;
      if (file.endsWith('.mp4')) {
        decoded = path.join(os.tmpdir(), 'scanner-decode-' + randomUUID() + '.wav');
        await new Promise((resolve, reject) => {
          const encoder = require('ffmpeg-static').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
          const child = spawn(encoder, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', decoded], { windowsHide: true });
          let error = ''; child.stderr.on('data', value => error += value); child.on('error', reject); child.on('exit', code => code ? reject(new Error(error)) : resolve());
        });
        file = decoded;
      }
      try {
      const { transcribeRecording } = await import('./core/recording-transcript.mjs');
      if(data.finalPass){
        const recovered=decodeRecordingCW(metadata,file);
        metadata.stationIdentifiers=[...(metadata.stationIdentifiers||[]).filter(old=>!recovered.some(id=>id.text===old.text&&id.start<old.end&&id.end>old.start)),...recovered].sort((a,b)=>a.start-b.start);
      }
      const captions = await transcribeRecording(pipeline, metadata, file, {
        rangeStart: data.rangeStart || 0, rangeEnd: data.rangeEnd ?? metadata.duration,
        onProgress: progress => send({type:'transcription-progress',id:metadata.id,progress})
      });
      if(data.finalPass)for(const id of metadata.stationIdentifiers||[])captions.push({kind:'cw',text:`[CW station ID candidate: ${id.text}]`,start:id.start,end:id.end,startUTC:id.startUTC,endUTC:id.endUTC});
      captions.sort((a,b)=>a.start-b.start);
      send({ type: 'transcribed', id: metadata.id, captions, ...(data.finalPass?{stationIdentifiers:metadata.stationIdentifiers}:{}), rangeStart: data.rangeStart || 0, rangeEnd: data.rangeEnd ?? metadata.duration, model: MODEL_ID, timing: 'word-aligned', finalPass: !!data.finalPass, generatedUTC: new Date().toISOString() });
      } finally { if (decoded) { try { fs.unlinkSync(decoded); } catch {} } }
    } catch (error) { send({ type: 'error', id: data.metadata?.id, message: error.message }); }
  });
});
