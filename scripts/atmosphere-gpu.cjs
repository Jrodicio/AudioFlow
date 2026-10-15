const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const profile=path.resolve('.cache/atmosphere-gpu-profile');
require('node:fs').mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const output=path.resolve('artifacts/atmosphere-volume');
const report={errors:[],scenarios:{},stability:[]};
let win;
const assert=(value,message)=>{if(!value)throw new Error(message);};
function stable(s) {
  assert(s.invalid===0,'Non-finite voxels');
  assert(Number.isFinite(s.maxSpeed)&&s.maxSpeed<=.0852,'Velocity bound failed');
  assert(s.minDensity>=0&&s.maxDensity<=1.001,'Density bounds failed');
  assert(s.densityVariance>.005&&s.density>.08,'Density lost its visible bodies');
  assert(s.errors.length===0,s.errors.join('\n'));
}
app.on('web-contents-created',(_event,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message);}));
app.whenReady().then(async()=>{
  await fs.mkdir(output,{recursive:true});
  win=new BrowserWindow({width:1920,height:1080,useContentSize:true,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.showInactive();
  const run=code=>win.webContents.executeJavaScript(code,true);
  async function scenario(label,mode,seconds) {
    const s=await run(`window.gpuTest.realtime(${JSON.stringify(mode)},${seconds})`);
    stable(s);report.scenarios[label]=s;
    await fs.writeFile(path.join(output,`${label}.png`),(await win.webContents.capturePage()).toPNG());
    console.log(`${label}: ${s.fps.toFixed(1)} FPS; density ${s.density.toFixed(4)}; delta ${s.velocityDelta.toFixed(5)}`);
    return s;
  }
  try {
    await win.loadURL('http://127.0.0.1:5174/tests/atmosphere-gpu.html');
    assert(await run('!!window.gpuTest?.ready'),'FP16 volume is unavailable');
    const a=await scenario('A-silence-start','silence',4);
    const a2=await scenario('A-silence-evolved','silence',6);
    assert(a2.densityChange>.0001,'Silent material did not move');
    assert(a2.velocityDelta<1e-6,'Silent control diverged beyond FP16 roundoff');
    report.legacy=await run('gpuTest.compareLegacy()');
    assert(report.legacy.liquid===0&&report.legacy.texture===0,'Liquid/Texture pixels changed');
    const b=await scenario('B-soft-synthetic','soft',5);
    assert(b.velocityDelta>.00001,'Soft forces did not affect velocity');
    const c=await scenario('C-impulses-synthetic','intense',5);
    assert(c.velocityDelta>b.velocityDelta,'Impulses did not increase perturbations');
    const d=await scenario('D-after-sound','release',1);
    assert(d.velocityDelta>c.velocityDelta*.25,'Inertia vanished at silence');
    const d2=await scenario('D-dissipation','release',16);
    assert(d2.velocityDelta<Math.max(c.velocityDelta,d.velocityDelta)*1.4,'Perturbations grew without continued audio');
    report.depth=a2.depth;
    assert(report.depth.every(d=>d.speed>.0001&&d.density>.0001),'A depth region is empty or frozen');
    for(const [label,near,far] of [['E-background',2/3,1],['E-middle',1/3,2/3],['E-foreground',0,1/3]]) {
      await run(`gpuTest.depthWindow(${near},${far})`);
      await fs.writeFile(path.join(output,`${label}.png`),(await win.webContents.capturePage()).toPNG());
    }
    await run('gpuTest.depthWindow(0,1)');
    report.resize=await run('gpuTest.resizeCheck()');
    assert(report.resize.before===report.resize.after,'Resize reset the simulation');
    report.memoryAfterControlDisposal=await run('gpuTest.stopControl()');
    report.singleVolumePerformance=await run(`gpuTest.realtime('silence',6)`);
    stable(report.singleVolumePerformance);
    report.memoryBeforeStability=report.singleVolumePerformance.memory;
    console.log(`Single volume at 1080p: ${report.singleVolumePerformance.fps.toFixed(1)} FPS`);
    // Five minutes of additional simulated time at fixed 1/60 s. Batches make
    // progress observable; readbacks here are testing, never shipping behavior.
    for(let minute=1;minute<=5;minute++) {
      for(let batch=0;batch<12;batch++)await run(`gpuTest.advance(5,'silence')`);
      const s=await run('gpuTest.stats()');stable(s);report.stability.push(s);
      assert(s.memory.textures===report.memoryBeforeStability.textures,'Texture allocation grew over time');
      console.log(`Stability: +${minute} simulated minutes; max speed ${s.maxSpeed.toFixed(5)}; variance ${s.densityVariance.toFixed(5)}`);
    }
    report.finalWarm=await run(`gpuTest.realtime('silence',2)`);stable(report.finalWarm);
    await fs.writeFile(path.join(output,'stability-final.png'),(await win.webContents.capturePage()).toPNG());
    report.disposed=await run('gpuTest.dispose()');
    assert(report.disposed.textures===0&&report.disposed.geometries===0,'GPU resources leaked on disposal');
    assert(report.errors.length===0,report.errors.join('\n'));
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    console.log('Atmosphere GPU validation passed');app.exit(0);
  } catch(error) {
    report.errors.push(String(error.stack||error));
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    if(win)await fs.writeFile(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG()).catch(()=>{});
    console.error(error);app.exit(1);
  }
});
