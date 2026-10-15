const {renderReport}=require('./atmosphere-temporal-report.cjs');
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const isPlumes=process.argv.includes('--plumes');
const output=path.resolve(isPlumes ? 'artifacts/atmosphere-plumes' : 'artifacts/atmosphere-temporal');
const profile=path.resolve('.cache/atmosphere-temporal-profile');
require('node:fs').mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const report={method:'Causal 48 kHz PCM, trailing 4096-point Blackman FFT at 60 Hz; production history. Counterfactual forks current gas before EACH onset and receives identical sustained features, with new impulses disabled. Excludes Windows loopback and display latency.',
  threshold:{imageRms:.001,changedFraction:.001,maxTileMAE:.002},cases:{},errors:[]};
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const visible=f=>f.imageRms>=report.threshold.imageRms&&f.changedFraction>=report.threshold.changedFraction&&f.maxTileMAE>=report.threshold.maxTileMAE;
let win;
app.whenReady().then(async()=>{
  await fs.mkdir(output,{recursive:true});
  win=new BrowserWindow({width:640,height:360,useContentSize:true,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const run=code=>win.webContents.executeJavaScript(code,true);
  try {
    await win.loadURL('http://127.0.0.1:5174/tests/atmosphere-gpu.html');
    assert(await run('gpuTest.ready'),'FP16 unavailable');report.hardware=await run('gpuTest.hardware');
    report.queue=await run('gpuTest.temporalQueueCheck()');
    assert(report.queue.waiting.pending===1&&report.queue.waiting.applied===0,'Sub-step frame lost its pending event');
    assert(report.queue.consumed.pending===0&&report.queue.consumed.applied===1&&report.queue.catchUp.applied===1,'GPU catch-up reinjected a consumed event');
    assert(report.queue.emittersBorn===1&&report.queue.firstDose<.04,'Event must open one smooth finite-budget emitter');
    if(isPlumes) {
      report.definition=await run('gpuTest.definitionComparison()');
      for(const [label,value] of Object.entries(report.definition)) {
        await fs.writeFile(path.join(output,`definition-${label}.png`),Buffer.from(value.png,'base64'));delete value.png;
      }
      console.log(`Definition gradient: ${report.definition.before.gradient.toFixed(5)} -> ${report.definition.after.gradient.toFixed(5)}`);
      if(process.argv.includes('--definition')) {
        await fs.writeFile(path.join(output,'definition.json'),JSON.stringify(report.definition,null,2));
        await run('gpuTest.dispose()');app.exit(0);return;
      }
    }
    for(const name of ['A-hits','B-bass-hits','C-bands','D-voice',...(isPlumes ? ['D-salient'] : []),'E-gates','F-normal','F-max',...(isPlumes ? ['G-silence'] : [])]) {
      const {onsets,wav}=await run(`gpuTest.temporalStart('${name}')`);
      await fs.writeFile(path.join(output,`${name}.wav`),Buffer.from(wav,'base64'));
      const frames=[],images=[];
      for(let i=1;i<=360;i++) {
        const f=await run('gpuTest.temporalFrame()');frames.push(f);
        const eventOffset=f.event<0 ? -1 : Math.round((f.time-onsets[f.event])*60);
        if(i%6===0 || [0,1,2,3,4,9,18].includes(eventOffset)) {
          const file=`${name}-${String(i).padStart(3,'0')}.png`;
          await fs.writeFile(path.join(output,file),Buffer.from(await run('gpuTest.temporalSnapshot()'),'base64'));
          images.push({time:f.time,file});
          if([0,2,6,9,18].includes(eventOffset)) {
            await fs.writeFile(path.join(output,file.replace('.png','-difference.png')),Buffer.from(await run('gpuTest.temporalSnapshot(true)'),'base64'));
            await fs.writeFile(path.join(output,file.replace('.png','-control.png')),Buffer.from(await run("gpuTest.temporalSnapshot('control')"),'base64'));
          }
        }
      }
      const events=onsets.map((onset,index)=>{
        const segment=frames.filter(f=>f.time>=onset-1e-8&&f.time<(onsets[index+1]??6)-1e-8);
        const detected=segment.find(f=>f.pending>0),first=segment.find(visible);
        const peak=segment.reduce((best,f)=>f.imageRms>best.imageRms?f:best,segment[0]);
        const lastImpulse=segment.filter(f=>f.pending>0).at(-1);
        const after300=segment.find(f=>f.time>=onset+.3-1e-8);
        const bloom=segment.filter(f=>f.time<=onset+.35),birth=bloom.find(f=>f.reactive?.delta>1e-6);
        const firstStep=segment.find(f=>f.pending),bloomPeak=Math.max(...bloom.map(f=>f.imageRms));
        return {onset,detectionMs:detected?Math.round((detected.time-onset)*1000):null,
          firstVisibleMs:first?Math.round((first.time-onset)*1000):null,
          eventBands:[...new Set(segment.filter(f=>f.pending).flatMap(f=>f.bands))],
          impulses:segment.reduce((n,f)=>n+f.pending,0),peakImageRms:peak.imageRms,peakAtMs:Math.round((peak.time-onset)*1000),
          lastImpulseMs:lastImpulse?Math.round((lastImpulse.time-onset)*1000):null,persistence300ms:after300?.imageRms??null,
          birthMs:birth?Math.round((birth.time-onset)*1000):null,
          reactiveMass300ms:after300?.reactive?.delta??null,
          initialStepRms:firstStep?.imageRms??0,initialJumpRatio:bloomPeak ? (firstStep?.imageRms??0)/bloomPeak : 0,
          maxFrameChangeRms:Math.max(...bloom.map(f=>f.eventFrameChangeRms))};
      });
      const state=await run('gpuTest.stats()');
      // Exclude the initial 0.5 s: B intentionally starts its sustained bass at
      // t=0, before the four measured superimposed strikes.
      const expected=frames.map(f=>onsets.some(t=>Math.abs(f.time-t)<1/120)?1:0),actual=frames.map(f=>f.time>=.5&&f.pending>0?1:0);
      const correlation=(lag)=>{
        const x=expected.slice(0,expected.length-lag),y=actual.slice(lag),n=x.length;
        const sx=x.reduce((a,b)=>a+b,0),sy=y.reduce((a,b)=>a+b,0);
        const covariance=x.reduce((sum,v,i)=>sum+v*y[i],0)-sx*sy/n;
        return covariance/Math.sqrt(Math.max(1e-12,(sx-sx*sx/n)*(sy-sy*sy/n)));
      };
      const correlations=Array.from({length:10},(_,lag)=>({lagMs:Math.round(lag/60*1000),value:correlation(lag)}));
      const impulseFrames=frames.filter(f=>f.pending&&f.time>=.5);
      const alignment={recall:events.length ? events.filter(e=>e.detectionMs!==null&&e.detectionMs<=150).length/events.length : 1,
        precision:impulseFrames.filter(f=>onsets.some(t=>f.time>=t&&f.time<=t+.3)).length/Math.max(1,impulseFrames.length),
        bestCorrelation:correlations.reduce((best,c)=>c.value>best.value?c:best,correlations[0]),correlations};
      report.cases[name]={onsets,events,frames,images,state,alignment};
      await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
      const columns=Object.keys(frames[0]).filter(k=>!['bands','strengths','impulse','reactive'].includes(k));
      await fs.writeFile(path.join(output,`${name}.csv`),[columns.join(','),...frames.map(f=>columns.map(k=>f[k]).join(','))].join('\n'));
      console.log(`${name}: detected ${events.map(e=>e.detectionMs).join('/')} ms; visible ${events.map(e=>e.firstVisibleMs).join('/')} ms; impulses ${events.map(e=>e.impulses).join('/')}; max speed ${state.maxSpeed.toFixed(4)}`);
      assert(state.invalid===0&&state.saturatedFraction<.08,`${name}: unstable volume`);
      assert(state.reactiveExcess<.001,`${name}: invalid reactive tracer`);
      if(isPlumes&&name==='A-hits')report.release=await run('gpuTest.releasePlumes(8)');
    }
    // Save inspectable artifacts even when a criterion fails.
    await fs.writeFile(path.join(output,'comparison.html'),renderReport(report));
    for(const [name,c] of Object.entries(report.cases)) {
      assert(c.events.every(e=>e.firstVisibleMs!==null&&e.firstVisibleMs<=150),`${name}: event not visible within 150 ms`);
      assert(c.events.every(e=>e.persistence300ms>.001),`${name}: missing physical wake`);
      assert(c.alignment.recall===1&&(c.alignment.precision===1||c.events.length===0),`${name}: temporal event alignment failed`);
      const quiet=c.frames.filter(f=>f.time>.2&&c.onsets.every(t=>f.time<t||f.time>t+.8));
      assert(quiet.every(f=>f.pending===0),`${name}: excitation outside active signal`);
    }
    const a=report.cases['A-hits'];
    assert(a.events.every(e=>e.impulses===1),'Isolated mid-band strikes must each inject once');
    const b=report.cases['B-bass-hits'];
    assert(b.frames.filter(f=>f.time>3&&f.time<4).every(f=>f.sustained>.05),'Sustained bass current disappeared');
    const c=report.cases['C-bands'];
    assert(c.events[0].eventBands.includes(1)&&c.events[1].eventBands.includes(3)&&c.events[2].eventBands.includes(6),'Band independence failed');
    const fields=c.onsets.slice(0,3).map(t=>c.frames.find(f=>f.time>=t&&f.impulse)?.impulse);
    assert(fields.every(Boolean),'Missing GPU impulse measurements');
    assert(fields[0].activeFraction>fields[1].activeFraction&&fields[1].activeFraction>fields[2].activeFraction,'Impulse spatial scales are not distinct');
    assert(fields[2].gradientRatio>fields[0].gradientRatio*1.5,'High-band impulse is not finer than bass');
    const normal=report.cases['F-normal'],max=report.cases['F-max'];
    assert(max.events.every((e,i)=>e.peakImageRms>normal.events[i].peakImageRms*1.1),'Maximum intensity did not increase expression');
    assert(max.events.every((e,i)=>e.firstVisibleMs<=normal.events[i].firstVisibleMs),'Maximum settings delayed events');
    if(isPlumes) {
      assert(a.state.plumesBorn===4&&a.state.activeEmitters===0,'Four strikes must create four completed emitters');
      for(const [name,c] of Object.entries(report.cases))if(c.events.length) {
        assert(c.events.every(e=>e.birthMs!==null&&e.birthMs<=100),`${name}: new reactive density missing`);
        assert(c.events.every(e=>e.reactiveMass300ms>1e-6),`${name}: event changed motion without adding matter`);
      }
      assert(a.events.every(e=>e.initialJumpRatio<.25&&e.maxFrameChangeRms<.01),'Plume onset has a hard visual pop');
      const silent=report.cases['G-silence'];
      assert(silent.state.plumesBorn===0&&silent.state.reactiveMean===0&&silent.state.rmsSpeed>.001,'Silent gas must flow without births');
      assert(report.release.after.mean<report.release.before.mean*.1&&report.release.state.activeEmitters===0,'Reactive matter did not dissipate');
      // Morphology deliberately changes occupancy and thus global mean light.
      // It is validated against the previous production morphology in its own
      // bank (opacity, empty gas, connected bodies, thin structures, depth).
      // This causal bank retains the clipping guard and every event criterion.
      assert(report.definition.after.clippedFraction<.01,'Morphology created excessive clipping');
    }
    report.passed=true;
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    await run('gpuTest.dispose()');console.log('Atmosphere temporal validation passed');app.exit(0);
  } catch(error) {
    report.errors.push(String(error.stack||error));await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    await fs.writeFile(path.join(output,'comparison.html'),renderReport(report));console.error(error);app.exit(1);
  }
});
