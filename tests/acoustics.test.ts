import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAND_EDGES, FeatureExtractor, emptyFeatures } from '../src/audio/features.ts';
import { MaterialResponse, EVENT_CAPACITY } from '../src/visual/response.ts';

const size = 4096, rate = 48000, bins = size/2;
// Reproducible bin-centered additive signals; their analytic FFT is exact for
// this rectangular window. No external FFT implementation under test.
function fixture(tones: [number,number][], noise = 0) {
  const wave = new Float32Array(size), spectrum = new Float32Array(bins).fill(-Infinity);
  let seed = 0x12345678;
  for (let i=0;i<size;i++) {
    seed = (Math.imul(seed,1664525)+1013904223)>>>0;
    wave[i] = noise*((seed/0x100000000)*2-1);
    for (const [hz,a] of tones) wave[i] += a*Math.sin(i*2*Math.PI*Math.round(hz*size/rate)/size);
  }
  if (noise) spectrum.fill(20*Math.log10(noise/Math.sqrt(bins*3)));
  for (const [hz,a] of tones) spectrum[Math.round(hz*size/rate)] = 20*Math.log10(a/2);
  return {wave,spectrum};
}
function feed(e: FeatureExtractor, s: ReturnType<typeof fixture>, seconds: number, fps = 60) {
  for (let i=0;i<Math.round(seconds*fps);i++) e.update(s.wave,s.spectrum,1/fps);
  return e.value;
}
function finiteTree(value: unknown) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value),String(value));
  else if (value && typeof value === 'object') for (const v of Object.values(value)) finiteTree(v);
}

test('all seven bands are independent, respect FFT resolution and sample-rate Nyquist', () => {
  for (const [i,hz] of [47,117,351,1008,3000,5004,9000].entries()) {
    const e = new FeatureExtractor(bins,rate);
    const f = feed(e,fixture([[hz,.12]]),5);
    assert.ok(f.bands[i].fast>.4,`${i}: excitation`);
    assert.ok(f.bands[i].energy>0);
    for (let j=0;j<7;j++) if (j!==i) assert.equal(f.bands[j].energy,0,`${i} leaks to ${j}`);
    assert.ok(Math.abs(f.centroidHz-hz)<rate/size);
    assert.ok(Math.abs(f.rolloffHz-hz)<rate/size);
  }
  const e = new FeatureExtractor(512,8000);
  const spectrum = new Float32Array(512).fill(-Infinity);
  spectrum[500] = -20;
  e.update(new Float32Array(1024).fill(.1),spectrum,1/60);
  assert.equal(e.value.bands[6].energy,0);
  assert.equal(e.value.bands[6].highHz,4000);
  for (let i=0;i<7;i++) assert.equal(e.value.bands[i].lowHz,Math.min(BAND_EDGES[i],4000));
});

test('quiet and loud steady signals remain responsive without perpetual saturation or onsets', () => {
  const levels: number[] = [];
  for (const amplitude of [.004,.04,.7]) {
    const e = new FeatureExtractor(bins,rate), s = fixture([[1008,amplitude]]);
    feed(e,s,25);
    levels.push(e.value.energy);
    const events = e.value.eventId;
    feed(e,s,5);
    assert.equal(e.value.eventId,events);
    assert.ok(e.value.impulse<.001);
    assert.ok(e.value.bands[3].sustained>.15);
    assert.ok(e.value.energy>.15 && e.value.energy<.8);
    assert.ok(e.value.bands[3].salience<.18);
    assert.ok(e.value.bands[3].variation<.001);
    finiteTree(e.value);
  }
  assert.ok(Math.max(...levels)-Math.min(...levels)<.3);
});

test('stable background survives a sudden impact in a different region', () => {
  const e = new FeatureExtractor(bins,rate), background = fixture([[1008,.08]]);
  feed(e,background,20);
  const events = e.value.bands[1].eventId;
  const sustained = e.value.bands[3].sustained;
  feed(e,fixture([[1008,.08],[117,.45]]),.05);
  assert.ok(e.value.bands[1].eventId>events);
  assert.ok(e.value.bands[1].transient>.5);
  assert.ok(e.value.bands[1].salience>.3);
  assert.ok(e.value.bands[3].sustained>sustained*.9);
  feed(e,background,3);
  assert.ok(e.value.bands[1].transient<.01);
  assert.ok(e.value.bands[3].fast>.3);
});

test('simultaneous new sustained regions are salient against their own history, then settle', () => {
  const e = new FeatureExtractor(bins,rate), base = fixture([[117,.2]]);
  feed(e,base,20);
  const combined = fixture([[117,.2],[1008,.06],[9000,.025]]);
  feed(e,combined,.4);
  assert.ok(e.value.bands[3].salience>.45);
  assert.ok(e.value.bands[6].salience>.45);
  assert.ok(e.value.bands[1].fast>.3);
  feed(e,combined,2);
  assert.ok(e.value.bands[3].sustained>.15);
  assert.ok(e.value.bands[6].sustained>.15);
  feed(e,combined,35);
  assert.ok(e.value.bands[3].salience<.18);
  assert.ok(e.value.bands[6].salience<.18);
});

