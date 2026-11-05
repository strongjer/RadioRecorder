'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, ...args) => ipcRenderer.invoke('scanner:' + name, ...args);
contextBridge.exposeInMainWorld('scanner', {
  platform: process.platform,
  bootstrap: () => invoke('bootstrap'),
  preferences: value => invoke('preferences', value),
  chooseFolder: () => invoke('choose-folder'),
  start: value => invoke('start', value),
  stop: id => invoke('stop', id),
  pause: (id, value) => invoke('pause', id, value),
  configure: (id, value) => invoke('configure', id, value),
  audio: (id, samples, frame) => ipcRenderer.send('scanner:audio', id, samples, frame),
  list: () => invoke('list'),
  importRecording: () => invoke('import'),
  reveal: id => invoke('reveal', id),
  trash: id => invoke('trash', id),
  export: (id, type) => invoke('export', id, type),
  downloadModel: () => invoke('download-model'),
  transcribe: id => invoke('transcribe', id),
  location: value => invoke('location', value),
  bookmark: (id, value) => invoke('bookmark', id, value),
  onEvent: callback => { const listener = (_, event) => callback(event); ipcRenderer.on('scanner:event', listener); return () => ipcRenderer.removeListener('scanner:event', listener); },
});
