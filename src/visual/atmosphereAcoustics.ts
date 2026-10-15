import { clamp, damp, type AudioFeatures, type AcousticEvent } from '../audio/features';

export const ATMOSPHERE_IMPULSES = 12;

/** Atmosphere consumes the existing fast observations, without Liquid's elastic
 * spring and second sustained envelope. No analysis or capture is duplicated. */
export class AtmosphereAcoustics {
  readonly bands = new Float32Array(7);
  readonly sustained = new Float32Array(7);
  readonly salience = new Float32Array(7);
  readonly gain = { value: .38 };
  /** XYZ source + acoustic strength. Pending until a GPU step consumes
   * them; never an envelope, and never cleared by a faster render update. */
  readonly impulses = new Float32Array(ATMOSPHERE_IMPULSES*4);
  readonly impulseBands = new Float32Array(ATMOSPHERE_IMPULSES);
  pending = 0;
  detected = 0;
  applied = 0;
  dropped = 0;
  lastEventAge = Infinity;
  rapid = 0;
  private source: AcousticEvent[] | null = null;
  private seen = 0;
  private deferred: AcousticEvent[] = [];
  private demoSeen = new Float64Array(7);
  private lastDemo = false;
  private clock = 0;
  private recent: {time:number; band:number; strength:number}[] = [];

  get active() { return this.recent.length; }
  get activeBands() { return [...new Set(this.recent.filter(e=>this.clock-e.time<.18).map(e=>e.band))]; }
  get sustainedLevel() { return Math.max(...this.sustained); }

  private enqueue(band: number, id: number, strength: number, rms: number, balance: number, sensitivity: number) {
    // Sensitivity controls admission; intensity is applied only in the physics.
    if(strength < .24/clamp(sensitivity,.3,3)) return false;
    if(this.pending===ATMOSPHERE_IMPULSES) { this.dropped++; return true; }
    const k=this.pending*4;
    this.impulses[k]=clamp(.22+((band*.618+id*.137)%1)*.56+balance*.10,.12,.88);
    this.impulses[k+1]=.22+((band*.381+id*.213)%1)*.56;
    // Camera looks from +Z: broad bass births occupy a deeper interval;
    // finer sources start nearer the front and follow the local velocity.
    this.impulses[k+2]=(band<2 ? .67 : band<5 ? .77 : .80)+((band*.173+id*.097)%1)*(band<2 ? .08 : .05);
    // Snapshot absolute dynamics: no RMS attack filter in the event path.
    this.impulses[k+3]=strength*(.55+.45*Math.sqrt(clamp(rms/.1)));
    this.impulseBands[this.pending++]=band;
    this.detected++; this.lastEventAge=0;
    return true;
  }

  consumeImpulses() {
    for(let i=0;i<this.pending;i++) this.recent.push({time:this.clock,band:this.impulseBands[i],strength:this.impulses[i*4+3]});
    this.applied+=this.pending;
    this.discardImpulses();
  }

  discardImpulses() {
    this.pending=0; this.impulses.fill(0);
    this.rapid=this.recent.reduce((max,e)=>Math.max(max,e.strength*Math.exp(-(this.clock-e.time)/.12)),0);
  }

  update(features: AudioFeatures, dt: number, demo = false, sensitivity = 1.2) {
    this.clock+=dt; this.lastEventAge+=dt;
    this.recent=this.recent.filter(e=>this.clock-e.time<3);
    if(this.source!==features.events || demo!==this.lastDemo) {
      this.source=features.events; this.seen=0;
      this.deferred=[];
      // Reconnect/demo changes cannot replay an old acquisition session.
      this.pending=0; this.impulses.fill(0); this.demoSeen.fill(0);
      this.lastDemo=demo;
    }
    if(demo) {
      for(let i=0;i<7;i++) {
        const b=features.bands[i];
        if(b.eventId>this.demoSeen[i]) this.enqueue(i,b.eventId,b.transient,.05,features.balance,sensitivity);
        this.demoSeen[i]=b.eventId;
      }
    } else {
      for(const e of features.events) {
        if(e.id<=this.seen) continue;
        this.seen=e.id;
        if(features.time-e.time<=.065) this.deferred.push(e);
      }
      const totalPower=features.bands.reduce((sum,b)=>sum+b.energy,0);
      this.deferred=this.deferred.filter(e=>{
        if(features.time-e.time>.065) return false;
        // A quiet onset can cross the detector's confidence floor before its
        // FFT window fills. Revisit that same candidate briefly, not a new onset,
        // so admission doesn't lose it for the entire legacy refractory period.
        const b=features.bands[e.band];
        const bandConfidence=clamp((Math.sqrt(b.energy)-.00002)/.0008);
        const strength=Math.max(e.strength,b.flux*bandConfidence);
        // A causal short window leaks a tiny fraction into neighboring regions.
        // Keep simultaneous bands; attenuate their contribution continuously,
        // rather than treating a 0.006% sidelobe like the primary attack.
        const confidence=clamp((strength-.55)/.35);
        const share=totalPower>0 ? b.energy/totalPower : (e.spectralShare ?? 1);
        const support=Math.max(Math.sqrt(clamp(share*16)),.38*confidence*confidence*(3-2*confidence));
        return !this.enqueue(e.band,e.id,strength*support,e.rms,features.balance,sensitivity);
      });
    }
    this.rapid=this.recent.reduce((max,e)=>Math.max(max,e.strength*Math.exp(-(this.clock-e.time)/.12)),0);
    for(let i=0;i<this.pending;i++) this.rapid=Math.max(this.rapid,this.impulses[i*4+3]);
    for(let i=0;i<7;i++) {
      const b=features.bands[i];
      this.bands[i]=damp(this.bands[i],b.fast,dt,b.fast>this.bands[i] ? .025 : .24);
      this.sustained[i]=b.sustained;
      this.salience[i]=b.salience;
    }
    // Adaptive spectral excitation preserves quiet content. Retain some absolute
    // dynamics too: a quiet normalized tone must not equal a loud impact.
    const target=demo ? .75 : .38+.62*Math.sqrt(Math.min(1,features.rms/.10));
    this.gain.value=damp(this.gain.value,target,dt,target>this.gain.value ? .025 : .32);
  }
}
