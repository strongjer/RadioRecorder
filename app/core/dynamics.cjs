'use strict';
// Stereo-linked zero-delay leveler, soft-knee compressor and peak limiter.
// The gate analyzes raw levels first. No audio delay changes UTC mappings.
class DynamicsProcessor {
  constructor(rate, channels) { this.rate = rate; this.channels = channels; this.levelGainDB = 0; this.envelope = 0; this.compressionDB = 0; this.limiterGain = 1; this.reductionDB = 0; }
  process(samples, config) {
    if (config.dynamics === false) return samples;
    const out = new Float32Array(samples.length);
    const maxBoost = config.maxBoost ?? 12, threshold = -18, knee = 9, ratio = 4, ceiling = Math.pow(10, -1 / 20);
    let sum = 0; for (const x of samples) sum += x * x;
    const rms = 10 * Math.log10(Math.max(1e-12, sum / (samples.length || 1)));
    const wanted = rms > Math.max(-60, config.thresholdDB - 6) ? Math.max(-18, Math.min(maxBoost, -20 - rms)) : this.levelGainDB;
    const envAttack = Math.exp(-1 / (this.rate * 0.003)), envRelease = Math.exp(-1 / (this.rate * 0.15));
    const attack = Math.exp(-1 / (this.rate * 0.005)), release = Math.exp(-1 / (this.rate * 0.2));
    const level = Math.exp(-1 / (this.rate * (wanted < this.levelGainDB ? 0.008 : 0.15)));
    const limiterRelease = Math.exp(-1 / (this.rate * 0.08));
    for (let frame = 0; frame < samples.length; frame += this.channels) {
      this.levelGainDB = wanted + level * (this.levelGainDB - wanted);
      const boost = Math.pow(10, this.levelGainDB / 20); let peak = 0;
      for (let c = 0; c < this.channels; c++) peak = Math.max(peak, Math.abs(samples[frame + c] * boost));
      const env = peak > this.envelope ? envAttack : envRelease;
      this.envelope = peak + env * (this.envelope - peak);
      const over = 20 * Math.log10(Math.max(1e-9, this.envelope)) + 18;
      const reduction = over > knee / 2 ? over * (1 - 1 / ratio) : over > -knee / 2 ? (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee) : 0;
      const coefficient = reduction > this.compressionDB ? attack : release;
      this.compressionDB = reduction + coefficient * (this.compressionDB - reduction);
      const compression = Math.pow(10, -this.compressionDB / 20);
      const required = peak * compression > ceiling ? ceiling / (peak * compression) : 1;
      this.limiterGain = required < this.limiterGain ? required : required + limiterRelease * (this.limiterGain - required);
      const gain = boost * compression * this.limiterGain;
      for (let c = 0; c < this.channels; c++) out[frame + c] = samples[frame + c] * gain;
    }
    this.reductionDB = this.compressionDB - 20 * Math.log10(Math.max(1e-9, this.limiterGain)); return out;
  }
}
module.exports = { DynamicsProcessor };
