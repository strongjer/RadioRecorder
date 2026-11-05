'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, protocol, net, session, utilityProcess, powerSaveBlocker, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { ChannelRecorder, atomicJSON } = require('./core/recorder.cjs');
const { settings } = require('./core/audio.cjs');
const { archive, readEmbeddedMetadata } = require('./core/archive.cjs');
const { sanitizeLocation } = require('./core/location.cjs');
const { prepareActivityDetector } = require('./core/activity.cjs');
const { MODEL_ID } = require('./core/model.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'scanner', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
if (process.env.SCANNER_TEST_HOME) app.setPath('userData', process.env.SCANNER_TEST_HOME);
let window, preferences, preferenceFile, worker, blocker;
let downloading = false, shuttingDown = false;
const channels = new Map(), library = new Map();
const archiving = new Set(), archiveAgain = new Set(), pendingTranscription = new Map();
const bundledModels = path.join(process.resourcesPath, 'bundled-models');
const hasBundledModel = fs.existsSync(path.join(bundledModels, ...MODEL_ID.split('/'), 'onnx', 'decoder_model_merged_quantized.onnx'));
async function finalize(id) {
  if (archiving.has(id)) { archiveAgain.add(id); return; }
  archiving.add(id);
  try { await archive(item(id)); emit({ kind: 'archived', id }); }
  catch (error) { emit({ kind: 'error', message: 'PCM audio is safe. ' + error.message }); }
  finally { archiving.delete(id); if (archiveAgain.delete(id)) finalize(id); }
}
function emit(event) { if (window && !window.isDestroyed()) window.webContents.send('scanner:event', event); }
function persist() { atomicJSON(preferenceFile, preferences); }
function saveBlocker() {
  if ([...channels.values()].some(c => c.session)) { if (blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension'); }
  else if (blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; }
}
function listRecordings() {
  library.clear();
  for (const folder of preferences.folders) {
    if (!fs.existsSync(folder)) continue;
    for (const entry of fs.readdirSync(folder)) {
      if (!/^[\dTZA-Za-z_\-]+\.json$/.test(entry)) continue;
      try {
        const metaFile = path.join(folder, entry); let data = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        const activeChannel = [...channels.values()].find(channel => !channel.stopping && channel.session?.id === data.id);
        if (activeChannel) data = { ...activeChannel.session, frames: activeChannel.writer.frames, duration: activeChannel.writer.frames / activeChannel.config.sampleRate };
        if (data.schemaVersion !== 1 || entry !== data.id + '.json' || !/^[\dTZA-Za-z_\-]+$/.test(data.id)) continue;
        const file = path.join(folder, data.mediaFile === data.id + '.mp4' ? data.id + '.mp4' : data.id + '.wav');
        if (!fs.existsSync(file)) continue;
        const active = [...channels.values()].some(c => c.session?.id === data.id);
        if (data.status === 'recording' && !active) data.status = 'interrupted';
        if (['queued', 'transcribing'].includes(data.transcription) && !worker) data.transcription = 'not-started';
        library.set(data.id, { data, file, metaFile });
      } catch { /* An unrelated or damaged sidecar does not hide other recordings. */ }
    }
  }
  return [...library.values()].map(({ data, file }) => ({ ...data, bytes: fs.statSync(file).size })).sort((a, b) => b.startedUTC.localeCompare(a.startedUTC));
}
function item(id) { listRecordings(); const found = library.get(id); if (!found) throw new Error('Recording no longer exists.'); return found; }
function getWorker() {
  if (worker) return worker;
  worker = utilityProcess.fork(path.join(__dirname, 'transcriber.cjs'), [], {
    serviceName: 'RadioRecorder local transcription', env: { ...process.env, SCANNER_MODEL_CACHE: hasBundledModel ? bundledModels : path.join(app.getPath('userData'), 'models') }, stdio: 'pipe',
  });
  worker.stderr?.on('data', value => { if (process.env.SCANNER_TEST_HOME) console.error('Transcriber:', String(value)); });
  worker.stdout?.on('data', value => { if (process.env.SCANNER_TEST_HOME) console.log('Transcriber:', String(value)); });
  worker.on('message', message => {
    if (message.type === 'ready') {
      downloading = false; preferences.modelReady = true; persist();
      for (const data of listRecordings()) if (data.transcription === 'awaiting-model' && data.status !== 'recording') { try { queueTranscription(data.id); } catch (error) { emit({ kind: 'error', message: error.message }); } }
    }
    if (message.type === 'transcribed' || (message.type === 'error' && message.id)) {
      try {
        const entry = item(message.id);
        if (message.type === 'transcribed') {
          entry.data.captions = [...(entry.data.captions || []).filter(c => (c.kind === 'cw'&&!message.finalPass) || c.start < (message.rangeStart || 0)), ...message.captions].sort((a, b) => a.start - b.start);
          if(message.stationIdentifiers)entry.data.stationIdentifiers=message.stationIdentifiers;
          entry.data.transcribedThrough = message.rangeEnd; if(message.finalPass)entry.data.needsFinalAlignment=false;entry.data.captionTiming=message.timing;entry.data.transcription = entry.data.status === 'recording' ? 'partial' : entry.data.needsFinalAlignment ? 'queued' : 'complete'; entry.data.transcriptModel = message.model; entry.data.transcribedUTC = message.generatedUTC;
          const active = [...channels.values()].find(c => c.session?.id === message.id);
          if (active) Object.assign(active.session, { captions: entry.data.captions, transcribedThrough: message.rangeEnd, transcription: 'partial' });
        }
        else { entry.data.transcription = 'failed'; entry.data.transcriptionError = message.message; }
        atomicJSON(entry.metaFile, entry.data);
        pendingTranscription.delete(message.id);
        if (message.type === 'transcribed' && entry.data.status !== 'recording') {
          if (entry.data.needsFinalAlignment || message.rangeEnd < entry.data.duration - 0.05) queueTranscription(message.id);
          else finalize(message.id);
        }
      } catch (error) { emit({ kind: 'error', message: error.message }); }
    }
    if (message.type === 'error' && !message.id) downloading = false;
    emit({ kind: 'transcription', ...message });
  });
  worker.on('exit', code => { worker = null; downloading = false; pendingTranscription.clear(); if (!shuttingDown && code) emit({ kind: 'error', message: 'The transcription process stopped. Recording is unaffected; retry from the library.' }); });
  return worker;
}
function queueTranscription(id, live = false) {
  if (!preferences.modelReady) throw new Error('Download the local speech model in Settings first.');
  const entry = item(id);
  if (entry.data.status === 'recording' && !live) throw new Error('Use automatic transcription for an active recording.');
  if (pendingTranscription.has(id)) return;
  const finalPass=entry.data.status!=='recording'&&!!entry.data.needsFinalAlignment;
  const rangeStart = finalPass?0:entry.data.transcribedThrough || 0, rangeEnd = entry.data.duration;
  if (rangeEnd <= rangeStart) return;
  pendingTranscription.set(id, rangeEnd);
  entry.data.transcription = 'queued'; atomicJSON(entry.metaFile, entry.data);
  const pcmFile = entry.metaFile.replace(/\.json$/, '.wav');
  getWorker().postMessage({ type: 'transcribe', metadata: entry.data, file: fs.existsSync(pcmFile) ? pcmFile : entry.file, rangeStart, rangeEnd, finalPass });
}
function stopChannel(id, reason = 'user') {
  const channel = channels.get(id);
  if (!channel?.session) return null;
  const result = channel.stop(reason); saveBlocker();
  if (preferences.autoTranscribe && result.source !== 'Test signal' && result.frames) {
    const entry=item(result.id);entry.data.needsFinalAlignment=true;atomicJSON(entry.metaFile,entry.data);
    if (preferences.modelReady) queueTranscription(result.id);
    else { const entry = item(result.id); entry.data.transcription = 'awaiting-model'; atomicJSON(entry.metaFile, entry.data); finalize(result.id); }
  } else { result.transcription = 'not-requested'; const entry = item(result.id); Object.assign(entry.data, result); atomicJSON(entry.metaFile, entry.data); finalize(result.id); }
  emit({ kind: 'stopped', channelId: id, recordingId: result.id }); return result;
}
function trusted(event) { return event.sender === window?.webContents && event.senderFrame?.url.startsWith('scanner://ui/'); }
function handle(name, callback) { ipcMain.handle('scanner:' + name, (event, ...args) => { if (!trusted(event)) throw new Error('Untrusted caller.'); return callback(...args); }); }

app.whenReady().then(async () => {
  await prepareActivityDetector();
  preferenceFile = path.join(app.getPath('userData'), 'preferences.json');
  const folder = process.env.SCANNER_TEST_HOME ? path.join(process.env.SCANNER_TEST_HOME, 'Recordings') : path.join(app.getPath('music'), 'RadioRecorder');
  preferences = { folder, folders: [folder], modelReady: false, autoTranscribe: true, inputs: [{ id: 'input-1', name: 'Main receiver', frequency: '', deviceId: 'default', config: settings() }] };
  try { preferences = { ...preferences, ...JSON.parse(fs.readFileSync(preferenceFile, 'utf8')) }; } catch {}
  if(preferences.modelId!==MODEL_ID){preferences.modelReady=false;preferences.modelId=MODEL_ID;persist();}
  if(fs.existsSync(path.join(app.getPath('userData'),'models',...MODEL_ID.split('/'),'onnx','decoder_model_merged_quantized.onnx'))){preferences.modelReady=true;persist();}
  if (hasBundledModel) { preferences.modelReady = true; persist(); }
  if (!preferences.captureDefaultsVersion) {
    for (const input of preferences.inputs) if (input.config?.sampleRate === 48000 && input.config?.channels === 1) input.config.sampleRate = 16000;
    preferences.captureDefaultsVersion = 1; persist();
  }
  if (!preferences.smartGateVersion) {
    for (const input of preferences.inputs) if (input.config?.autoGate !== false && input.config?.release === 1.2) input.config.release = 0.4;
    preferences.smartGateVersion = 1; persist();
  }
  protocol.handle('scanner', request => {
    const url = new URL(request.url);
    if (url.hostname === 'audio') {
      const id = decodeURIComponent(url.pathname.slice(1));
      try {
        const active = [...channels.values()].find(channel => !channel.stopping && channel.session?.id === id);
        if (active && !active.writer.closed) active.writer.checkpoint();
        const file = item(id).file, size = fs.statSync(file).size;
        const range = request.headers.get('range');
        let start = 0, end = size - 1, status = 200;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
          if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(end, Number(match[2])) : end; }
          else start = Math.max(0, size - Number(match[2]));
          if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
          status = 206;
        }
        const headers = { 'Content-Type': file.endsWith('.mp4') ? 'audio/mp4' : 'audio/wav', 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
        if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers });
      } catch { return new Response('Not found', { status: 404 }); }
    }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (url.hostname !== 'ui' || !/^[a-z-]+\.(html|css|js|svg)$/.test(name)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, 'ui', name)).toString());
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === window?.webContents && contents.getURL().startsWith('scanner://ui/') && ((permission === 'media' && !details.mediaTypes?.includes('video')) || (permission === 'geolocation' && preferences.location?.enabled))));
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => contents === window?.webContents && contents.getURL().startsWith('scanner://ui/') && (permission === 'media' || (permission === 'geolocation' && !!preferences.location?.enabled)));
  window = new BrowserWindow({ width: 1440, height: 980, minWidth: 1100, minHeight: 800, backgroundColor: '#101416', title: 'RadioRecorder',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', trafficLightPosition: { x: 22, y: 23 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('scanner://ui/')) event.preventDefault(); });
  window.webContents.on('render-process-gone', () => { for (const id of channels.keys()) { try { stopChannel(id, 'renderer-exit'); } catch {} } });
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'Record / stop all', accelerator: 'CmdOrCtrl+R', click: () => emit({ kind: 'shortcut', action: 'record' }) }, { label: 'Recording library', accelerator: 'CmdOrCtrl+L', click: () => emit({ kind: 'shortcut', action: 'library' }) }, { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' }] },
    { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] }, { role: 'windowMenu' },
  ]; Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  handle('bootstrap', () => ({ preferences, recordings: listRecordings(), version: app.getVersion(), platform: process.platform }));
  handle('preferences', value => {
    if (value.inputs && Array.isArray(value.inputs) && value.inputs.length <= 8) {
      preferences.inputs = value.inputs.map((input, index) => ({ id: /^input-[a-z\d-]{1,40}$/.test(input.id) ? input.id : 'input-' + (index + 1), name: String(input.name || 'Receiver').slice(0, 100), frequency: String(input.frequency || '').slice(0, 60), deviceId: String(input.deviceId || 'default').slice(0, 300), config: settings(input.config) }));
    }
    if (typeof value.autoTranscribe === 'boolean') preferences.autoTranscribe = value.autoTranscribe;
    persist(); return preferences;
  });
  handle('choose-folder', async () => {
    if ([...channels.values()].some(c => c.session)) throw new Error('Stop recording before changing folders.');
    const result = await dialog.showOpenDialog(window, { title: 'Choose a recordings folder', properties: ['openDirectory', 'createDirectory'] });
    if (!result.canceled) { preferences.folder = result.filePaths[0]; preferences.folders = [...new Set([...preferences.folders, preferences.folder])]; persist(); }
    return preferences.folder;
  });
  handle('start', value => {
    if (!preferences.inputs.some(input => input.id === value.id)) throw new Error('Unknown audio input.');
    if (!Number.isFinite(value.clockOriginUTC) || Math.abs(value.clockOriginUTC - Date.now()) > 7 * 86400000) throw new Error('Invalid audio clock. Restart monitoring.');
    const channel = channels.get(value.id) || new ChannelRecorder(value.id, emit); channels.set(value.id, channel);
    const id = channel.start({ ...value, folder: preferences.folder, groupId: String(value.groupId || randomUUID()).slice(0, 100) });
    if (preferences.autoTranscribe && !preferences.modelReady && !downloading && value.source !== 'Test signal') { downloading = true; getWorker().postMessage({ type: 'download' }); }
    channel.session.locations = preferences.location?.enabled ? [{ ...sanitizeLocation(preferences.location), utc: new Date().toISOString() }] : [];
    channel.save(); saveBlocker(); return id;
  });
  ipcMain.on('scanner:audio', (event, id, input, frame) => {
    if (!trusted(event)) return;
    const channel = channels.get(id); if (!channel?.session) return;
    if (!(input instanceof Float32Array) || input.length > 32768 || input.length % channel.config.channels || !Number.isSafeInteger(frame) || frame < 0) return;
    try { channel.ingest(input, frame); } catch (error) { try { stopChannel(id, 'error'); } catch {} emit({ kind: 'error', channelId: id, message: error.message }); }
  });
  handle('configure', (id, config) => channels.get(id)?.configure(config));
  handle('pause', (id, value) => channels.get(id)?.pause(value));
  handle('stop', id => stopChannel(id));
  handle('list', listRecordings);
  handle('import', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Import a RadioRecorder MP4', filters: [{ name: 'RadioRecorder archive', extensions: ['mp4'] }], properties: ['openFile'] });
    if (result.canceled) return null;
    const file = result.filePaths[0], data = await readEmbeddedMetadata(file);
    listRecordings(); if (library.has(data.id)) return data.id;
    fs.mkdirSync(preferences.folder, { recursive: true });
    data.status = data.status === 'interrupted' ? 'interrupted' : 'complete'; data.importedUTC = new Date().toISOString(); data.mediaFile = data.id + '.mp4';
    await fs.promises.copyFile(file, path.join(preferences.folder, data.mediaFile), fs.constants.COPYFILE_EXCL);
    atomicJSON(path.join(preferences.folder, data.id + '.json'), data);
    fs.writeFileSync(path.join(preferences.folder, data.id + '.log'), (data.events || []).map(event => JSON.stringify(event)).join('\n') + '\n');
    return data.id;
  });
  handle('reveal', id => shell.showItemInFolder(item(id).file));
  handle('trash', async id => {
    const entry = item(id);
    if ([...channels.values()].some(channel => channel.session?.id === id)) throw new Error('Stop this recording before moving it to Trash.');
    if (archiving.has(id) || pendingTranscription.has(id)) throw new Error('Wait for this recording to finish processing before moving it to Trash.');
    const answer = await dialog.showMessageBox(window, { type: 'warning', title: 'Move recording to Trash?', message: `Move “${entry.data.name}” to Trash?`, detail: 'The audio, transcript, metadata, and log for this session will be moved to the system Trash. Other recordings and your configured audio inputs will be kept.', buttons: ['Cancel', 'Move to Trash'], defaultId: 0, cancelId: 0 });
    if (answer.response !== 1) return false;
    for (const extension of ['.mp4', '.wav', '.srt', '.log', '.json']) {
      const file = entry.metaFile.replace(/\.json$/, extension);
      if (fs.existsSync(file)) await shell.trashItem(file);
    }
    emit({ kind: 'removed', id }); return true;
  });
  handle('export', async (id, type) => {
    const entry = item(id); const kind = ['mp4', 'json', 'txt', 'srt', 'log'].includes(type) ? type : 'mp4';
    if(kind==='mp4'&&(entry.data.needsFinalAlignment||pendingTranscription.has(id)||archiving.has(id)))throw new Error('Captions are still being aligned. Export when processing finishes.');
    if (kind === 'mp4' && !entry.file.endsWith('.mp4')) throw new Error('This recording is still being finalized. Audio can already be played from the library.');
    const result = await dialog.showSaveDialog(window, { defaultPath: entry.data.name.replace(/[^\p{L}\p{N} _-]/gu, '') + '.' + kind });
    if (result.canceled) return;
    if (kind === 'mp4' || kind === 'log') fs.copyFileSync(kind === 'mp4' ? entry.file : entry.metaFile.replace(/\.json$/, '.log'), result.filePath);
    else if (kind === 'json') atomicJSON(result.filePath, entry.data);
    else if (kind === 'txt') fs.writeFileSync(result.filePath, entry.data.captions.map(c => `[${c.startUTC} → ${c.endUTC}] ${c.text}`).join('\n'));
    else {
      const stamp = seconds => { const ms = Math.round(seconds * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
      fs.writeFileSync(result.filePath, entry.data.captions.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'));
    }
  });
  handle('download-model', () => { if (!downloading) { downloading = true; getWorker().postMessage({ type: 'download' }); } });
  handle('transcribe', id => {
    const entry = item(id);
    if (entry.data.status === 'recording') throw new Error('Automatic live transcription is active; stop this recording before retrying.');
    if (!pendingTranscription.has(id)) {
      entry.data.transcribedThrough = 0; entry.data.needsFinalAlignment=true; entry.data.captions = (entry.data.captions || []).filter(caption => caption.kind === 'cw'); entry.data.transcription = 'not-started';
      atomicJSON(entry.metaFile, entry.data);
    }
    queueTranscription(id);
  });
  handle('location', value => {
    const location = sanitizeLocation(value); preferences.location = location; persist();
    for (const channel of channels.values()) if (channel.session) { if (location.enabled) channel.session.locations.push({ ...location, utc: new Date().toISOString() }); channel.event(location.enabled ? 'location-updated' : 'location-disabled', { precision: location.precision }); channel.save(); }
    return location;
  });
  handle('bookmark', (id, value) => {
    const entry = item(id), position = Math.max(0, Math.min(entry.data.duration, Number(value.position) || 0));
    const mark = { utc: new Date().toISOString(), position, text: String(value.text || 'Bookmarked moment').slice(0, 300) };
    const active = [...channels.values()].find(channel => channel.session?.id === id);
    const data = active?.session || entry.data; data.bookmarks ||= []; data.bookmarks.push(mark);
    if (active) { active.event('bookmark', mark); active.save(); }
    else { atomicJSON(entry.metaFile, data); finalize(id); }
    return mark;
  });
  setInterval(() => {
    if (!preferences.autoTranscribe || !preferences.modelReady) return;
    for (const channel of channels.values()) if (channel.session && channel.writer.frames / channel.config.sampleRate - (channel.session.transcribedThrough || 0) >= 6 && channel.session.source !== 'Test signal') {
      try { channel.save(); channel.writer.checkpoint(); queueTranscription(channel.session.id, true); } catch (error) { emit({ kind: 'error', message: error.message }); }
    }
  }, 2000).unref();
  powerMonitor.on('suspend', () => { for (const id of channels.keys()) { try { stopChannel(id, 'system-suspend'); } catch {} } emit({ kind: 'suspended' }); });
  window.loadURL('scanner://ui/');
  setTimeout(() => {
    for (const data of listRecordings()) {
      if ([...channels.values()].some(channel => channel.session?.id === data.id)) continue;
      if (data.status === 'recording' || data.status === 'interrupted') { data.status = 'interrupted'; data.recoveredUTC = new Date().toISOString(); atomicJSON(library.get(data.id).metaFile, data); }
      if (data.mediaFile?.endsWith('.wav') && data.status !== 'recording') {
        if (preferences.autoTranscribe && preferences.modelReady && data.source !== 'Test signal') { try { queueTranscription(data.id); } catch {} }
        else finalize(data.id);
      }
    }
  }, 1000).unref();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (shuttingDown) return;
  const active = [...channels.values()].filter(channel => channel.session);
  if (!active.length && !archiving.size && !worker) return;
  event.preventDefault(); shuttingDown = true;
  if (worker) worker.kill();
  for (const channel of active) {
    try { const result = channel.stop('app-quit'); const entry = item(result.id); entry.data.transcription = preferences.autoTranscribe && result.source !== 'Test signal' ? 'awaiting-model' : 'not-requested'; atomicJSON(entry.metaFile, entry.data); finalize(result.id); } catch {}
  }
  const deadline = Date.now() + 30000;
  const timer = setInterval(() => { if (!archiving.size || Date.now() > deadline) { clearInterval(timer); app.quit(); } }, 100);
});
