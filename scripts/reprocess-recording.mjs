import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pipeline, env } from '@huggingface/transformers';
import { transcribeRecording } from '../app/core/recording-transcript.mjs';
const require = createRequire(import.meta.url);
const { archive, readEmbeddedMetadata } = require('../app/core/archive.cjs');
const { decodeRecordingCW } = require('../app/core/recording-cw.cjs');
const { MODEL_ID } = require('../app/core/model.cjs');
const source = process.argv[2], folder = process.argv[3];
if (!source || !folder) throw new Error('Usage: node scripts/reprocess-recording.mjs source.mp4 destination-folder');
const original = await readEmbeddedMetadata(path.resolve(source));
const metadata = { ...original, id: original.id + '__reprocessed-' + randomUUID().slice(0,8), name: original.name + ' (reprocessed)', derivedFrom: original.id, status: 'complete' };
const destination = path.resolve(folder), file = path.join(destination, metadata.id + '.mp4'), metaFile = path.join(destination, metadata.id + '.json');
const decoded = path.join(os.tmpdir(), 'radiorecorder-reprocess-' + randomUUID() + '.wav');
let model;
try {
  fs.mkdirSync(destination, { recursive: true });
  execFileSync(require('ffmpeg-static'), ['-v','error','-i',path.resolve(source),'-vn','-map_metadata','-1','-ar','16000','-ac','1','-c:a','pcm_s16le',decoded]);
  env.cacheDir = process.env.SCANNER_MODEL_CACHE || path.resolve('test-results/transcription/models');
  model = await pipeline('automatic-speech-recognition', MODEL_ID, { dtype: 'q8', device: 'cpu', local_files_only: true });
  const recovered = decodeRecordingCW(metadata, decoded);
  metadata.stationIdentifiers = [...(metadata.stationIdentifiers || []).filter(old => !recovered.some(id => id.text === old.text && id.start < old.end && id.end > old.start)), ...recovered].sort((a,b)=>a.start-b.start);
  metadata.captions = await transcribeRecording(model, metadata, decoded);
  for (const id of metadata.stationIdentifiers) metadata.captions.push({ kind: 'cw', text: `[CW station ID candidate: ${id.text}]`, start: id.start, end: id.end, startUTC: id.startUTC, endUTC: id.endUTC });
  metadata.captions.sort((a,b)=>a.start-b.start);
  Object.assign(metadata, { transcription: 'complete', transcriptModel: MODEL_ID, transcribedUTC: new Date().toISOString(), transcribedThrough: metadata.duration, captionTiming: 'word-aligned', needsFinalAlignment: false, mediaFile: metadata.id + '.mp4' });
  fs.copyFileSync(path.resolve(source), file); // AAC is stream-copied by archive().
  fs.writeFileSync(metaFile, JSON.stringify(metadata, null, 2));
  await archive({ data: metadata, file, metaFile });
  console.log(JSON.stringify({ file, captionCount: metadata.captions.length, stationIdentifiers: metadata.stationIdentifiers.map(id => ({ text: id.text, start: id.start, end: id.end })) }));
} finally {
  await model?.dispose();
  try { fs.unlinkSync(decoded); } catch {}
}
