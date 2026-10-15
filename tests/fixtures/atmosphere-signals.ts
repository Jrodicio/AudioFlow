/** Causal 48 kHz PCM fixtures. FFT uses the capture's 4096-sample trailing
 * Blackman window, with no spectral smoothing. No fabricated FFT/onset values. */
export type TemporalCase = 'A-hits'|'B-bass-hits'|'C-bands'|'D-voice'|'D-salient'|'E-gates'|'F-normal'|'F-max'|'G-silence';
export const signalRate=48000, signalSize=4096, signalSeconds=6;
export const eventTimes=(name:TemporalCase) => name==='G-silence' ? [] : name==='E-gates' ? [.6,2.2,3.8] : [.75,2,3.25,4.5];
const burst=(t:number,start:number,duration=.12) => {
  const age=t-start;
  return age<0 || age>=duration ? 0 : Math.min(1,age/.003)*Math.exp(-age/.045)*(1-age/duration);
};
export function makeSignal(name:TemporalCase) {
  const pcm=new Float32Array(signalRate*signalSeconds),events=eventTimes(name);
  let seed=0x789abc;
  for(let i=0;i<pcm.length;i++) {
    const t=i/signalRate;
    const tone=(hz:number)=>Math.sin(t*2*Math.PI*hz);
    let value=name==='B-bass-hits' ? .065*tone(117.1875)*Math.min(1,t/.08) : name==='D-salient' ? .25*tone(117.1875)*Math.min(1,t/.08) : 0;
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    for(let e=0;e<events.length;e++) {
      if(name==='D-voice') {
        const age=t-events[e],envelope=age>=0 && age<.42 ? Math.sin(Math.PI*age/.42)**2 : 0;
        value+=envelope*(.13*tone(175.78125)+.08*tone(351.5625)+.06*tone(703.125)+.04*tone(1406.25));
        value+=burst(t,events[e]+.03,.045)*.045*(seed/0x80000000-1);
      } else if(name==='E-gates') {
        const age=t-events[e];
        const envelope=age>=0 && age<.65 ? Math.min(1,age/.008,(.65-age)/.035) : 0;
        value+=envelope*(.16*tone(1007.8125)+.035*tone(8003.90625));
      } else {
        const hz=name==='C-bands' ? [117.1875,1007.8125,8003.90625,1007.8125][e] :
          name==='B-bass-hits' ? 117.1875 : 1007.8125;
        value+=burst(t,events[e])*(name==='D-salient' ? .055 : .48)*tone(hz);
      }
    }
    pcm[i]=value;
  }
  return pcm;
}
export class SignalWindow {
  readonly wave=new Float32Array(signalSize);
  readonly spectrum=new Float32Array(signalSize/2);
  private real=new Float64Array(signalSize);
  private imaginary=new Float64Array(signalSize);
  private blackman=Float64Array.from({length:signalSize},(_,i)=>.42-.5*Math.cos(2*Math.PI*i/signalSize)+.08*Math.cos(4*Math.PI*i/signalSize));
  constructor(readonly pcm:Float32Array) {}
  at(seconds:number) {
    const end=Math.round(seconds*signalRate);
    for(let i=0;i<signalSize;i++) {
      const sample=this.pcm[end-signalSize+i] ?? 0;
      this.wave[i]=sample;this.real[i]=sample*this.blackman[i];this.imaginary[i]=0;
    }
    // In-place radix-2 FFT, bit-reversed before butterflies.
    for(let i=1,j=0;i<signalSize;i++) {
      let bit=signalSize>>1;
      for(;j&bit;bit>>=1)j^=bit;
      j^=bit;
      if(i<j)[this.real[i],this.real[j]]=[this.real[j],this.real[i]];
    }
    for(let length=2;length<=signalSize;length*=2) {
      const angle=-2*Math.PI/length,cr=Math.cos(angle),ci=Math.sin(angle);
      for(let start=0;start<signalSize;start+=length) {
        let wr=1,wi=0;
        for(let j=0;j<length/2;j++) {
          const a=start+j,b=a+length/2;
          const tr=wr*this.real[b]-wi*this.imaginary[b],ti=wr*this.imaginary[b]+wi*this.real[b];
          this.real[b]=this.real[a]-tr;this.imaginary[b]=this.imaginary[a]-ti;
          this.real[a]+=tr;this.imaginary[a]+=ti;
          const next=wr*cr-wi*ci;wi=wr*ci+wi*cr;wr=next;
        }
      }
    }
    for(let i=0;i<this.spectrum.length;i++)this.spectrum[i]=20*Math.log10(Math.hypot(this.real[i],this.imaginary[i])/signalSize);
    return this;
  }
}
