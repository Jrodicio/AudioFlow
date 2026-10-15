import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FeatureExtractor, damp } from '../src/audio/features.ts';
import { defaults, parseSettings } from '../src/settings.ts';

const bins = 1024;
function tone(hz: number, amplitude = .2) {
  const wave = Float32Array.from({ length: 2048 }, (_, i) => amplitude*Math.sin(i*2*Math.PI*hz/48000));
  const spectrum = new Float32Array(bins).fill(-Infinity);
  spectrum[Math.round(hz/(48000/2048))] = 20*Math.log10(amplitude);
  return { wave, spectrum };
}

test('silence remains finite, motion input decays and noise does not normalize to full energy', () => {
  const extractor = new FeatureExtractor(bins, 48000);
  const loud = tone(90);
  for (let i=0;i<120;i++) extractor.update(loud.wave,loud.spectrum,1/60);
  const zero = new Float32Array(2048), spectrum = new Float32Array(bins).fill(-Infinity);
  for (let i=0;i<2400;i++) extractor.update(zero,spectrum,1/60);
  assert.equal(extractor.value.signal,false);
  assert.ok(extractor.value.energy < .0001);
  assert.ok(extractor.value.atmosphere < .001);
  assert.equal(extractor.value.centroid < .001,true);
  for (const [name,value] of Object.entries(extractor.value)) if (typeof value === 'number') assert.ok(Number.isFinite(value),name);
  const noise = new Float32Array(2048).fill(.00005);
  for (let i=0;i<600;i++) extractor.update(noise,spectrum,1/60,3);
  assert.equal(extractor.value.signal,false);
  assert.ok(extractor.value.energy < .001);
});

test('separates bass, midrange, treble and centroid', () => {
  for (const [hz,band] of [[94,'bass'],[1008,'mids'],[8016,'treble']] as const) {
    const extractor = new FeatureExtractor(bins,48000);
    const signal=tone(hz);
    for (let i=0;i<600;i++) extractor.update(signal.wave,signal.spectrum,1/60);
    assert.ok(extractor.value[band] > .3,band);
    for (const other of ['bass','mids','treble'] as const) if (other!==band) assert.equal(extractor.value[other],0);
    assert.ok(Math.abs(extractor.value.centroid - hz/10000) < .01);
    assert.ok(Math.abs(extractor.value.rms - .2/Math.sqrt(2)) < .002);
  }
});

test('transients are impulses with a refractory period and sustained tones settle', () => {
  const extractor=new FeatureExtractor(bins,48000), signal=tone(117);
  const first=extractor.update(signal.wave,signal.spectrum,1/60).impulse;
  assert.ok(first>.5);
  for(let i=0;i<120;i++) extractor.update(signal.wave,signal.spectrum,1/60);
  assert.ok(extractor.value.impulse<.01);
  assert.equal(extractor.value.flux < .001,true);
});

test('attack/release is largely independent of frame rate', () => {
  let a=0,b=0;
  for(let i=0;i<60;i++) a=damp(a,1,1/60,.7);
  for(let i=0;i<144;i++) b=damp(b,1,1/144,.7);
  assert.ok(Math.abs(a-b)<1e-10);
});

test('relative normalization adapts and slowly follows long-term energy', () => {
  const extractor=new FeatureExtractor(bins,48000), soft=tone(300,.02), loud=tone(300,.3);
  for(let i=0;i<1200;i++) extractor.update(soft.wave,soft.spectrum,1/60);
  const previous=extractor.value.relative;
  for(let i=0;i<100;i++) extractor.update(loud.wave,loud.spectrum,1/60);
  assert.ok(extractor.value.relative>previous+.15);
  assert.ok(extractor.value.shortEnergy>extractor.value.longEnergy);
});

test('preferences tolerate corrupt, obsolete and out-of-range data', () => {
  assert.deepEqual(parseSettings('{broken'),defaults);
  assert.deepEqual(parseSettings('null'),defaults);
  assert.deepEqual(parseSettings('{}'),defaults);
  const result=parseSettings(JSON.stringify({ style:'strobe',sensitivity:90,intensity:-2,softness:'bad',quality:'ultra',auto:true }));
  assert.equal(result.style,defaults.style);
  assert.equal(result.sensitivity,3);
  assert.equal(result.intensity,0);
  assert.equal(result.softness,defaults.softness);
  assert.equal(result.quality,defaults.quality);
  assert.equal(result.auto,true);
});
