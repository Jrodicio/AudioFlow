import type { AtmosphereAcoustics } from './atmosphereAcoustics';

export const PLUME_CAPACITY = 16;
export const plumeDuration = (band: number) => band<2 ? .32 : band<5 ? .24 : .17;
/** Integrated compact emission envelope. Its derivative is zero at both ends:
 * fast attack, bloom, release, with a finite budget independent of frame rate. */
export function plumeIntegral(age: number, duration: number) {
  const s=Math.max(0,Math.min(1,age/duration));
  return s*s*(6-8*s+3*s*s);
}

/** Short-lived 3D emitters. Released matter lives in the advected GPU fields;
 * slots describe only its birth, never a particle/sprite or a persistent stamp. */
export class AtmospherePlumes {
  readonly sources=new Float32Array(PLUME_CAPACITY*4); // XYZ, event strength
  readonly phases=new Float32Array(PLUME_CAPACITY*4); // age, band, step dose, duration
  private ages=new Float64Array(PLUME_CAPACITY).fill(Infinity);
  private bands=new Uint8Array(PLUME_CAPACITY);
  born=0;
  replaced=0;

  get active() { return this.ages.reduce((n,age,i)=>n+(age<plumeDuration(this.bands[i]) ? 1 : 0),0); }

  begin(events: AtmosphereAcoustics) {
    for(let event=0;event<events.pending;event++) {
      let slot=this.ages.findIndex((age,i)=>age>=plumeDuration(this.bands[i]));
      if(slot<0) {
        slot=this.ages.reduce((best,age,i)=>age/plumeDuration(this.bands[i])>this.ages[best]/plumeDuration(this.bands[best]) ? i : best,0);
        this.replaced++;
      }
      this.sources.set(events.impulses.subarray(event*4,event*4+4),slot*4);
      this.bands[slot]=events.impulseBands[event];
      this.ages[slot]=0; this.born++;
    }
  }

  step(dt: number) {
    for(let i=0;i<PLUME_CAPACITY;i++) {
      const k=i*4,duration=plumeDuration(this.bands[i]),age=this.ages[i];
      if(age>=duration) { this.phases[k+2]=0; this.sources[k+3]=0; continue; }
      const next=Math.min(duration,age+dt);
      this.phases[k]=(age+next)*.5;
      this.phases[k+1]=this.bands[i];
      this.phases[k+2]=plumeIntegral(next,duration)-plumeIntegral(age,duration);
      this.phases[k+3]=duration;
      this.ages[i]=next;
    }
  }

  clear() { this.sources.fill(0); this.phases.fill(0); this.ages.fill(Infinity); }

  /** Test-only counterfactual forks must continue already active emitters. */
  copyFrom(other: AtmospherePlumes) {
    this.sources.set(other.sources); this.phases.set(other.phases);
    this.ages.set(other.ages); this.bands.set(other.bands);
    this.born=other.born; this.replaced=other.replaced;
  }
}
