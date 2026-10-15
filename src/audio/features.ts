/** Frequency regions describe acoustic observations, never instruments or sources. */
export const BAND_EDGES = [25, 60, 250, 500, 2000, 4000, 6000, 18000] as const;
export const BAND_NAMES = ['Subgrave', 'Grave', 'Medio bajo', 'Medio', 'Medio alto', 'Presencia', 'Brillo'] as const;
export interface BandFeatures {
  lowHz: number; highHz: number;
  energy: number; // Sum of squared FFT magnitudes (linear power).
  normalized: number; // Bounded adaptive excitation, 0..1.
  fast: number; slow: number; history: number; // Envelopes; history is linear amplitude.
  trend: number; variation: number; // Signed trend (-1..1), absolute change (0..1).
  share: number; flux: number; salience: number; sustained: number;
  transient: number; eventId: number; // Independent onset sequence, not a frame pulse.
  active: boolean;
}
export interface AudioFeatures {
  time: number; events: AcousticEvent[];
  rms: number; instantaneous: number; peak: number; crest: number;
  bass: number; mids: number; treble: number;
  centroid: number; centroidHz: number; flux: number; rolloffHz: number;
  flatness: number; tonality: number; textureChange: number;
  shortEnergy: number; longEnergy: number; relative: number;
  energy: number; atmosphere: number; sustained: number; impulse: number;
  salience: number; eventId: number; signal: boolean;
  stereo: boolean; balance: number; width: number; correlation: number;
  bands: BandFeatures[];
}
/** Bounded acquisition log: rendering may skip analysis ticks. Strength is an
 * unsmoothed observation, independent of the legacy sensitivity gain. */
export interface AcousticEvent { id: number; time: number; band: number; strength: number; rms: number; spectralShare?: number; }
export const ACOUSTIC_EVENT_HISTORY = 64;
export function emptyFeatures(sampleRate = 48000): AudioFeatures {
  return { time: 0, events: [], rms: 0, instantaneous: 0, peak: 0, crest: 0, bass: 0, mids: 0, treble: 0,
    centroid: 0, centroidHz: 0, flux: 0, rolloffHz: 0, flatness: 0, tonality: 0, textureChange: 0,
    shortEnergy: 0, longEnergy: 0, relative: 0, energy: 0, atmosphere: 0, sustained: 0,
    impulse: 0, salience: 0, eventId: 0, signal: false, stereo: false, balance: 0, width: 0, correlation: 0,
    bands: BAND_NAMES.map((_, i) => ({ lowHz: Math.min(BAND_EDGES[i], sampleRate / 2),
      highHz: Math.min(BAND_EDGES[i+1], sampleRate / 2), energy: 0, normalized: 0,
      fast: 0, slow: 0, history: 0, trend: 0, variation: 0, share: 0, flux: 0,
      salience: 0, sustained: 0, transient: 0, eventId: 0, active: false })) };
}
export const clamp = (x: number, min = 0, max = 1) => Math.min(max, Math.max(min, x));
export const damp = (current: number, target: number, dt: number, tau: number) =>
  current + (target - current) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
export const envelope = (current: number, target: number, dt: number, attack: number, release: number) =>
  damp(current, target, dt, target > current ? attack : release);
const finite = (v: number) => Number.isFinite(v) ? v : 0;

/** Streaming analysis with reused spectral buffers and a bounded event log.
 * Event records allocate only on detected attacks. dt is seconds, FFT input dBFS.
 * Optional L/R time buffers must belong to the same acquisition window. Stereo is
 * an energy/correlation cue, not source separation. See docs/ACOUSTICS.md for units.
 */
export class FeatureExtractor {
  readonly value: AudioFeatures;
  private previous: Float32Array;
  private magnitudes: Float32Array;
  private region: Int8Array;
  private powers = new Float64Array(7);
  private rises = new Float64Array(7);
  private totals = new Float64Array(7);
  private cooldown = new Float64Array(7);
  private lastAmplitude = new Float64Array(7);
  private previousShare = new Float64Array(7);
  private fluxMean = .002;
  private noiseFloor = .00008;

  constructor(readonly bins: number, readonly sampleRate: number) {
    this.value = emptyFeatures(sampleRate);
    this.previous = new Float32Array(bins);
    this.magnitudes = new Float32Array(bins);
    this.region = new Int8Array(bins).fill(-1);
    const binHz = sampleRate / (bins * 2);
    for (let i = 1; i < bins; i++) {
      const hz = i * binHz;
      for (let b = 0; b < 7; b++) {
        if (hz >= BAND_EDGES[b] && hz < Math.min(BAND_EDGES[b+1], sampleRate / 2)) {
          this.region[i] = b;
          break;
        }
      }
    }
  }

