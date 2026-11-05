'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { atomicJSON } = require('./recorder.cjs');
const path = require('node:path');
const { createPlaybackCard } = require('./presentation.cjs');
function srt(captions) {
  const stamp = s => { const m = Math.round(s * 1000); return `${String(Math.floor(m / 3600000)).padStart(2, '0')}:${String(Math.floor(m / 60000) % 60).padStart(2, '0')}:${String(Math.floor(m / 1000) % 60).padStart(2, '0')},${String(m % 1000).padStart(3, '0')}`; };
  return captions.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.replace(/\r?\n/g, ' ')}\n`).join('\n');
}
function encoderPath() { return require('ffmpeg-static').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'); }
async function archive(entry) {
  const { data, metaFile } = entry;
  const wav = metaFile.replace(/\.json$/, '.wav'), output = metaFile.replace(/\.json$/, '.mp4'), temp = metaFile.replace(/\.json$/, '.encoding.mp4');
  const input = fs.existsSync(wav) ? wav : output;
  const captionFile = metaFile.replace(/\.json$/, '.srt');
  const cardFile = metaFile.replace(/\.json$/, '.playback.png');
  if (!data.frames) return;
  if (data.captions?.length) fs.writeFileSync(captionFile, srt(data.captions));
  await createPlaybackCard(cardFile, data);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input];
  args.push('-loop', '1', '-framerate', '10', '-i', cardFile);
  if (data.captions?.length) args.push('-i', captionFile);
  // The complete UTC/sample mapping survives a single-file export.
  const embedded = { ...data, mediaFile: data.id + '.mp4', archive: 'complete', captionPresentation: 'visible video captions + optional mov_text track' };
  // Avoid OS command-length limits by passing metadata through a local ffmetadata file.
  const metadataFile = metaFile.replace(/\.json$/, '.ffmeta');
  const escape = value => String(value).replace(/[\\=;#\n]/g, c => '\\' + c);
  const location = data.locations?.findLast(point => Number.isFinite(point.latitude));
  const iso6709 = location ? `${location.latitude >= 0 ? '+' : ''}${location.latitude.toFixed(5)}${location.longitude >= 0 ? '+' : ''}${location.longitude.toFixed(5)}/` : '';
  fs.writeFileSync(metadataFile, `;FFMETADATA1\ntitle=${escape(data.name + (data.frequency ? ' · ' + data.frequency : ''))}\ncreation_time=${data.startedUTC}\n${iso6709 ? 'location=' + iso6709 + '\n' : ''}comment=${escape(JSON.stringify(embedded))}\n`);
  const metadataIndex = data.captions?.length ? 3 : 2;
  args.push('-f', 'ffmetadata', '-i', metadataFile, '-map', '0:a:0', '-c:a', input === output ? 'copy' : 'aac');
  if (input !== output) args.push('-b:a', data.format.channels === 2 ? '128k' : '64k');
  args.push('-map', '1:v:0', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '28', '-pix_fmt', 'yuv420p', '-t', String(data.duration));
  if (data.captions?.length) {
    args.push('-vf', `subtitles=filename='${path.basename(captionFile)}':force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00F0F5EC,OutlineColour=&H00101712,BorderStyle=1,Outline=1,Alignment=2,MarginV=48'`);
    args.push('-map', '2:0', '-c:s', 'mov_text', '-disposition:s:0', '0', '-metadata:s:s:0', 'language=und', '-metadata:s:s:0', 'handler_name=Transcript');
  }
  args.push('-map_metadata', String(metadataIndex), '-movflags', '+faststart+use_metadata_tags', temp);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(encoderPath(), args, { windowsHide: true, cwd: path.dirname(metaFile) }); let stderr = '';
      child.stderr.on('data', value => { stderr = (stderr + value).slice(-4000); });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('MP4 encoding failed: ' + stderr)));
    });
    fs.renameSync(temp, output);
    // A bookmark or transcript may have arrived while the encoder was running.
    const latest = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : data;
    latest.mediaFile = data.id + '.mp4'; latest.archive = 'complete'; latest.captionPresentation = embedded.captionPresentation; atomicJSON(metaFile, latest);
    // Keep PCM until transcription finishes; never delete the only recoverable audio.
    if (fs.existsSync(wav) && ['complete', 'not-requested'].includes(data.transcription)) fs.unlinkSync(wav);
  } finally {
    for (const file of [temp, metadataFile, cardFile]) { try { fs.unlinkSync(file); } catch {} }
  }
}
async function readEmbeddedMetadata(file) {
  const { stdout } = await promisify(execFile)(encoderPath(), ['-v', 'error', '-i', file, '-f', 'ffmetadata', '-'], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const line = stdout.split('\n').find(value => value.startsWith('comment='));
  if (!line) throw new Error('This MP4 has no RadioRecorder metadata.');
  const data = JSON.parse(line.slice(8).replace(/\\(.)/g, '$1'));
  if (data.schemaVersion !== 1 || !/^[a-zA-Z\d_-]+$/.test(data.id) || !Array.isArray(data.spans) || !Array.isArray(data.captions) || !Number.isFinite(data.duration) || !data.format || ![16000,44100,48000].includes(data.format.sampleRate)) throw new Error('Invalid RadioRecorder metadata.');
  return data;
}
module.exports = { archive, srt, readEmbeddedMetadata };
