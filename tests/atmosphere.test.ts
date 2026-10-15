import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';
import { AtmosphereVolume, GAS_GRID, atmosphereQuality, volumeImageSize } from '../src/visual/AtmosphereVolume.ts';
import { makeVolumeDetailData } from '../src/visual/volumeDetail.ts';
import { AtmosphereAcoustics } from '../src/visual/atmosphereAcoustics.ts';
import { FeatureExtractor, emptyFeatures, ACOUSTIC_EVENT_HISTORY } from '../src/audio/features.ts';
import { SignalWindow, makeSignal, eventTimes, type TemporalCase } from './fixtures/atmosphere-signals.ts';
import { AtmospherePlumes, plumeDuration, plumeIntegral, PLUME_CAPACITY } from '../src/visual/atmospherePlumes.ts';

test('Atmosphere responds quickly, retains absolute dynamics and releases without cross-band excitation',()=>{
  const quiet=new AtmosphereAcoustics(),loud=new AtmosphereAcoustics();
  const f=emptyFeatures();f.rms=.004;f.bands[3].fast=.7;f.bands[3].salience=.6;f.bands[3].sustained=.4;
  for(let i=0;i<6;i++)quiet.update(f,1/60);
  f.rms=.2;
  for(let i=0;i<6;i++)loud.update(f,1/60);
  assert.ok(quiet.bands[3]>.68,'Fast observation must reach the volume within 100 ms');
  assert.ok(loud.gain.value>quiet.gain.value*1.7,'Adaptive normalization must retain absolute dynamics');
  assert.equal(quiet.salience[3],Math.fround(.6));
  assert.equal(quiet.sustained[3],Math.fround(.4));
  assert.equal(quiet.bands[1],0);
  quiet.update(emptyFeatures(),1/60);
  assert.ok(quiet.bands[3]>.6,'Excitation must release continuously');
  for(let i=0;i<180;i++)quiet.update(emptyFeatures(),1/60);
  assert.ok(quiet.bands[3]<.00001);
});

test('volumetric atlas covers every depth cell and image budgets preserve aspect',()=>{
  assert.equal(GAS_GRID.columns*GAS_GRID.rows,GAS_GRID.z);
  for(const quality of ['eco','balanced','high'] as const) {
    const image=volumeImageSize(1920,1080,quality);
    assert.ok(image.width<=1920&&image.height<=1080);
    assert.ok(image.width*image.height<=atmosphereQuality[quality].pixels+2000);
    assert.ok(Math.abs(image.width/image.height-1920/1080)<.005);
    const reduced=volumeImageSize(1920,1080,quality,.7);
    assert.ok(reduced.width*reduced.height<image.width*image.height*.51);
  }
  assert.deepEqual(volumeImageSize(0,0,'eco'),{width:1,height:1});
});

test('3D detail is reproducible, bounded, varied and independent of frame time',()=>{
  const first=makeVolumeDetailData(16),second=makeVolumeDetailData(16);
  assert.deepEqual(first,second);
  assert.equal(first.length,16*16*16*4);
  let min=255,max=0,sum=0,different=0;
  for(let i=0;i<first.length;i+=4) {
    assert.equal(first[i+3],255);
    min=Math.min(min,first[i]);max=Math.max(max,first[i]);sum+=first[i];
    if(first[i]!==first[i+1])different++;
  }
  assert.ok(max-min>90);
  assert.ok(sum/(first.length/4)/255>.35&&sum/(first.length/4)/255<.65);
  assert.ok(different>first.length/8);
  for(const invalid of [0,7,31,256])assert.throws(()=>makeVolumeDetailData(invalid));
});

test('missing float attachments retains the legacy material without GPU allocation',()=>{
  const renderer={extensions:{has:()=>false}} as unknown as THREE.WebGLRenderer;
  const volume=new AtmosphereVolume(renderer,{});
  assert.equal(volume.supported,false);
  volume.configure(1920,1080,'balanced');
  volume.advance(1,.8);volume.draw();volume.restore();volume.dispose();volume.dispose();
  assert.equal(volume.texture,null);
  assert.equal(volume.seconds,0);
  assert.ok(volume.debug.includes('anterior'));
});