  update(wave: Float32Array, spectrum: Float32Array, dt: number, sensitivity = 1, softness = .65,
    left?: Float32Array, right?: Float32Array): AudioFeatures {
    dt = clamp(finite(dt) || 1/60, .001, 5);
    sensitivity = clamp(finite(sensitivity), .3, 3);
    softness = clamp(finite(softness));
    const f = this.value;
    f.time += dt;
    let square = 0, peak = 0, l2 = 0, r2 = 0, cross = 0, side = 0;
    let channelPeak = 0;
    const stereoLength = left && right ? Math.min(left.length, right.length) : 0;
    for (let i = 0; !stereoLength && i < wave.length; i++) {
      const x = finite(wave[i]);
      square += x*x;
      peak = Math.max(peak, Math.abs(x));
    }
    for (let i = 0; i < stereoLength; i++) {
      const l = finite(left![i]), r = finite(right![i]);
      l2 += l*l; r2 += r*r; cross += l*r; side += (l-r)*(l-r);
      channelPeak = Math.max(channelPeak,Math.abs(l),Math.abs(r));
    }
    f.instantaneous = stereoLength ? (l2+r2)/(2*stereoLength) : square/Math.max(1,wave.length);
    // Channel power avoids cancellation of anti-phase stereo in the mono analyser.
    f.rms = Math.sqrt(f.instantaneous);
    f.peak = stereoLength ? channelPeak : peak;
    f.crest = f.rms > 1e-8 ? Math.min(100, f.peak/f.rms) : 0;
    if (!f.signal) this.noiseFloor = damp(this.noiseFloor, Math.min(f.rms, .00015), dt, 12);
    f.signal = f.rms > (f.signal ? Math.max(.00018, this.noiseFloor*2) : Math.max(.0004, this.noiseFloor*3));
    f.stereo = stereoLength > 0;
    f.balance = damp(f.balance, f.signal && stereoLength ? (r2-l2)/Math.max(1e-12,l2+r2) : 0, dt, .16);
    f.width = damp(f.width, f.signal && stereoLength ? clamp(Math.sqrt(side/Math.max(1e-12,2*(l2+r2)))) : 0, dt, .3);
    f.correlation = damp(f.correlation, f.signal && stereoLength ? clamp(cross/Math.max(1e-12,Math.sqrt(l2*r2)),-1,1) : 0, dt, .3);
    this.powers.fill(0); this.rises.fill(0); this.totals.fill(0);
    let sum = 0, powerSum = 0, weighted = 0, flux = 0, logSum = 0, count = 0;
    const binHz = this.sampleRate / (this.bins*2);
    for (let i = 1; i < this.bins; i++) {
      const db = spectrum[i];
      const magnitude = Number.isFinite(db) ? Math.pow(10, clamp(db, -160, 0)*.05) : 0;
      this.magnitudes[i] = magnitude;
      const b = this.region[i];
      const power = magnitude*magnitude;
      const rise = Math.max(0,magnitude-this.previous[i]);
      this.previous[i] = magnitude;
      if (b < 0) continue;
      this.powers[b] += power; this.rises[b] += rise; this.totals[b] += magnitude;
      powerSum += power; sum += magnitude; weighted += i*binHz*magnitude; flux += rise;
      logSum += Math.log(Math.max(1e-12,power)); count++;
    }
    f.shortEnergy = damp(f.shortEnergy,f.rms,dt,.35);
    f.longEnergy = damp(f.longEnergy,f.rms,dt,9);
    f.relative = damp(f.relative,f.signal ? clamp(f.shortEnergy/Math.max(.001,f.longEnergy)*.38) : 0,dt,.7);
    const context = Math.max(.002, f.longEnergy);
    const adaptive = f.rms/(context*.8+f.rms);
    const confidence = clamp((f.rms-.00018)/.0018);
    const target = f.signal ? clamp((adaptive*.65+Math.sqrt(f.rms)*.35)*Math.sqrt(sensitivity))*confidence : 0;
    f.energy = envelope(f.energy,target,dt,.045+softness*.07,.45+softness*.6);
    f.atmosphere = damp(f.atmosphere,f.energy,dt,2.5+softness*3);
    f.sustained = envelope(f.sustained,f.energy,dt,.8,2.2);
    let strongest = 0, shapeChange = 0, maxEvent = 0;
    for (let i = 0; i < 7; i++) {
      const b = f.bands[i];
      b.energy = this.powers[i];
      const amplitude = Math.sqrt(b.energy);
      const confidenceBand = clamp((amplitude-.00002)/.0008)*confidence;
      const normalized = f.signal ? amplitude/(amplitude+Math.max(.001,b.history*.8))*Math.sqrt(sensitivity)*confidenceBand : 0;
      b.normalized = clamp(normalized);
      const change = (amplitude-this.lastAmplitude[i])/Math.max(.001,b.history,amplitude);
      const bandFlux = this.totals[i] > .00005 ? clamp(this.rises[i]/this.totals[i]) : 0;
      b.flux = f.signal ? bandFlux : 0;
      b.fast = envelope(b.fast,b.normalized,dt,.025+softness*.035,.22+softness*.28);
      b.slow = envelope(b.slow,b.normalized,dt,.8,1.8+softness);
      b.trend = damp(b.trend,clamp((b.fast-b.slow)*2,-1,1),dt,.18);
      b.variation = envelope(b.variation,Math.abs(change)*confidenceBand,dt,.025,.45);
      const share = powerSum > 1e-12 && f.signal ? b.energy/powerSum : 0;
      shapeChange += Math.abs(share-this.previousShare[i]);
      this.previousShare[i] = share;
      b.share = damp(b.share,share,dt,.18);
      const novelty = clamp(Math.log2((amplitude+.0001)/(b.history+.0001))*.24);
      // Several bands may remain salient together. No winner-take-all selection.
      const salient = f.signal ? clamp(novelty*.7+Math.max(0,b.trend)*.45+bandFlux*.18)*confidenceBand : 0;
      b.salience = envelope(b.salience,salient,dt,.04,.95+softness*.8);
      b.sustained = envelope(b.sustained,b.slow*(.4+.6*b.salience),dt,.55,2.4);
      b.active = b.salience > (b.active ? .13 : .24);
      this.cooldown[i] = Math.max(0,this.cooldown[i]-dt);
      b.transient = damp(b.transient,0,dt,.24+softness*.15);
      if (f.signal && confidenceBand > .08 && this.cooldown[i] === 0 &&
        ((bandFlux > Math.max(.16,this.fluxMean*1.8) && change > .06) || change > .5)) {
        b.transient = clamp(Math.max(bandFlux,change)*Math.sqrt(sensitivity)*confidenceBand);
        b.eventId++; f.eventId++;
        f.events.push({id: f.eventId, time: f.time, band: i,
          strength: clamp(Math.max(bandFlux,change)*confidenceBand), rms: f.rms,
          spectralShare: powerSum>1e-12 ? b.energy/powerSum : 0});
        if (f.events.length > ACOUSTIC_EVENT_HISTORY) f.events.shift();
        maxEvent = Math.max(maxEvent,b.transient);
        this.cooldown[i] = .14;
      }
      strongest = Math.max(strongest,b.salience);
      b.history = damp(b.history,amplitude,dt,8);
      this.lastAmplitude[i] = amplitude;
    }
    f.salience = strongest;
    f.textureChange = envelope(f.textureChange,f.signal ? clamp(shapeChange*.5) : 0,dt,.035,.7);
    const normalizedFlux = f.signal && sum > .00005 ? clamp(flux/sum) : 0;
    f.flux = envelope(f.flux,normalizedFlux,dt,.012,.12);
    this.fluxMean = damp(this.fluxMean,normalizedFlux,dt,1.5);
    f.impulse = Math.max(damp(f.impulse,0,dt,.3+softness*.18),maxEvent);
    const center = sum > .00001 && f.signal ? weighted/sum : 0;
    f.centroidHz = damp(f.centroidHz,center,dt,.25);
    f.centroid = clamp(f.centroidHz/10000);
    let cumulative = 0, rolloff = 0;
    if (f.signal && powerSum > 1e-12) {
      for (let i=1;i<this.bins;i++) {
        if (this.region[i] < 0) continue;
        cumulative += this.magnitudes[i]*this.magnitudes[i];
        if (cumulative >= powerSum*.85) { rolloff = i*binHz; break; }
      }
    }
    f.rolloffHz = damp(f.rolloffHz,rolloff,dt,.3);
    const flatness = f.signal && count && powerSum > 1e-10 ? clamp(Math.exp(logSum/count)/(powerSum/count)) : 0;
    f.flatness = damp(f.flatness,flatness,dt,.35);
    f.tonality = damp(f.tonality,f.signal ? 1-flatness : 0,dt,.4);
    f.bass = Math.max(f.bands[0].fast,f.bands[1].fast);
    f.mids = Math.max(f.bands[2].fast,f.bands[3].fast,f.bands[4].fast);
    f.treble = Math.max(f.bands[5].fast,f.bands[6].fast);
    return f;
  }
}
