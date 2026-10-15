const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const out=path.resolve('artifacts/atmosphere-morphology');
app.setPath('userData',path.resolve('.cache/atmosphere-morphology-profile'));
const report={baseline:'Prompt 7 production shaders, same clock/input/grid/theme',frames:[],errors:[]};
const assert=(v,message)=>{if(!v)throw new Error(message);};
let win;
app.whenReady().then(async()=>{
  await fs.mkdir(out,{recursive:true});
  win=new BrowserWindow({width:960,height:540,useContentSize:true,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});win.showInactive();
  const run=code=>win.webContents.executeJavaScript(code,true);
  const capture=async(label,side)=>fs.writeFile(path.join(out,`${label}.png`),Buffer.from(await run(`morphologyTest.show(${side})`),'base64'));
  try {
    await win.loadURL('http://127.0.0.1:5174/tests/atmosphere-morphology-gpu.html');
    assert(await run('morphologyTest.ready'),'FP16 gas unavailable');report.hardware=await run('morphologyTest.hardware');
    for(const seconds of [0,4,8]) {
      if(seconds)await run(`morphologyTest.advance(${seconds})`);
      const frame=await run('morphologyTest.compare()');report.frames.push(frame);console.log(JSON.stringify(frame));
      await capture(`silent-${Math.round(frame.seconds)}-before`,0);await capture(`silent-${Math.round(frame.seconds)}-after`,1);
      assert(frame.glError===0&&frame.errors.length===0,'GPU errors');
      assert(frame.after.emptyFraction>frame.before.emptyFraction+.25,'No meaningful gain in empty space');
      assert(frame.after.largestBodyFraction<frame.before.largestBodyFraction*.55,'Formations remain fused');
      assert(frame.after.thinOccupiedFraction>frame.before.thinOccupiedFraction*1.5,'No increase in thin structures');
      assert(frame.after.coverage>.12&&frame.after.components>=2,'Lost visible formations');
    }
    report.emptyVolume=await run('morphologyTest.emptyVolume()');
    assert(report.emptyVolume[0]>.001&&report.emptyVolume[1]===0,'Empty gas still creates a visible veil');
    report.officialColors=await run('morphologyTest.colors(1)');
    await run('morphologyTest.theme(true)');await capture('custom-before',0);await capture('custom-after',1);
    report.customColors=await run('morphologyTest.colors(1)');
    assert(report.customColors.red>report.officialColors.red+.0005&&report.customColors.yellow>report.officialColors.yellow+.0005,'Red/yellow absent from formations');
    await run(`morphologyTest.advance(6,'A-hits')`);report.audio=await run('morphologyTest.compare()');
    await capture('audio-before',0);await capture('audio-after',1);
    report.acousticState=[await run('morphologyTest.state(0)'),await run('morphologyTest.state(1)')];
    assert(report.acousticState[1].applied>=4&&report.acousticState[0].applied===report.acousticState[1].applied,'Acoustic event lifecycle changed');
    await run('morphologyTest.theme(false)');
    for(const [name,near,far] of [['front',0,1/3],['middle',1/3,2/3],['back',2/3,1]]) {
      const d=await run(`morphologyTest.depth(1,${near},${far})`);await fs.writeFile(path.join(out,`${name}.png`),Buffer.from(d.png,'base64'));delete d.png;report[name]=d;
      assert(d.coverage>.005,'Empty depth layer '+name);
    }
    report.memoryStart=await run('morphologyTest.memory()');report.stability=[];
    for(let minute=1;minute<=3;minute++) {
      await run('morphologyTest.advance(60)');const metrics=await run('morphologyTest.compare()'),state=await run('morphologyTest.state(1)');
      const memory=await run('morphologyTest.memory()');report.stability.push({metrics,state,memory});
      assert(state.invalid===0&&state.maxSpeed<=.0852&&state.maxDensity<=1.001,'Unstable morphology');
      assert(metrics.after.emptyFraction>.25&&metrics.after.coverage>.06,'Morphology filled or disappeared over time');
      assert(memory.textures===report.memoryStart.textures,'GPU memory grew');
      console.log('Morphology stability '+minute+' min: '+JSON.stringify(metrics.after));
    }
    await capture('long-before',0);await capture('long-after',1);
    report.performance={before:await run('morphologyTest.performanceRun(0)'),after:await run('morphologyTest.performanceRun(1)')};
    assert(report.performance.after.fps>58,'Cannot sustain 60 FPS target on this GPU');
    report.disposed=await run('morphologyTest.dispose()');
    assert(report.disposed.textures===0&&report.disposed.geometries===0,'GPU leak');report.passed=true;
    await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
    await fs.writeFile(path.join(out,'comparison.html'),require('./atmosphere-morphology-report.cjs').renderReport(report));
    console.log('Morphology GPU validation passed: '+JSON.stringify(report.performance));app.exit(0);
  }catch(error){report.errors.push(String(error.stack||error));await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.error(error);app.exit(1);}
});
