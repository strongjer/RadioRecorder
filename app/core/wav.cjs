'use strict';
const fs = require('node:fs');

class WAVWriter {
  constructor(file, { sampleRate, channels, bits }) {
    this.rate = sampleRate; this.channels = channels; this.bits = bits; this.frames = 0; this.checkpointFrames = 0; this.closed = false;
    this.fd = fs.openSync(file, 'wx');
    try { fs.writeSync(this.fd, this.header()); } catch (error) { fs.closeSync(this.fd); this.closed = true; throw error; }
  }
  header() {
    const h = Buffer.alloc(44), bytes = this.frames * this.channels * this.bits / 8;
    h.write('RIFF'); h.writeUInt32LE(36 + bytes, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); h.writeUInt16LE(this.channels, 22); h.writeUInt32LE(this.rate, 24);
    h.writeUInt32LE(this.rate * this.channels * this.bits / 8, 28); h.writeUInt16LE(this.channels * this.bits / 8, 32);
    h.writeUInt16LE(this.bits, 34); h.write('data', 36); h.writeUInt32LE(bytes, 40); return h;
  }
  write(samples) {
    if (this.closed || samples.length % this.channels) throw new Error('Invalid PCM buffer.');
    const size = this.bits / 8, data = Buffer.allocUnsafe(samples.length * size);
    if (this.frames * this.channels * size + data.length > 0xffffffff - 36) throw new Error('WAV reached its 4 GB limit. Start a new recording.');
    for (let i = 0; i < samples.length; i++) {
      const x = Math.min(1, Math.max(-1, Number.isFinite(samples[i]) ? samples[i] : 0));
      const max = this.bits === 16 ? 32767 : 8388607;
      data.writeIntLE(Math.round(x * (x < 0 ? max + 1 : max)), i * size, size);
    }
    let written = 0;
    while (written < data.length) written += fs.writeSync(this.fd, data, written, data.length - written, 44 + this.frames * this.channels * size + written);
    this.frames += samples.length / this.channels;
    if (this.frames - this.checkpointFrames >= this.rate) this.checkpoint();
  }
  checkpoint() { fs.writeSync(this.fd, this.header(), 0, 44, 0); this.checkpointFrames = this.frames; }
  close() { if (this.closed) return; try { this.checkpoint(); fs.fsyncSync(this.fd); } finally { this.closed = true; fs.closeSync(this.fd); } }
}

// Read a bounded excerpt, never an entire unattended recording into memory.
// A windowed-sinc low-pass resampler prevents aliasing when feeding Whisper.
function readMono16k(file, startSeconds, duration) {
  const fd = fs.openSync(file, 'r');
  try {
    const h = Buffer.alloc(12); fs.readSync(fd, h, 0, 12, 0);
    if (h.toString('ascii', 0, 4) !== 'RIFF' || h.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected a PCM WAV.');
    const fileSize = fs.fstatSync(fd).size;
    let channels, rate, size, dataOffset, dataBytes;
    for (let position = 12; position + 8 <= fileSize && position < 16 * 1024 * 1024;) {
      const chunk = Buffer.alloc(8); fs.readSync(fd, chunk, 0, 8, position);
      const name = chunk.toString('ascii', 0, 4), length = chunk.readUInt32LE(4);
      if (name === 'fmt ') {
        const format = Buffer.alloc(16); fs.readSync(fd, format, 0, 16, position + 8);
        if (format.readUInt16LE(0) !== 1) throw new Error('Expected integer PCM audio.');
        channels = format.readUInt16LE(2); rate = format.readUInt32LE(4); size = format.readUInt16LE(14) / 8;
      }
      if (name === 'data') { dataOffset = position + 8; dataBytes = Math.min(length, fileSize - dataOffset); break; }
      position += 8 + length + length % 2;
    }
    if (!dataOffset || ![1,2].includes(channels) || ![2,3].includes(size) || !rate) throw new Error('Unsupported or incomplete PCM WAV.');
    const total = dataBytes / (channels * size), start = Math.floor(startSeconds * rate);
    const frames = Math.max(0, Math.min(Math.ceil(duration * rate), total - start));
    const pcm = Buffer.alloc(frames * channels * size); fs.readSync(fd, pcm, 0, pcm.length, dataOffset + start * channels * size);
    const mono = new Float32Array(frames), divisor = size === 2 ? 32768 : 8388608;
    for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) mono[i] += pcm.readIntLE((i * channels + c) * size, size) / divisor / channels;
    if (rate === 16000) return mono;
    const result = new Float32Array(Math.floor(frames * 16000 / rate)), ratio = rate / 16000, cutoff = Math.min(1, 1 / ratio) * 0.94, radius = 24;
    for (let i = 0; i < result.length; i++) {
      const center = i * ratio; let sum = 0, weight = 0;
      for (let j = Math.ceil(center - radius); j <= Math.floor(center + radius); j++) {
        if (j < 0 || j >= mono.length) continue;
        const d = j - center, z = Math.PI * d * cutoff;
        const w = (Math.abs(z) < 1e-9 ? cutoff : Math.sin(z) / (Math.PI * d)) * (0.5 + 0.5 * Math.cos(Math.PI * d / radius));
        sum += mono[j] * w; weight += w;
      }
      result[i] = weight ? sum / weight : 0;
    }
    return result;
  } finally { fs.closeSync(fd); }
}
module.exports = { WAVWriter, readMono16k };
