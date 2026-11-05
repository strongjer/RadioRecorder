'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { settings, rmsDB, DCBlocker, VoiceGate } = require('./audio.cjs');
const { WAVWriter } = require('./wav.cjs');
const { DynamicsProcessor } = require('./dynamics.cjs');
const { MorseDetector } = require('./morse.cjs');
const { createActivityDetector } = require('./activity.cjs');

function atomicJSON(file, object) {
  const temporary = file + '.' + process.pid + '-' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, JSON.stringify(object, null, 2), { flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch {} }
}
class ChannelRecorder {
  constructor(id, notify) { this.id = id; this.notify = notify; this.config = settings(); this.paused = false; this.session = null; this.lastNotify = 0; this.lastMetadata = 0; this.lastFrame = null; }
  configure(config) {
    const next = settings(config);
    if (this.session) { next.sampleRate = this.config.sampleRate; next.channels = this.config.channels; next.bits = this.config.bits; }
    const changed = JSON.stringify(this.config) !== JSON.stringify(next);
    this.config = next;
    if (changed && this.session) this.event('settings', { settings: next });
  }
  start({ folder, name, frequency, source, clockOriginUTC, groupId, config }) {
    if (this.session) throw new Error('This input is already recording.');
    this.configure(config);
    const slug = value => String(value || '').normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    const id = [slug(name) || 'Receiver', slug(frequency) || 'unspecified', new Date().toISOString().replace(/[:.]/g, '-'), randomUUID().slice(0, 8)].join('__');
    fs.mkdirSync(folder, { recursive: true });
    this.file = path.join(folder, id + '.wav'); this.metaFile = path.join(folder, id + '.json');
    this.writer = new WAVWriter(this.file, this.config);
    this.gate = new VoiceGate(this.config.sampleRate, this.config.channels);
    this.filter = new DCBlocker(this.config.sampleRate, this.config.channels);
    this.dynamics = new DynamicsProcessor(this.config.sampleRate, this.config.channels);
    this.activity = createActivityDetector(this.config.sampleRate, this.config.channels);
    this.morse = new MorseDetector(this.config.sampleRate, this.config.channels, identifier => {
      if (!this.session) return;
      const startUTC = new Date(this.session.clockOriginUTC + identifier.sourceStart / this.config.sampleRate * 1000).toISOString();
      const endUTC = new Date(this.session.clockOriginUTC + identifier.sourceEnd / this.config.sampleRate * 1000).toISOString();
      const point = this.session.spans.find(span => identifier.sourceStart >= span.sourceStart && identifier.sourceStart < span.sourceEnd);
      const finish = this.session.spans.find(span => identifier.sourceEnd > span.sourceStart && identifier.sourceEnd <= span.sourceEnd);
      const start = point ? (point.outputStart + identifier.sourceStart - point.sourceStart) / this.config.sampleRate : null;
      const end = finish ? (finish.outputStart + identifier.sourceEnd - finish.sourceStart) / this.config.sampleRate : this.writer.frames / this.config.sampleRate;
      const entry = { ...identifier, startUTC, endUTC, start, end };
      this.session.stationIdentifiers ||= []; this.session.stationIdentifiers.push(entry);
      if (start !== null) this.session.captions.push({ kind: 'cw', text: `[CW station ID candidate: ${identifier.text}]`, start, end, startUTC, endUTC });
      this.event('cw-identifier', entry);
    });
    this.paused = false; this.lastFrame = null; this.lastMetadata = 0;
    this.stopping = false;
    this.noiseHistory = []; this.noiseFloorDB = -65;
    this.session = { schemaVersion: 1, id, groupId, channelId: this.id, name: String(name).slice(0, 100), source: String(source).slice(0, 200),
      frequency: String(frequency || '').slice(0, 60), mediaFile: id + '.wav', startedUTC: new Date().toISOString(), clockOriginUTC, clockBasis: 'host UTC anchored to AudioContext sample clock; device latency uncalibrated',
      format: { ...this.config }, activityDetection: this.activity ? 'WebRTC speech detector + radio tone preservation' : 'level threshold', status: 'recording', frames: 0, duration: 0, transmissions: 0, spans: [], events: [], captions: [], waveform: [], transcription: 'not-started' };
    this.log = fs.openSync(path.join(folder, id + '.log'), 'wx');
    this.event('session-start', { settings: this.config }); this.save(); return this.session.id;
  }
  event(type, detail = {}) {
    if (!this.session) return;
    const event = { utc: new Date().toISOString(), type, sourceFrame: this.lastFrame, outputFrame: this.writer.frames, ...detail };
    this.session.events.push(event); fs.writeSync(this.log, JSON.stringify(event) + '\n');
    this.notify({ kind: 'event', channelId: this.id, event });
  }
  ingest(samples, sourceFrame) {
    if (!this.session) return;
    const { channels, sampleRate } = this.config;
    const frameCount = samples.length / channels;
    if (this.lastFrame !== null && sourceFrame !== this.lastFrame) {
      this.event('capture-discontinuity', { expectedFrame: this.lastFrame, actualFrame: sourceFrame, missingFrames: sourceFrame - this.lastFrame });
      this.gate.reset();
    }
    this.lastFrame = sourceFrame + frameCount;
    const processed = this.config.dc ? this.filter.process(samples) : samples;
    const db = rmsDB(processed);
    if (!this.paused) this.morse.ingest(processed, sourceFrame, this.config.thresholdDB);
    const speech = this.activity?.analyze(processed);
    const substantive = db > Math.max(-35, (this.noiseFloorDB ?? -65) + 15);
    const meaningful = this.config.autoGate && this.activity ? speech || substantive || (this.morse.on && db > Math.max(-60, this.config.thresholdDB) && ((sourceFrame + frameCount - this.morse.edge) / sampleRate < 1.2 || db > -35)) : undefined;
    if (this.config.autoGate) {
      this.noiseHistory.push(db); if (this.noiseHistory.length > 140) this.noiseHistory.shift();
      if (this.noiseHistory.length > 35) {
        const sorted = [...this.noiseHistory].sort((a, b) => a - b);
        const floor = sorted[Math.floor(sorted.length * 0.15)];
        this.noiseFloorDB = floor;
        const spread = sorted[Math.floor(sorted.length * 0.9)] - floor;
        const threshold = Math.min(-26, Math.max(-70, floor + (spread < 3 ? 4 : 8)));
        this.config.thresholdDB += (threshold - this.config.thresholdDB) * 0.025;
      }
    }
    if (!this.paused) {
      for (let i = 0; i < processed.length; i += 128 * channels) {
        const frame = sourceFrame + i / channels;
        const result = this.gate.process(processed.subarray(i, i + 128 * channels), this.config, frame, meaningful);
        if (result.opened) { this.session.transmissions++; this.event('signal-open', { captureUTC: new Date(this.session.clockOriginUTC + result.startFrame / sampleRate * 1000).toISOString() }); }
        if (result.audio.length) {
          const outputStart = this.writer.frames;
          this.writer.write(this.dynamics.process(result.audio, this.config));
          const span = { outputStart, outputEnd: this.writer.frames, sourceStart: result.startFrame,
            sourceEnd: result.startFrame + result.audio.length / channels,
            captureStartUTC: this.session.clockOriginUTC + result.startFrame / sampleRate * 1000 };
          const prior = this.session.spans.at(-1);
          if (prior && prior.outputEnd === span.outputStart && prior.sourceEnd === span.sourceStart) { prior.outputEnd = span.outputEnd; prior.sourceEnd = span.sourceEnd; }
          else this.session.spans.push(span);
          // One peak per ~21 ms at 48 kHz, decimated at save for bounded metadata.
        }
        if (result.closed) this.event('signal-close');
      }
      if (this.gate.open) {
        let peak = 0; for (const value of processed) peak = Math.max(peak, Math.abs(value));
        this.session.waveform.push({ frame: this.writer.frames, peak });
        if (this.session.waveform.length > 2400) this.session.waveform = this.session.waveform.filter((_, index) => index % 2 === 0);
      }
    }
    const now = Date.now();
    if (now - this.lastNotify >= 45) {
      this.notify({ kind: 'meter', channelId: this.id, db, open: this.gate.open && !this.paused, paused: this.paused, frames: this.writer.frames,
        duration: this.writer.frames / sampleRate, transmissions: this.session.transmissions, thresholdDB: this.config.thresholdDB, gainDB: this.dynamics.levelGainDB, reductionDB: this.dynamics.reductionDB }); this.lastNotify = now;
    }
    if (now - this.lastMetadata > 1000) { this.save(); this.lastMetadata = now; }
  }
  pause(value) { if (!this.session) return; this.paused = !!value; this.gate.reset(); this.event(value ? 'paused' : 'resumed'); this.save(); }
  save() { if (!this.session) return; this.session.frames = this.writer.frames; this.session.duration = this.writer.frames / this.config.sampleRate; atomicJSON(this.metaFile, this.session); }
  stop(reason = 'user') {
    if (!this.session) return null;
    this.stopping = true;
    this.morse.flush();
    let error;
    try { this.writer.close(); } catch (e) { error = e; }
    const result = this.session;
    try {
      this.event('session-stop', { reason, error: error?.message }); this.session.finalSettings = this.config; this.session.endedUTC = new Date().toISOString(); this.session.status = error || reason === 'error' ? 'interrupted' : 'complete'; this.save();
    } catch (failure) { error ||= failure; }
    finally { try { fs.closeSync(this.log); } catch (failure) { error ||= failure; } this.activity?.destroy(); this.session = null; this.writer = null; }
    if (error) throw error;
    return result;
  }
}
module.exports = { ChannelRecorder, atomicJSON };
