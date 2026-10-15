const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const profile=path.resolve('.cache/atmosphere-gpu-profile');
require('node:fs').mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const output=path.resolve('artifacts/atmosphere-volume');
const report={signal:'synthetic PCM + matching discrete spectrum, existing extractor; no loopback validation',errors:[],scenarios:{},stability:[]};
let win;
const assert=(value,message)=>{if(!value)throw new Error(message);};
function stable(s) {
  assert(s.invalid===0,'Non-finite voxels');
  assert(Number.isFinite(s.maxSpeed)&&s.maxSpeed<=.0852,'Velocity bound failed');
  assert(s.minDensity>=0&&s.maxDensity<=1.001,'Density bounds failed');
  assert(s.densityVariance>.005&&s.density>.08,'Density lost its visible bodies');
  assert(s.saturatedFraction<.08,'Too many voxels hit the velocity limiter');
  assert(s.minPigment>=0&&s.maxPigment<=1.001,'Pigment out of bounds');
  assert(Math.max(...s.pigmentVariance)>.002,'Dye field homogenized');
  assert(s.errors.length===0,s.errors.join('\n'));
}
app.on('web-contents-created',(_event,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message);}));
app.whenReady().then(async()=>{
  await fs.mkdir(output,{recursive:true});
  win=new BrowserWindow({width:1920,height:1080,useContentSize:true,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.showInactive();
  const run=code=>win.webContents.executeJavaScript(code,true);
  async function capture(label) {
    // Wait for the compositor to present the requested diagnostic image.
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(output,`${label}.png`),(await win.webContents.capturePage()).toPNG());
  }
  async function paired(label,mode,seconds) {
    const s=await run(`gpuTest.paired(${JSON.stringify(mode)},${seconds})`);
    report.scenarios[label]=s;
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));stable(s);
    await capture(label);
    await run(`gpuTest.show('control')`);await capture(`${label}-control`);
    await run(`gpuTest.show('difference')`);await capture(`${label}-difference-x4`);
    await run(`gpuTest.show('audio')`);
    console.log(`${label}: image RMS ${s.image.rms.toFixed(4)}, changed ${(s.image.changedFraction*100).toFixed(1)}%; density delta ${s.densityDelta.toFixed(4)}; force ratio ${s.forces.after.ratio.toFixed(2)}`);
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    return s;
  }
  async function fresh() {await run('gpuTest.reset()');await run(`gpuTest.paired('silence',4)`);}
  function renderedResponse(s,label) {
    // Observable bounds, not an artistic verdict. >4/255 rejects dither alone.
    assert(s.image.rms>.008,`${label}: rendered RMS below 2/255`);
    assert(s.image.changedFraction>.10,`${label}: fewer than 10% changed pixels`);
    assert(s.densityDelta>.003,`${label}: density transport barely changed`);
    assert(s.pigmentDelta>.001,`${label}: dye did not travel with the flow`);
  }
  try {
    await win.loadURL('http://127.0.0.1:5174/tests/atmosphere-gpu.html');
    assert(await run('!!window.gpuTest?.ready'),'FP16 volume is unavailable');
    report.hardware=await run('gpuTest.hardware');
    await fresh();
    const a=await paired('A-silence','silence',5);
    assert(a.velocityDelta<1e-6&&a.image.rms===0,'Same-seed silent control diverged');
    const a2=await paired('A-silence-evolved','silence',3);
    assert(a2.densityChange>.001,'Silent matter did not move');
    report.legacy=await run('gpuTest.compareLegacy()');
    assert(report.legacy.liquid===0&&report.legacy.texture===0,'Liquid/Texture pixels changed');
    await fresh();const b=await paired('B-soft','soft',5);renderedResponse(b,'soft');
    await fresh();const bass=await paired('C-bass','bass',5);renderedResponse(bass,'bass');
    await fresh();const mids=await paired('D-mids','mids',5);renderedResponse(mids,'mids');
    await fresh();const highs=await paired('D-highs','highs',5);renderedResponse(highs,'highs');
    assert(highs.forces.after.acoustic.gradientRatio>bass.forces.after.acoustic.gradientRatio*1.5,'High-frequency force is not finer than bass');
    assert(bass.forces.after.acoustic.activeFraction>highs.forces.after.acoustic.activeFraction,'Bass influence is not broader than highs');
    await fresh();const impulse=await paired('E-transient-start','transient',.1);
    const early=await paired('E-transient-early','release',.25);
    const wake=await paired('E-transient-wake','release',1.15);
    assert(early.image.rms>.001&&early.image.changedFraction>.002,'Transient transport is not visible within 350 ms');
    assert(impulse.forces.after.acoustic.activeFraction<.55,'Transient is not localized');
    assert(wake.velocityDelta>impulse.velocityDelta*.5,'Transient inertia disappeared');
    assert(wake.image.rms>.002&&wake.densityDelta>impulse.densityDelta,'Impulse did not evolve in rendered matter');
    await fresh();const intense=await paired('F-dynamic','intense',5);renderedResponse(intense,'dynamic');
    const release=await paired('F-release','release',1);
    const decay=await paired('F-decay','release',15);
    assert(release.velocityDelta>intense.velocityDelta*.3,'Motion stopped when sound stopped');
    assert(decay.forces.after.acoustic.rms<intense.forces.after.acoustic.rms*.03,'Acoustic force did not release');
    assert(decay.velocityDelta<release.velocityDelta*.7,'Velocity did not dissipate');
    assert(intense.image.rms>b.image.rms*1.2,'Dynamic audio is not stronger than quiet audio');
    await fresh();const replay=await paired('G-soft-replay','soft',5);
    assert(replay.image.rms===b.image.rms&&replay.densityDelta===b.densityDelta,'Fixed-step seeded replay is not deterministic');
    const color=b.image.color;
    assert(color.blue>.05&&color.teal>.03&&color.gold>.001,'Blue, teal or warm dye bodies absent from render');
    await fresh();report.temporal=await run('gpuTest.temporalPair(3)');await capture('G-temporal');
    assert(report.temporal.image.rms>.008,'Temporal accumulation hid the audio response');
    assert(report.temporal.frameChange.p95<.025,'Excessive frame-to-frame flicker');
    report.depth=a2.depth;
    assert(report.depth.every(d=>d.speed>.0001&&d.density>.0001),'A depth region is empty or frozen');
    for(const [label,near,far] of [['H-background',2/3,1],['H-middle',1/3,2/3],['H-foreground',0,1/3]]) {
      await run(`gpuTest.depthWindow(${near},${far})`);await capture(label);
    }
    await run('gpuTest.depthWindow(0,1)');
    report.resize=await run('gpuTest.resizeCheck()');
    assert(report.resize.before===report.resize.after,'Resize reset the simulation');
    report.memoryAfterControlDisposal=await run('gpuTest.stopControl()');
    report.singleVolumePerformance=await run(`gpuTest.realtime('intense',8)`);stable(report.singleVolumePerformance);
    report.memoryBeforeStability=report.singleVolumePerformance.memory;
    console.log(`Single volume 1080p: ${report.singleVolumePerformance.fps.toFixed(1)} FPS; ${report.hardware}`);
    for(let minute=1;minute<=5;minute++) {
      for(let batch=0;batch<12;batch++)await run(`gpuTest.advance(5,${JSON.stringify(minute%2 ? 'intense' : 'silence')})`);
      const s=await run('gpuTest.stats()');stable(s);report.stability.push(s);
      assert(s.memory.textures===report.memoryBeforeStability.textures,'Texture allocation grew over time');
      console.log(`Stability +${minute} min: max ${s.maxSpeed.toFixed(5)}, saturated ${(s.saturatedFraction*100).toFixed(2)}%, variance ${s.densityVariance.toFixed(5)}`);
    }
    report.finalWarm=await run(`gpuTest.realtime('silence',2)`);stable(report.finalWarm);
    report.finalColor=await run('gpuTest.imageMetrics().color');
    assert(report.finalColor.blue>.05&&report.finalColor.teal>.01&&report.finalColor.gold>.0005,'Long-run rendered palette lost its dye bodies');
    await run(`gpuTest.show('audio')`);await capture('stability-final');
    report.disposed=await run('gpuTest.dispose()');
    assert(report.disposed.textures===0&&report.disposed.geometries===0,'GPU resources leaked');
    assert(report.errors.length===0,report.errors.join('\n'));
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    await fs.writeFile(path.join(output,'comparison.html'),require('./atmosphere-report.cjs').renderReport(report));
    console.log('Atmosphere GPU validation passed');app.exit(0);
  } catch(error) {
    report.errors.push(String(error.stack||error));
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    if(win)await capture('failure').catch(()=>{});
    console.error(error);app.exit(1);
  }
});