test('a real short impulse is detected and spectral noise differs from a tone', () => {
  const e = new FeatureExtractor(bins,rate);
  const zero = fixture([]);
  feed(e,zero,5);
  const wave = new Float32Array(size); wave[100] = .8;
  const spectrum = new Float32Array(bins).fill(20*Math.log10(.8/size));
  e.update(wave,spectrum,1/60);
  assert.ok(e.value.eventId>0);
  assert.ok(e.value.crest>20);
  assert.ok(e.value.flatness>0);
  const noise = feed(new FeatureExtractor(bins,rate),fixture([],.04),3);
  const tone = feed(new FeatureExtractor(bins,rate),fixture([[1008,.04]]),3);
  assert.ok(noise.flatness>.9);
  assert.ok(tone.flatness<.01);
});

test('mono, identical stereo, panning and anti-phase retain finite independent cues', () => {
  const e = new FeatureExtractor(bins,rate), s = fixture([[1008,.1]]);
  const zero = new Float32Array(size);
  for (let i=0;i<240;i++) e.update(s.wave,s.spectrum,1/60,1,.65,s.wave,s.wave);
  assert.ok(e.value.stereo && Math.abs(e.value.balance)<.001 && e.value.width<.001);
  assert.ok(e.value.correlation>.99);
  for (let i=0;i<240;i++) e.update(s.wave,s.spectrum,1/60,1,.65,zero,s.wave);
  assert.ok(e.value.balance>.99);
  const inverted = Float32Array.from(s.wave,v=>-v);
  for (let i=0;i<240;i++) e.update(zero,s.spectrum,1/60,1,.65,s.wave,inverted);
  assert.ok(e.value.signal && e.value.rms>.06 && e.value.width>.99 && e.value.correlation<-.99);
  e.update(s.wave,s.spectrum,1/60);
  assert.equal(e.value.stereo,false);
  finiteTree(e.value);
});

test('analysis envelopes are comparable at different real-time update rates', () => {
  const s = fixture([[117,.1],[5004,.03]]), results = [30,60,144].map(fps=> {
    const e = new FeatureExtractor(bins,rate);
    feed(e,s,2,fps);
    return [e.value.energy,e.value.sustained,e.value.bands[1].fast,e.value.bands[5].slow];
  });
  for (let i=0;i<4;i++) assert.ok(Math.abs(results[0][i]-results[2][i])<.015);
});

test('long silence, noise floor, restart, corrupt buffers and dt never yield invalid values', () => {
  const e = new FeatureExtractor(bins,rate), silence = fixture([]);
  feed(e,fixture([[117,.2]]),2);
  feed(e,silence,60);
  assert.equal(e.value.signal,false);
  assert.ok(e.value.energy<1e-5 && e.value.sustained<1e-5 && e.value.salience<1e-5);
  feed(e,fixture([],.00005),3);
  assert.equal(e.value.signal,false);
  feed(e,fixture([[1008,.02]]),.2);
  assert.ok(e.value.signal && e.value.impulse>.2);
  for (const dt of [NaN,Infinity,-1,0,3]) {
    e.update(new Float32Array([NaN,Infinity,-Infinity]),new Float32Array(bins).fill(NaN),dt,NaN,NaN);
    finiteTree(e.value);
  }
  // Web Audio float buffers may exceed unity; the real meter must not clip them.
  e.update(new Float32Array(size).fill(1.25),silence.spectrum,1/60);
  assert.equal(e.value.rms,1.25);
  assert.equal(e.value.peak,1.25);
});

test('visual springs, overlapping events and tension preserve memory without repeated onsets', () => {
  const r = new MaterialResponse(), f = emptyFeatures();
  f.bands[1].fast = .7; f.bands[1].sustained = .5; f.bands[1].salience = .7;
  f.bands[1].eventId = 1; f.bands[1].transient = .8;
  f.bands[5].eventId = 1; f.bands[5].transient = .5;
  r.update(f,1/60,false,.65);
  assert.ok(Math.abs(r.events[3]-.8)<1e-6); assert.equal(r.events[7],.5);
  const initial = r.bands[1];
  for (let i=0;i<120;i++) r.update(f,1/60,false,.65);
  assert.ok(r.bands[1]>initial+.3 && r.tension[1]>.2);
  assert.ok(r.events[2]>1.9 && r.events[6]>1.9);
  const tension = r.tension[1];
  r.update(emptyFeatures(),1/60,false,.65);
  assert.ok(r.tension[1]>tension*.95);
  for (let i=0;i<1200;i++) r.update(emptyFeatures(),1/60,false,.65);
  assert.ok(r.bands[1]<.001 && r.tension[1]<.001);
  assert.equal(r.events.length,EVENT_CAPACITY*4);
  for (const array of [r.bands,r.events,r.tension,r.sustained]) for (const v of array) assert.ok(Number.isFinite(v));
});
