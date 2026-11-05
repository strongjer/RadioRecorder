'use strict';

const DEFAULTS = Object.freeze({ thresholdDB: -50, autoGate: true, release: 0.4, preRoll: 0.25, vox: true, dc: true, dynamics: true, maxBoost: 12, sampleRate: 16000, channels: 1, bits: 16 });
function settings(input = {}) {
  const number = (key, min, max) => Number.isFinite(Number(input[key])) ? Math.min(max, Math.max(min, Number(input[key]))) : DEFAULTS[key];
  return {
    thresholdDB: number('thresholdDB', -80, -6), release: number('release', 0, 10), preRoll: number('preRoll', 0, 1),
    autoGate: input.autoGate !== false,
    language: ['en','es','fr','de','pt','it','ja','zh','ko','ru','ar'].includes(input.language) ? input.language : 'auto',
    vox: typeof input.vox === 'boolean' ? input.vox : DEFAULTS.vox,
    dc: typeof input.dc === 'boolean' ? input.dc : DEFAULTS.dc,
    dynamics: typeof input.dynamics === 'boolean' ? input.dynamics : DEFAULTS.dynamics,
    maxBoost: Number.isFinite(input.maxBoost) ? Math.min(24, Math.max(0, input.maxBoost)) : DEFAULTS.maxBoost,
    sampleRate: [16000, 44100, 48000].includes(input.sampleRate) ? input.sampleRate : DEFAULTS.sampleRate,
    channels: input.channels === 2 ? 2 : 1, bits: input.bits === 24 ? 24 : 16,
  };
}
function rmsDB(samples) {
  let sum = 0;
  for (const x of samples) sum += x * x;
  return Math.max(-96, 10 * Math.log10(Math.max(1e-12, sum / (samples.length || 1))));
}
class DCBlocker {
  constructor(rate, channels) { this.x = new Float32Array(channels); this.y = new Float32Array(channels); this.channels = channels; this.r = Math.exp(-2 * Math.PI * 20 / rate); }
  process(input) {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const c = i % this.channels, x = Number.isFinite(input[i]) ? input[i] : 0;
      out[i] = x - this.x[c] + this.r * this.y[c]; this.x[c] = x; this.y[c] = out[i];
    }
    return out;
  }
}
class VoiceGate {
  constructor(rate, channels) { this.rate = rate; this.channels = channels; this.history = new Float32Array(0); this.reset(); }
  reset() { this.open = false; this.remaining = 0; this.count = 0; this.index = 0; }
  process(samples, config, sourceFrame, activity) {
    const capacity = Math.round(config.preRoll * this.rate) * this.channels;
    if (capacity !== this.history.length) { this.history = new Float32Array(capacity); this.count = this.index = 0; }
    const frames = samples.length / this.channels;
    const above = !config.vox || (typeof activity === 'boolean' ? activity : rmsDB(samples) >= config.thresholdDB);
    const wasOpen = this.open;
    let audio = new Float32Array(0), startFrame = sourceFrame;
    if (above) {
      if (!this.open) {
        audio = new Float32Array(this.count + samples.length);
        const first = (this.index - this.count + capacity) % capacity;
        for (let i = 0; i < this.count; i++) audio[i] = this.history[(first + i) % capacity];
        startFrame -= this.count / this.channels;
        audio.set(samples, this.count); this.count = this.index = 0;
      } else audio = samples;
      this.open = true; this.remaining = Math.round(config.release * this.rate);
    } else if (this.open) {
      const keep = Math.min(frames, this.remaining);
      audio = samples.subarray(0, keep * this.channels); this.remaining -= keep;
      if (this.remaining === 0) { this.open = false; this.remember(samples.subarray(keep * this.channels)); }
    } else this.remember(samples);
    return { audio, startFrame, opened: !wasOpen && this.open, closed: wasOpen && !this.open, open: this.open };
  }
  remember(samples) {
    if (!this.history.length) return;
    for (const x of samples) { this.history[this.index] = x; this.index = (this.index + 1) % this.history.length; this.count = Math.min(this.count + 1, this.history.length); }
  }
}

// At a removed-silence boundary, starts map to the next span, ends to the
// preceding span. This prevents a caption's end jumping across a VOX gap.
function frameToUTC(spans, frame, rate, edge = 'start') {
  if (!spans.length) return null;
  let span = spans.find(s => edge === 'end' ? frame > s.outputStart && frame <= s.outputEnd : frame >= s.outputStart && frame < s.outputEnd);
  span ||= frame <= 0 ? spans[0] : spans[spans.length - 1];
  const relative = Math.max(0, Math.min(frame - span.outputStart, span.outputEnd - span.outputStart));
  return new Date(span.captureStartUTC + relative / rate * 1000).toISOString();
}
module.exports = { DEFAULTS, settings, rmsDB, DCBlocker, VoiceGate, frameToUTC };