test('acquisition log preserves skipped ticks, original strength and one-time GPU consumption',()=>{
  const f=emptyFeatures(),a=new AtmosphereAcoustics();
  f.time=.05;
  f.events.push({id:1,time:.016,band:1,strength:.8,rms:.1},{id:2,time:.032,band:5,strength:.5,rms:.02});
  a.update(f,1/60);assert.equal(a.pending,2);
  assert.equal(a.active,0,'Pending or hidden events are not physical wakes');
  const strengths=[a.impulses[3],a.impulses[7]];
  a.update(f,1/144);assert.equal(a.pending,2,'Frames without a GPU step must retain both events');
  assert.deepEqual([a.impulses[3],a.impulses[7]],strengths);
  a.consumeImpulses();assert.equal(a.applied,2);assert.equal(a.pending,0);
  assert.equal(a.active,2);
  for(let i=0;i<100;i++){a.update(f,1/60);a.consumeImpulses();}
  assert.equal(a.applied,2,'A decaying envelope must never retrigger the same event');
  assert.ok(a.lastEventAge>1.6);
  const next=emptyFeatures();next.time=1;next.events.push({id:1,time:0,band:3,strength:1,rms:1});
  a.update(next,1/60);assert.equal(a.pending,0,'Do not replay old events on reconnect');
  next.events.push({id:2,time:1,band:3,strength:.8,rms:.1});
  a.update(next,1/60);assert.equal(a.pending,1,'Independent source IDs can restart');
});

test('sensitivity admits quieter events without multiplying their physical magnitude',()=>{
  const f=emptyFeatures();f.events.push({id:1,time:0,band:3,strength:.13,rms:.01});
  const normal=new AtmosphereAcoustics(),max=new AtmosphereAcoustics();
  normal.update(f,1/60,false,1.2);max.update(f,1/60,false,3);
  assert.equal(normal.pending,0);assert.equal(max.pending,1);
  const strong=emptyFeatures();strong.events.push({id:1,time:0,band:3,strength:.8,rms:.1});
  normal.update(strong,1/60,false,1.2);max.update(strong,1/60,false,3);
  assert.equal(normal.impulses[3],max.impulses[3]);
});

test('causal FFT fixtures detect four isolated attacks and maintain silence between them',()=>{
  for(const fps of [30,60,144]) {
    const e=new FeatureExtractor(2048,48000),w=new SignalWindow(makeSignal('A-hits')),a=new AtmosphereAcoustics();
    const times:number[]=[];
    for(let frame=1;frame<=6*fps;frame++) {
      const t=frame/fps;w.at(t);a.update(e.update(w.wave,w.spectrum,1/fps,1.2,.7),1/fps);
      if(a.pending){times.push(t);a.consumeImpulses();}
    }
    assert.equal(times.length,4,`${fps} Hz: ${times}`);
    times.forEach((t,i)=>assert.ok(t-eventTimes('A-hits')[i]<.15));
  }
});

test('causal fixture FFT preserves Blackman amplitude and neighboring window bins',()=>{
  const pcm=Float32Array.from({length:48000},(_,i)=>.2*Math.sin(i*2*Math.PI*1007.8125/48000));
  const window=new SignalWindow(pcm).at(.5);
  const amplitude=(bin:number)=>10**(window.spectrum[bin]/20);
  assert.ok(Math.abs(amplitude(86)-.2*.42/2)<1e-7);
  assert.ok(Math.abs(amplitude(85)-.2*.25/2)<1e-7);
  assert.ok(Math.abs(amplitude(84)-.2*.04/2)<1e-7);
  assert.ok(amplitude(81)<1e-8);
});

