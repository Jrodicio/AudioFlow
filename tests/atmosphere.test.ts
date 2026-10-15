import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';
import { AtmosphereVolume, GAS_GRID, atmosphereQuality, volumeImageSize } from '../src/visual/AtmosphereVolume.ts';
import { makeVolumeDetailData } from '../src/visual/volumeDetail.ts';
import { AtmosphereAcoustics } from '../src/visual/atmosphereAcoustics.ts';
import { emptyFeatures } from '../src/audio/features.ts';

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
