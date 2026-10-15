import { damp, type AudioFeatures } from '../audio/features';

/** Atmosphere consumes the existing fast observations, without Liquid's elastic
 * spring and second sustained envelope. No analysis or capture is duplicated. */
export class AtmosphereAcoustics {
  readonly bands = new Float32Array(7);
  readonly sustained = new Float32Array(7);
  readonly salience = new Float32Array(7);
  readonly gain = { value: .38 };

  update(features: AudioFeatures, dt: number, demo = false) {
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
