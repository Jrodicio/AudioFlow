import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SystemAudio, captureError, type CaptureSnapshot } from '../src/audio/capture.ts';

test('capture errors distinguish denial, unavailable output and exclusive device access', () => {
  for (const [name,fragment] of [['NotAllowedError','denegó'],['NotFoundError','salida'],['NotReadableError','exclusivo']] as const) {
    assert.ok(captureError(new DOMException('',name)).includes(fragment));
  }
});

test('capture lifecycle: loopback only, independent acquisition, cancellation and track loss', async (t) => {
  let tick = () => {};
  let now = 1000;
  t.mock.method(globalThis,'setInterval',(callback: () => void) => { tick = callback; return 1; });
  t.mock.method(globalThis,'clearInterval',() => {});
  t.mock.method(performance,'now',() => now);
  let tracks: ReturnType<typeof track>[]=[];
  let channelCount = 1;
  let stereoSignal = false;
  function track(kind: string) {
    const listeners: (()=>void)[]=[];
    return { kind,readyState:'live',getSettings(){ return {channelCount}; },stop(){ this.readyState='ended'; },addEventListener(_name:string,cb:()=>void){ listeners.push(cb); },end(){this.readyState='ended';listeners.forEach(cb=>cb());} };
  }
  let resolver: ((value: unknown)=>void) | null=null;
  let pending=false, closes=0, connections=0;
  let constraints: DisplayMediaStreamOptions | undefined;
  const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const originalContext=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');
  const originalStream=Object.getOwnPropertyDescriptor(globalThis,'MediaStream');
  const stream=()=>({getAudioTracks:()=>tracks.filter(t=>t.kind==='audio'),getVideoTracks:()=>tracks.filter(t=>t.kind==='video'),getTracks:()=>tracks});
  class MockContext {
    index = 0;
    state='running';sampleRate=48000;onstatechange=null;
    resume(){return Promise.resolve();}
    close(){closes++;this.state='closed';return Promise.resolve();}
    createAnalyser(){const index=this.index++;return {fftSize:2048,frequencyBinCount:1024,disconnect(){},getFloatTimeDomainData(a:Float32Array){a.fill(stereoSignal && index ? (index===1 ? .1 : -.1) : 0);},getFloatFrequencyData(a:Float32Array){a.fill(-Infinity);if(stereoSignal && index)a[32]=-20;}};}
    createChannelSplitter(){return {connect(target:unknown){assert.notEqual(target,'destination');},disconnect(){}};}
    createMediaStreamSource(){return {connect(target:unknown){connections++;assert.notEqual(target,'destination');},disconnect(){}};}
    destination='destination';
  }
  Object.defineProperty(globalThis,'window',{ configurable:true,value:{audioflow:{platform:'win32',armCapture:async()=>{},disarmCapture:async()=>{}}} });
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getDisplayMedia:(c:DisplayMediaStreamOptions)=>{constraints=c;return pending?new Promise(r=>{resolver=r;}):Promise.resolve(stream());},getUserMedia(){throw new Error('Microphone must never be requested');}}}});
  Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:MockContext});
  Object.defineProperty(globalThis,'MediaStream',{configurable:true,value:class{constructor(_tracks:unknown){}}});
  const snapshots: CaptureSnapshot[]=[];
  const input=new SystemAudio(s=>snapshots.push({...s}));
  try {
    tracks=[track('audio'),track('video')];
    await input.start();
    assert.ok(constraints?.audio && constraints?.video);
    assert.equal(tracks[0].readyState,'live');
    assert.equal(tracks[1].readyState,'ended');
    assert.equal(connections,1);
    // Acquisition/status continues with no render/sample calls at all.
    for(let i=0;i<140;i++) { now += 1000/60; tick(); }
    assert.equal(input.snapshot.status,'silent');
    tracks[0].end();
    assert.equal(input.snapshot.status,'error');
    assert.equal(tracks.every(t=>t.readyState==='ended'),true);
    assert.ok(closes>0);
    pending=true;tracks=[track('audio'),track('video')];
    const starting=input.start();
    for(let i=0;i<10 && !resolver;i++) await Promise.resolve();
    assert.ok(resolver);
    input.stop();
    (resolver as (value:unknown)=>void)(stream());
    await starting;
    assert.equal(input.snapshot.status,'idle');
    assert.ok(tracks.every(t=>t.readyState==='ended'));
    assert.equal(connections,1);
    pending=false;tracks=[track('video')];
    await input.start();
    assert.equal(input.snapshot.status,'error');
    assert.ok(input.snapshot.message.includes('no entregó audio'));
    assert.equal(tracks[0].readyState,'ended');
    assert.ok(snapshots.some(s=>s.status==='requesting'));
    channelCount=2;stereoSignal=true;tracks=[track('audio'),track('video')];
    await input.start();
    for(let i=0;i<120;i++) { now+=1000/60;tick(); }
    const stereo=input.sample(1/60,1,.65);
    assert.ok(stereo.stereo && stereo.signal);
    assert.ok(Math.abs(stereo.rms-.1)<.001);
    assert.ok(stereo.bands.some(b=>b.energy>0),'Anti-phase stereo FFT must not cancel');
    assert.ok(stereo.correlation<-.9);
  } finally {
    input.dispose();
    for (const [key,value] of [['window',originalWindow],['navigator',originalNavigator],['AudioContext',originalContext],['MediaStream',originalStream]] as const) {
      if(value) Object.defineProperty(globalThis,key,value);
      else Reflect.deleteProperty(globalThis,key);
    }
  }
});
