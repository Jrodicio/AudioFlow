import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('audioflow', {
  platform: process.platform,
  armCapture: () => ipcRenderer.invoke('capture:arm'),
  disarmCapture: () => ipcRenderer.invoke('capture:disarm'),
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  onFullscreen: (listener: (value: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: boolean) => listener(value);
    ipcRenderer.on('window:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler);
  },
});
