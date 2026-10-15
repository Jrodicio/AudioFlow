// Runs the actual production Electron entry and native loopback, without a
// microphone or synthetic audio playback. Screenshots contain only AudioFlow.
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const testProfile = path.resolve(__dirname, '../.cache/smoke-profile');
require('node:fs').mkdirSync(testProfile, { recursive: true });
app.setPath('userData', testProfile);
const results = { errors: [], checks: {}, capture: null, gpu: null };
const output = path.resolve(__dirname, process.env.AUDIOFLOW_SMOKE_RGBA8 ? '../artifacts/rgba8' : process.env.AUDIOFLOW_DEV_URL ? '../artifacts/dev' : '../artifacts');
let finished = false;
const timeout = setTimeout(() => finish(new Error('Smoke test timed out')), 90_000);

async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (error) results.errors.push(String(error.stack || error));
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'smoke-result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  app.exit(results.errors.length ? 1 : 0);
}
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', details => {
    if (details.level === 'error') results.errors.push(details.message);
  });
  contents.on('preload-error', (_event, _path, error) => results.errors.push(String(error)));
  contents.on('render-process-gone', (_event, details) => results.errors.push(JSON.stringify(details)));
});
app.on('browser-window-created', (_event, win) => {
  // Test only: exercise the no-float-attachment path in a real WebGL2 context.
  let precisionSetup = Promise.resolve();
  if (process.env.AUDIOFLOW_SMOKE_RGBA8) {
    win.webContents.debugger.attach('1.3');
    precisionSetup = win.webContents.debugger.sendCommand('Page.enable').then(() => win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{
      source: `(() => { const original=WebGL2RenderingContext.prototype.getExtension; WebGL2RenderingContext.prototype.getExtension=function(name){return name==='EXT_color_buffer_float'?null:original.call(this,name);}; })();`,
    }));
  }
  win.webContents.once('did-finish-load', async () => {
    try {
      await precisionSetup;
      if (process.env.AUDIOFLOW_SMOKE_RGBA8) {
        // Registration may race the first navigation. Reload only after CDP has
        // acknowledged it, so the capability override precedes application code.
        const loaded = new Promise(resolve => win.webContents.once('did-finish-load',resolve));
        win.webContents.reload();
        await loaded;
      }
      const run = code => win.webContents.executeJavaScript(code, true);
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const assert = (value, message) => { if (!value) throw new Error(message); };
      await wait(2500);
      results.gpu = app.getGPUFeatureStatus();
      results.checks.initial = await run(`({canvas:!!document.querySelector('canvas'),debug:!!document.querySelector('.acoustic-debug'),error:document.querySelector('[role="alert"]')?.textContent||'',status:document.querySelector('.source-badge')?.textContent,fps:document.querySelector('.scene-meta')?.textContent})`);
      assert(results.checks.initial.canvas && !results.checks.initial.error, 'Canvas or shader initialization failed');
      assert(!results.checks.initial.debug,'Diagnostics must be hidden by default');
      await fs.mkdir(output, { recursive: true });
      await run(`document.querySelectorAll('.style-selector button')[1].click()`);
      await wait(11000);
      await fs.writeFile(path.join(output, 'liquid.png'), (await win.webContents.capturePage()).toPNG());
      await run(`document.querySelector('.demo-button').click()`);
      await wait(300);
      results.checks.demo = await run(`({label:document.querySelector('.source-badge').textContent,meter:document.querySelector('.meter-label output').textContent})`);
      assert(results.checks.demo.label.includes('DEMO') && results.checks.demo.meter.includes('∞'), 'Demo must be explicitly labelled and never feed the real meter');
      await wait(2000);
      await fs.writeFile(path.join(output,'liquid-motion.png'),(await win.webContents.capturePage()).toPNG());
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'F3'});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:'F3'});
      await wait(200);
      results.checks.debug = await run(`document.querySelector('.acoustic-debug')?.textContent||''`);
      assert(results.checks.debug.includes('RMS') && results.checks.debug.includes('DEMO VISUAL'),'F3 diagnostics failed');
      if (process.env.AUDIOFLOW_SMOKE_RGBA8) assert(results.checks.debug.includes('RGBA8'),'Fallback shader did not activate');
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'F3'});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:'F3'});
      results.checks.styleFPS = {};
      for (const [index, name] of [[0,'atmosphere'],[2,'texture']]) {
        await run(`document.querySelectorAll('.style-selector button')[${index}].click()`);
        await wait(11000);
        await fs.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
        results.checks.styleFPS[name] = await run(`document.querySelector('.scene-meta').textContent`);
        await wait(2000);
        await fs.writeFile(path.join(output, `${name}-motion.png`), (await win.webContents.capturePage()).toPNG());
      }
      await run(`document.querySelector('[aria-label="Pantalla completa"]').click()`);
      await wait(400);
      results.checks.fullscreen = win.isFullScreen();
      assert(results.checks.fullscreen,'Fullscreen did not activate');
      await run(`document.querySelector('[aria-label="Salir de pantalla completa"]').click()`);
      await wait(400);
      win.setSize(840,620);
      await wait(400);
      results.checks.compactLayout = await run(`(()=>{const p=document.querySelector('.control-panel').getBoundingClientRect();const t=document.querySelector('.transport').getBoundingClientRect();return {panelBottom:p.bottom,transportTop:t.top,canvasWidth:document.querySelector('canvas').width,canvasHeight:document.querySelector('canvas').height};})()`);
      assert(results.checks.compactLayout.panelBottom < results.checks.compactLayout.transportTop,'Panel overlaps transport at minimum window size');
      await fs.writeFile(path.join(output,'compact.png'),(await win.webContents.capturePage()).toPNG());
      win.setSize(1440,960);
      await wait(300);
      await run(`document.querySelector('[aria-label="Transición automática entre estilos"]').click()`);
      results.checks.preferences = await run(`JSON.parse(localStorage.getItem('audioflow.preferences.v1'))`);
      assert(results.checks.preferences.auto, 'Auto transition setting was not saved');
      await run(`document.querySelector('.bottom-hint button').click()`);
      results.checks.immersive = await run(`document.querySelector('main').classList.contains('immersive')`);
      assert(results.checks.immersive, 'Immersive controls failed');
      await run(`document.querySelector('.restore-button').click();document.querySelector('.demo-button').click();document.querySelector('.capture-button').click()`);
      await wait(4500);
      results.capture = await run(`({badge:document.querySelector('.source-badge').textContent,message:document.querySelector('.capture-status')?.textContent,meter:document.querySelector('.meter-label output').textContent,button:document.querySelector('.capture-button').textContent})`);
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'F3'});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:'F3'});
      await wait(800);
      results.checks.liveAnalysis = await run(`document.querySelector('.acoustic-debug')?.textContent||''`);
      await fs.writeFile(path.join(output,'acoustic-debug.png'),(await win.webContents.capturePage()).toPNG());
      if (results.capture.button.includes('Detener')) {
        results.checks.nativeLoopback = 'connected';
        await run(`document.querySelector('.capture-button').click()`);
        results.checks.stopped = await run(`document.querySelector('.source-badge').textContent.includes('DESACTIVADA')`);
        assert(results.checks.stopped, 'Capture stop failed');
      } else {
        results.checks.nativeLoopback = 'unavailable; inspect capture.message';
        assert(results.capture.message, 'Capture failure was not explained to the user');
      }
      await win.webContents.reload();
      await wait(1700);
      results.checks.reloadedPreferences = await run(`({auto:document.querySelector('[role="switch"]').getAttribute('aria-checked'),capture:document.querySelector('.source-badge').textContent,demo:document.querySelector('.demo-button').getAttribute('aria-pressed')})`);
      assert(results.checks.reloadedPreferences.auto==='true','Preferences did not survive reload');
      assert(results.checks.reloadedPreferences.demo==='false','Demo must never silently restart');
      assert(results.checks.reloadedPreferences.capture.includes('DESACTIVADA'),'Capture must require a fresh click');
      // Leave a clean set of default preferences for the next real launch.
      await run(`localStorage.removeItem('audioflow.preferences.v1')`);
      await finish();
    } catch (error) { await finish(error); }
  });
});
require('../dist-electron/main.cjs');
