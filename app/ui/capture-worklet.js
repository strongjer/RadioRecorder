class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.channels = options.processorOptions.channels; this.demo = options.processorOptions.demo; this.seed = options.processorOptions.seed || 1;
    this.buffer = new Float32Array(1024 * this.channels); this.offset = 0; this.start = 0;
    this.port.onmessage = ({ data }) => { if (data === 'flush') { this.flush(); this.port.postMessage({ flushed: true }); } };
  }
  flush() {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset); this.port.postMessage({ samples, frame: this.start }, [samples.buffer]); this.offset = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    for (let f = 0; f < 128; f++) {
      if (!this.offset) this.start = currentFrame + f;
      for (let c = 0; c < this.channels; c++) {
        let sample = input?.[c]?.[f] ?? input?.[0]?.[f] ?? 0;
        if (this.demo) {
          const t = (currentFrame + f) / sampleRate, burst = (t + this.seed * 1.7) % 7;
          sample = burst < 3.6 ? (Math.sin(t * 2 * Math.PI * (240 + this.seed * 50)) * 0.16 + Math.sin(t * 2 * Math.PI * 930) * 0.05) * (0.3 + 0.7 * Math.sin(t * 10) ** 2) : Math.sin(t * 19289) * 0.0007;
        }
        this.buffer[this.offset++] = sample;
      }
      if (this.offset === this.buffer.length) this.flush();
    }
    for (const output of outputs[0] || []) output.fill(0); // No live feedback to the speakers.
    return true;
  }
}
registerProcessor('scanner-capture', CaptureProcessor);
