const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const out = path.resolve('artifacts/themes');
app.setPath('userData', path.resolve('.cache/themes-gpu-profile'));
const report = { errors: [], scenarios: {} };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let win;
app.whenReady().then(async () => {
  await fs.mkdir(out, { recursive: true });
  win = new BrowserWindow({ width: 960, height: 540, useContentSize: true, show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.showInactive();
  win.webContents.on('console-message', d => { if (d.level === 'error') report.errors.push(d.message); });
  const run = code => win.webContents.executeJavaScript(code, true);
  const capture = async label => {
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(out, `${label}.png`), (await win.webContents.capturePage()).toPNG());
  };
  try {
    const approved = execFileSync('git', ['show', 'atmosphere-cold-fire-plumes-v1:src/visual/atmosphereShaders.ts'], { encoding: 'utf8' });
    const shaders = {};
    // Resolve the tag's template-string exports without importing current source.
    const source = approved.replaceAll('export const ', 'const ');
    Object.assign(shaders, Function(source + '; return {transportShader,volumeRenderShader,pigmentSourceShader};')());
    await win.loadURL('http://127.0.0.1:5174/tests/theme-gpu.html');
    assert(await run('gpuThemeTest.ready'), 'FP16 volume unavailable');
    report.hardware = await run('gpuThemeTest.hardware');
    report.baseline = await run(`gpuThemeTest.setup(${JSON.stringify(shaders)})`);
    assert(report.baseline.image.max === 0, 'Official render differs from approved tag');
    assert(report.baseline.physics.every(d => d.max === 0), 'Baseline transport differs from tag');
    await capture('A-official');
    for (const name of ['duplicate', 'red', 'yellow', 'both', 'edited', 'original']) {
      report.scenarios[name] = await run(`gpuThemeTest.setTheme('${name}')`); await capture(name);
    }
    assert(report.scenarios.duplicate.max === 0, 'Unmodified copy differs');
    assert(report.scenarios.original.max === 0, 'Restoration differs');
    assert(report.scenarios.red.colors.red > report.baseline.colors.red + .001, 'New red absent');
    assert(report.scenarios.yellow.colors.yellow > report.baseline.colors.yellow + .001, 'New yellow absent');
    assert(report.scenarios.both.colors.red > .001 && report.scenarios.both.colors.yellow > .001, 'Pigments do not coexist');
    assert(report.scenarios.both.colors.blue > .01 && report.scenarios.both.colors.turquoise > .01, 'Original pigments lost');
    assert(report.scenarios.edited.rms > .002, 'Editing an original pigment has no visible effect');
    report.transition = await run('gpuThemeTest.movingTransition()');
    assert(report.transition.physics.every(d => d.max === 0), 'Theme changes physical fields');
    assert(report.transition.after > report.transition.before, 'Simulation stopped');
    assert(report.transition.largestStep < .04, 'Abrupt transition');
    assert(report.transition.chromatic.nonfinite === 0 && report.transition.chromatic.hi - report.transition.chromatic.lo > .3, 'Chromatic field invalid');
    report.restoredMoving = await run('gpuThemeTest.restoredMoving()');
    assert(report.restoredMoving.image.max === 0, 'Restoring moving matter differs from tag');
    report.reactive=await run('gpuThemeTest.reactiveBaseline()');
    assert(report.reactive.every(c=>c.image.max===0&&c.physics.every(d=>d.max===0)),'Reactive plumes differ from approved tag');
    report.surfaces = await run('gpuThemeTest.surfaceCheck()');
    for (const [name, s] of Object.entries(report.surfaces)) {
      assert(s.official.max === 0, `${name} baseline changed`); assert(s.custom.rms > .005 && s.edited.rms > .002, `${name} does not respond to theme`);
    }
    report.performance = {};
    for (const name of ['original', 'both', 'edited', 'combined']) report.performance[name] = await run(`gpuThemeTest.performanceCheck('${name}',5)`);
    report.longRun=[];
    for(let minute=0;minute<3;minute++) {
      const state=await run('gpuThemeTest.longRun(60)');report.longRun.push(state);
      console.log('Themes stability '+state.seconds.toFixed(1)+'s: '+JSON.stringify(state.colors));
      assert(state.colors.red>.001&&state.colors.yellow>.001,'New pigments lost in long-run advection');
    }
    await capture('both-long-run');
    report.restore=await run('gpuThemeTest.restoreCheck()');
    assert(report.restore.image.max===0&&report.restore.physics.every(d=>d.max===0)&&report.restore.glError===0,'Context restore leaves invalid GPU bindings');
    report.shaderErrors = await run('gpuThemeTest.errors');
    assert(report.shaderErrors.length === 0 && report.errors.length === 0, 'GPU shader errors');
    report.disposed = await run('gpuThemeTest.dispose()'); assert(report.disposed.textures === 0, 'Texture leak');
    await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(out, 'comparison.html'), require('./themes-report.cjs').renderReport(report));
    console.log(JSON.stringify(report, null, 2)); app.exit(0);
  } catch (error) {
    report.errors.push(String(error.stack || error)); await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    await capture('failure').catch(() => {}); console.error(error); app.exit(1);
  }
});
