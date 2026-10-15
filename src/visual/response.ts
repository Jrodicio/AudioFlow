import { clamp, damp, emptyFeatures, type AudioFeatures } from '../audio/features';

export const EVENT_CAPACITY = 12;
/** Persistent visual state. No random motion or renderer dependencies. */
export class MaterialResponse {
  readonly bands = new Float32Array(7);
  readonly sustained = new Float32Array(7);
  readonly salience = new Float32Array(7);
  readonly tension = new Float32Array(7);
  readonly events = new Float32Array(EVENT_CAPACITY*4); // UV x/y, age seconds, strength
  readonly eventBands = new Float32Array(EVENT_CAPACITY);
  private velocity = new Float32Array(7);
  private seen = new Float64Array(7);
  private cursor = 0;
  private demo = emptyFeatures();
  private demoTime = 0;
  private lastDemo = false;
  structure = 0;
  balance = 0;
  width = 0;
  brightness = 0;
  noise = 0;
  constructor() {
    for (let i=0;i<EVENT_CAPACITY;i++) this.events[i*4+2] = 100;
  }
  update(real: AudioFeatures, dt: number, demo: boolean, softness: number) {
    dt = clamp(dt,.001,.1);
    this.demoTime += dt;
    const f = demo ? this.demo : real;
    if (demo !== this.lastDemo) {
      // Different acquisition sessions have independent event counters.
      for (let i=0;i<7;i++) this.seen[i] = f.bands[i].eventId;
      this.lastDemo = demo;
    }
    if (demo) {
      f.sustained = .3+.12*Math.sin(this.demoTime*.13);
      f.centroid = .4+.12*Math.sin(this.demoTime*.19);
      f.flatness = .25;
      for (let i=0;i<7;i++) {
        const b = f.bands[i];
        const pulse = Math.pow(.5+.5*Math.sin(this.demoTime*(.9+i*.11)+i*1.8),18);
        b.fast = .14+.12*Math.sin(this.demoTime*.31+i)+pulse*.3;
        b.sustained = .18+.1*Math.sin(this.demoTime*.17+i);
        b.salience = pulse*.65;
        const step = Math.floor((this.demoTime*(.9+i*.11)+i*1.8)/(Math.PI*2));
        b.eventId = step;
        b.transient = .25+pulse*.3;
      }
      f.energy = f.sustained;
      f.bass = Math.max(f.bands[0].fast,f.bands[1].fast);
      f.mids = Math.max(f.bands[2].fast,f.bands[3].fast,f.bands[4].fast);
      f.treble = Math.max(f.bands[5].fast,f.bands[6].fast);
    }
    this.structure = damp(this.structure,f.sustained,dt,2.2+softness*2);
    this.balance = damp(this.balance,f.balance,dt,.35);
    this.width = damp(this.width,f.width,dt,.5);
    this.brightness = damp(this.brightness,f.centroid,dt,.5);
    this.noise = damp(this.noise,f.flatness,dt,.7);
    for (let i=0;i<EVENT_CAPACITY;i++) this.events[i*4+2] += dt;
    // Stable semi-implicit spring steps preserve elastic direction across frames.
    const steps = Math.ceil(dt/(1/120)), h = dt/steps;
    for (let i=0;i<7;i++) {
      const b = f.bands[i];
      const target = b.fast*.55+b.sustained*.3+b.salience*.15;
      for (let step=0;step<steps;step++) {
        this.velocity[i] += ((target-this.bands[i])*9-this.velocity[i]*(4+softness*2))*h;
        this.bands[i] += this.velocity[i]*h;
      }
      this.sustained[i] = damp(this.sustained[i],b.sustained,dt,.8);
      this.salience[i] = damp(this.salience[i],b.salience,dt,b.salience>this.salience[i] ? .045 : 1.2);
      this.tension[i] = damp(this.tension[i],b.sustained*.45+b.salience*.55,dt,1.4);
      if (b.eventId < this.seen[i]) this.seen[i] = b.eventId; // reconnect/reset
      if (b.eventId > this.seen[i]) {
        this.seen[i] = b.eventId;
        const k = this.cursor*4;
        // Deterministic low-discrepancy positions; stereo biases these observations.
        this.events[k] = clamp(.16+((i*.618+b.eventId*.137)%1)*.68+f.balance*.13,.08,.92);
        this.events[k+1] = .16+((i*.381+b.eventId*.213)%1)*.68;
        this.events[k+2] = 0;
        this.events[k+3] = clamp(Math.max(b.transient,b.salience*.4));
        this.eventBands[this.cursor] = i;
        this.cursor = (this.cursor+1)%EVENT_CAPACITY;
      }
    }
    return f;
  }
}
