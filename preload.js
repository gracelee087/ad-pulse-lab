// ad-pulse-lab — small bridge exposed to the page.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('adpulse', {
    hasKey: () => ipcRenderer.invoke('adpulse:hasKey'),
    startLog: () => ipcRenderer.invoke('adpulse:startLog'),
    log: (row) => ipcRenderer.send('adpulse:log', row),
    getScenes: () => ipcRenderer.invoke('adpulse:getScenes'),
    saveScenes: (data) => ipcRenderer.invoke('adpulse:saveScenes', data),
    sdkStart: (opts) => ipcRenderer.invoke('adpulse:sdkStart', opts),
    sdkStop: () => ipcRenderer.invoke('adpulse:sdkStop'),
    onSdk: (cb) => { ipcRenderer.removeAllListeners('adpulse:sdk'); ipcRenderer.on('adpulse:sdk', (_e, msg) => cb(msg)); },
});