test('causal FFT event history is bounded and sustained PCM does not manufacture repeated strikes',()=>{
  for(const name of ['B-bass-hits','C-bands','D-voice','E-gates'] as TemporalCase[]) {
    const e=new FeatureExtractor(2048,48000),w=new SignalWindow(makeSignal(name)),a=new AtmosphereAcoustics();
    for(let frame=1;frame<=360;frame++) {
      w.at(frame/60);a.update(e.update(w.wave,w.spectrum,1/60,1.2,.7),1/60);a.consumeImpulses();
      assert.ok(e.value.events.length<=ACOUSTIC_EVENT_HISTORY);
    }
    assert.ok(a.detected>=eventTimes(name).length,`${name}: ${a.detected} events`);
    assert.ok(a.lastEventAge>.5,`${name}: false onsets during silence`);
    assert.equal(a.dropped,0);
  }
});

test('plume attack/bloom spends a finite budget continuously at different step rates',()=>{
  for(const band of [1,3,6]) for(const fps of [30,60,144]) {
    const a=new AtmosphereAcoustics(),f=emptyFeatures(),p=new AtmospherePlumes();
    f.events.push({id:1,time:0,band,strength:1,rms:.1});a.update(f,1/fps);
    p.begin(a);a.consumeImpulses();
    let total=0,first=0;
    for(let frame=0;frame<fps;frame++) {
      p.step(1/fps);const dose=p.phases[2];total+=dose;if(frame===0)first=dose;
      assert.ok(dose>=0&&dose<.18*60/fps);
    }
    assert.ok(Math.abs(total-1)<1e-6,`${band}/${fps}: ${total}`);
    assert.ok(first<.20,'No full one-frame event injection');
    assert.equal(p.active,0);assert.equal(p.born,1);
    assert.ok(plumeIntegral(.001,plumeDuration(band))<.001);
  }
});

test('simultaneous emitters stay bounded and a counterfactual copies their lifecycle',()=>{
  const a=new AtmosphereAcoustics(),f=emptyFeatures(),p=new AtmospherePlumes();
  for(let i=0;i<7;i++)f.events.push({id:i+1,time:0,band:i,strength:.8,rms:.1});
  a.update(f,1/60);p.begin(a);a.consumeImpulses();p.step(1/60);
  const copy=new AtmospherePlumes();copy.copyFrom(p);
  p.step(1/60);copy.step(1/60);assert.deepEqual(p.phases,copy.phases);
  assert.equal(p.active,7);assert.equal(p.born,7);
  for(let round=0;round<5;round++) {
    const next=emptyFeatures();
    for(let i=0;i<7;i++)next.events.push({id:i+1,time:0,band:i,strength:.8,rms:.1});
    a.update(next,1/60);p.begin(a);a.consumeImpulses();
  }
  assert.ok(p.active<=PLUME_CAPACITY);assert.ok(p.replaced>0);
  p.clear();assert.equal(p.active,0);assert.ok(p.sources.every(x=>x===0));
});

test('a confident new quiet band survives a strong background without promoting sidelobes',()=>{
  const a=new AtmosphereAcoustics(),f=emptyFeatures();
  f.events.push({id:1,time:0,band:3,strength:1,rms:.1,spectralShare:.001},
    {id:2,time:0,band:2,strength:.25,rms:.1,spectralShare:.00006});
  a.update(f,1/60);assert.equal(a.pending,1);assert.equal(a.impulseBands[0],3);
});

test('a candidate that starts weak is admitted once as its causal FFT confidence grows',()=>{
  const a=new AtmosphereAcoustics(),f=emptyFeatures();f.rms=.1;f.signal=true;
  f.events.push({id:1,time:0,band:3,strength:.4,rms:.1,spectralShare:.0005});
  f.bands[1].energy=.02;f.bands[3].energy=1e-8;f.bands[3].flux=1;
  a.update(f,1/60);assert.equal(a.pending,0);
  f.time=1/60;f.bands[3].energy=1e-5;f.bands[3].flux=.8;
  a.update(f,1/60);assert.equal(a.pending,1);
  a.consumeImpulses();a.update(f,1/60);assert.equal(a.pending,0);assert.equal(a.applied,1);
});
