import { emptyFeatures, FeatureExtractor, type AudioFeatures } from './features';

export type CaptureStatus = 'idle' | 'requesting' | 'listening' | 'silent' | 'suspended' | 'error';
export interface CaptureSnapshot { status: CaptureStatus; message: string; rms: number; }

export function captureError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Windows o Electron denegó la captura. Volvé a intentarlo desde «Escuchar PC».';
  if (name === 'NotFoundError') return 'No se encontró una salida de audio o pantalla disponible.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Windows no pudo abrir el loopback. Revisá tu salida de sonido y las aplicaciones en modo exclusivo.';
  if (name === 'InvalidStateError') return 'Activá la captura con la ventana en primer plano.';
  return error instanceof Error ? error.message : 'No se pudo iniciar la captura del audio de Windows.';
}

export class SystemAudio {
  snapshot: CaptureSnapshot = { status: 'idle', message: 'La escucha está desactivada.', rms: 0 };
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private wave: Float32Array<ArrayBuffer> | null = null;
  private fft: Float32Array<ArrayBuffer> | null = null;
  private extractor: FeatureExtractor | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private channels: AnalyserNode[] = [];
  private channelWaves: Float32Array<ArrayBuffer>[] = [];
  private channelFFTs: Float32Array<ArrayBuffer>[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAnalysis = 0;
  private sensitivity = 1;
  private softness = .65;
  private empty = emptyFeatures();
  private generation = 0;
  private silence = 0;
  private signalSeen = false;
  private alive = true;

  constructor(private notify: (snapshot: CaptureSnapshot) => void) {}

  private publish(status: CaptureStatus, message: string) {
    this.snapshot = { status, message, rms: this.extractor?.value.rms ?? 0 };
    if (this.alive) this.notify(this.snapshot);
  }

  async start() {
    this.stop();
    const token = this.generation;
    if (!window.audioflow || window.audioflow.platform !== 'win32') {
      this.publish('error', 'La escucha del sistema requiere la aplicación de Windows. En el navegador podés usar la demo visual.');
      return;
    }
    this.publish('requesting', 'Solicitando el audio de salida de Windows…');
    let pendingStream: MediaStream | null = null;
    let pendingContext: AudioContext | null = null;
    try {
      // Resume while this is still the direct consequence of a user gesture.
      pendingContext = new AudioContext({ latencyHint: 'interactive' });
      await pendingContext.resume();
      if (token !== this.generation) return;
      await window.audioflow.armCapture();
      if (token !== this.generation) return;
      pendingStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 1, max: 1 }, width: { ideal: 64 }, height: { ideal: 64 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (token !== this.generation) return;
      const tracks = pendingStream.getAudioTracks();
      if (!tracks.length || tracks[0].readyState !== 'live') {
        throw new Error('La captura no entregó audio del sistema. Revisá la salida de Windows; no se está escuchando audio real.');
      }
      // Video is a Chromium requirement only. No video element, frame access,
      // thumbnails, recorder, storage or screen processing is used.
      for (const track of pendingStream.getVideoTracks()) track.stop();
      if (tracks[0].readyState !== 'live') throw new Error('Windows finalizó el audio al cerrar la pista de video. La captura no está activa.');
      const analyser = pendingContext.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      analyser.minDecibels = -100;
      analyser.maxDecibels = 0;
      const audioOnly = new MediaStream(tracks);
      const source = pendingContext.createMediaStreamSource(audioOnly);
      source.connect(analyser); // Deliberately never connected to context.destination.
      this.stream = pendingStream;
      this.context = pendingContext;
      this.source = source;
      this.analyser = analyser;
      this.wave = new Float32Array(analyser.fftSize);
      this.fft = new Float32Array(analyser.frequencyBinCount);
      this.extractor = new FeatureExtractor(analyser.frequencyBinCount, pendingContext.sampleRate);
      // Do not invent a second channel when the capture only reports mono.
      if ((tracks[0].getSettings?.().channelCount ?? 1) >= 2) {
        this.splitter = pendingContext.createChannelSplitter(2);
        source.connect(this.splitter);
        for (let i=0;i<2;i++) {
          const channel = pendingContext.createAnalyser();
          channel.fftSize = analyser.fftSize;
          channel.smoothingTimeConstant = 0;
          channel.minDecibels = -100;
          channel.maxDecibels = 0;
          this.splitter.connect(channel,i);
          this.channels.push(channel);
          this.channelWaves.push(new Float32Array(channel.fftSize));
          this.channelFFTs.push(new Float32Array(channel.frequencyBinCount));
        }
      }
      pendingStream = null;
      pendingContext = null;
      this.silence = 0;
      this.lastAnalysis = performance.now();
      // Acquisition is independent of render cadence/quality and continues while
      // the visual is hidden. Chromium may throttle timers in background windows.
      this.timer = setInterval(this.analyse, 1000/60);
      for (const track of tracks) {
        track.addEventListener('ended', () => {
          if (token !== this.generation) return;
          this.stop();
          this.publish('error', 'La captura se desconectó. Revisá la salida de Windows y volvé a activar la escucha.');
        }, { once: true });
      }
      this.context.onstatechange = () => {
        if (token !== this.generation || !this.context) return;
        if (this.context.state === 'suspended' || (this.context.state as string) === 'interrupted') {
          this.publish('suspended', 'El analizador fue suspendido. Pulsá «Reanudar audio».');
        } else if (this.context.state === 'running') {
          this.publish('listening', 'Loopback conectado. Esperando señal de la salida de Windows.');
        } else if (this.context.state === 'closed') {
          this.stop();
          this.publish('error', 'Windows cerró el motor de audio. Volvé a activar la escucha.');
        }
      };
      this.publish('listening', 'Loopback conectado. Esperando señal de la salida de Windows.');
    } catch (error) {
      if (token === this.generation) {
        this.stop();
        this.publish('error', captureError(error));
      }
    } finally {
      pendingStream?.getTracks().forEach(track => track.stop());
      if (pendingContext && pendingContext.state !== 'closed') void pendingContext.close().catch(() => {});
      if (token === this.generation) void window.audioflow.disarmCapture().catch(() => {});
    }
  }

  async resume() {
    try { await this.context?.resume(); }
    catch (error) { this.stop(); this.publish('error', captureError(error)); }
  }

  sample(_dt: number, sensitivity: number, softness: number): AudioFeatures {
    this.sensitivity = sensitivity;
    this.softness = softness;
    return this.context?.state === 'running' ? this.extractor?.value ?? this.empty : this.empty;
  }

  private analyse = () => {
    if (!this.analyser || !this.wave || !this.fft || !this.extractor) return this.empty;
    if (this.context?.state !== 'running') return this.empty;
    const now = performance.now();
    const dt = Math.min(5, Math.max(.001,(now-this.lastAnalysis)/1000));
    this.lastAnalysis = now;
    if (!this.channels.length) {
      this.analyser.getFloatTimeDomainData(this.wave);
      this.analyser.getFloatFrequencyData(this.fft);
    }
    for (let i=0;i<this.channels.length;i++) {
      this.channels[i].getFloatTimeDomainData(this.channelWaves[i]);
      this.channels[i].getFloatFrequencyData(this.channelFFTs[i]);
    }
    if (this.channels.length === 2) {
      // Average channel POWER, avoiding destructive downmix cancellation.
      for (let i=0;i<this.fft.length;i++) {
        const power = (Math.pow(10,this.channelFFTs[0][i]*.1)+Math.pow(10,this.channelFFTs[1][i]*.1))*.5;
        this.fft[i] = power > 0 ? 10*Math.log10(power) : -Infinity;
      }
    }
    const value = this.extractor.update(this.wave, this.fft, dt, this.sensitivity, this.softness,
      this.channelWaves[0],this.channelWaves[1]);
    this.snapshot.rms = value.rms;
    this.silence = value.signal ? 0 : this.silence + dt;
    if (this.silence > 1.8 && this.snapshot.status !== 'silent') {
      this.publish('silent', 'Loopback conectado, sin señal. Reproducí sonido y comprobá la salida de Windows.');
    } else if (value.signal && (this.snapshot.status !== 'listening' || !this.signalSeen)) {
      this.publish('listening', 'Recibiendo audio real de la salida de Windows.');
    }
    this.signalSeen = value.signal;
    return value;
  };

  stop() {
    this.generation++;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.splitter?.disconnect();
    this.channels.forEach(channel => channel.disconnect());
    this.splitter = null;
    this.channels = [];
    this.channelWaves = [];
    this.channelFFTs = [];
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.context) {
      this.context.onstatechange = null;
      if (this.context.state !== 'closed') void this.context.close().catch(() => {});
    }
    this.stream = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.extractor = null;
    this.wave = null;
    this.fft = null;
    this.empty = emptyFeatures();
    this.silence = 0;
    this.signalSeen = false;
    if (window.audioflow) void window.audioflow.disarmCapture().catch(() => {});
    this.publish('idle', 'La escucha está desactivada.');
  }

  dispose() { this.alive = false; this.stop(); }
}
