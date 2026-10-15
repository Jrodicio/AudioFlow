import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, net, protocol, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCapturePermission } from './capture-policy.cjs';

protocol.registerSchemesAsPrivileged([
  { scheme: 'audioflow', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let window: BrowserWindow | null = null;
let captureArmedUntil = 0;
const devURL = !app.isPackaged && process.env.AUDIOFLOW_DEV_URL === 'http://127.0.0.1:5173'
  ? process.env.AUDIOFLOW_DEV_URL : null;

function trustedURL(value: string) {
  try {
    const url = new URL(value);
    return devURL ? url.origin === devURL : url.protocol === 'audioflow:' && url.host === 'app';
  } catch { return false; }
}

function trustedSender(event: Electron.IpcMainInvokeEvent) {
  return !!window && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && trustedURL(event.senderFrame.url);
}

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '../dist');
  protocol.handle('audioflow', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Forbidden', { status: 403 });
    let name: string;
    try { name = decodeURIComponent(url.pathname); } catch { return new Response('Bad path', { status: 400 }); }
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const ses = session.defaultSession;
  // Electron 42 requests `media` with an EMPTY device mediaTypes list for
  // desktop capture. Physical camera/microphone requests have non-empty lists
  // and remain denied. Grant desktop permission only during an armed click.
  ses.setPermissionCheckHandler((_contents, permission, _origin, details) => {
    if (process.env.AUDIOFLOW_DIAGNOSTICS) console.log('permission-check', permission, details.mediaType, details.isMainFrame);
    return false;
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (process.env.AUDIOFLOW_DIAGNOSTICS) console.log('permission-request', permission, details.isMainFrame, trustedURL(details.requestingUrl), Date.now() < captureArmedUntil);
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    if (process.env.AUDIOFLOW_DIAGNOSTICS) console.log('capture-media-types', JSON.stringify(mediaTypes), Object.keys(details));
    callback(contents === window?.webContents && isCapturePermission(permission, mediaTypes) && details.isMainFrame &&
      trustedURL(details.requestingUrl) && Date.now() < captureArmedUntil);
  });
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    if (process.env.AUDIOFLOW_DIAGNOSTICS) console.log('display-request', request.securityOrigin, request.frame === window?.webContents.mainFrame, request.audioRequested, request.videoRequested, Date.now() < captureArmedUntil);
    if (process.platform !== 'win32' || !window ||
      request.frame !== window.webContents.mainFrame || !trustedURL(request.securityOrigin) ||
      !request.audioRequested || !request.videoRequested || Date.now() >= captureArmedUntil) {
      callback({});
      return;
    }
    captureArmedUntil = 0;
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false,
      });
      if (!sources.length || !window || request.frame !== window.webContents.mainFrame) {
        callback({});
        return;
      }
      callback({ video: sources[0], audio: 'loopback' });
    } catch (error) {
      console.error('No se pudo iniciar la captura de salida:', error);
      callback({});
    }
  });

  ipcMain.handle('capture:arm', (event) => {
    if (!trustedSender(event)) throw new Error('Origen no autorizado.');
    if (process.platform !== 'win32') throw new Error('La captura de salida requiere Windows.');
    captureArmedUntil = Date.now() + 10_000;
  });
  ipcMain.handle('capture:disarm', (event) => {
    if (trustedSender(event)) captureArmedUntil = 0;
  });
  ipcMain.handle('window:fullscreen', (event) => {
    if (!trustedSender(event) || !window) return false;
    window.setFullScreen(!window.isFullScreen());
    return window.isFullScreen();
  });
  window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 840, minHeight: 620,
    backgroundColor: '#080d11', title: 'AudioFlow', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, backgroundThrottling: true,
    },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('closed', () => { captureArmedUntil = 0; window = null; });
  window.on('enter-full-screen', () => window?.webContents.send('window:fullscreen-changed', true));
  window.on('leave-full-screen', () => window?.webContents.send('window:fullscreen-changed', false));
  if (devURL) await window.loadURL(devURL);
  else await window.loadURL('audioflow://app/index.html');
}).catch(error => {
  console.error('AudioFlow no pudo iniciarse:', error);
  dialog.showErrorBox('No se pudo iniciar AudioFlow', 'No se pudieron cargar los archivos de la aplicación. Volvé a compilar o reinstalar AudioFlow.');
  app.quit();
});

app.on('window-all-closed', () => app.quit());
