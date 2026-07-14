// Procedural WebAudio SFX + a minimal synthwave bed. No samples, no network.
// Everything is synthesized so the whole game stays a single static bundle.

export class SynthAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this._musicTimer = null;
  }

  // Must be called from a user gesture (mobile autoplay policy).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      // gentle synthwave echo bus
      this.delay = this.ctx.createDelay(0.6);
      this.delay.delayTime.value = 0.28;
      const fb = this.ctx.createGain(); fb.gain.value = 0.32;
      const wet = this.ctx.createGain(); wet.gain.value = 0.25;
      this.delay.connect(fb); fb.connect(this.delay);
      this.delay.connect(wet); wet.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  _env(gainNode, t0, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  _noise(duration) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, rate * duration, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  throw() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this._noise(0.18);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.15);
    const g = this.ctx.createGain();
    this._env(g, t, 0.25, 0.01, 0.15);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.2);
  }

  shatter(intensity = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    // noise burst body
    const src = this._noise(0.4);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1800;
    const g = this.ctx.createGain();
    this._env(g, t, 0.5 * intensity, 0.005, 0.3);
    src.connect(hp); hp.connect(g); g.connect(this.master); g.connect(this.delay);
    src.start(t); src.stop(t + 0.45);
    // glassy ringing partials
    for (let i = 0; i < 5; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2200 + Math.random() * 4800;
      const og = this.ctx.createGain();
      const dt = Math.random() * 0.05;
      this._env(og, t + dt, 0.08 * intensity, 0.004, 0.25 + Math.random() * 0.3);
      o.connect(og); og.connect(this.master);
      o.start(t + dt); o.stop(t + dt + 0.7);
    }
  }

  crystal() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [880, 1320, 1760].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, t + i * 0.05, 0.22, 0.01, 0.5);
      o.connect(g); g.connect(this.master); g.connect(this.delay);
      o.start(t + i * 0.05); o.stop(t + i * 0.05 + 0.7);
    });
  }

  multiballUp() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046, 1318].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, t + i * 0.07, 0.12, 0.01, 0.3);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 3200;
      o.connect(lp); lp.connect(g); g.connect(this.master); g.connect(this.delay);
      o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.5);
    });
  }

  crash() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
    const g = this.ctx.createGain();
    this._env(g, t, 0.7, 0.005, 0.4);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.5);
    this.shatter(1.4);
  }

  gameOver() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [392, 311, 233, 196].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1400;
      const g = this.ctx.createGain();
      this._env(g, t + i * 0.22, 0.18, 0.02, 0.5);
      o.connect(lp); lp.connect(g); g.connect(this.master); g.connect(this.delay);
      o.start(t + i * 0.22); o.stop(t + i * 0.22 + 0.8);
    });
  }

  // Minimal pulsing synthwave bass bed — one bar, looped by timer.
  startMusic() {
    if (!this.ctx || this._musicTimer || !this.musicOn) return;
    const bpm = 104;
    const beat = 60 / bpm;
    const bar = beat * 4;
    const roots = [55, 55, 43.65, 49]; // A A F G
    let barIndex = 0;
    let nextBarTime = this.ctx.currentTime + 0.1;

    const scheduleBar = () => {
      const t0 = nextBarTime;
      const root = roots[barIndex % roots.length];
      for (let i = 0; i < 8; i++) {
        const t = t0 + i * (beat / 2);
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = i % 4 === 3 ? root * 2 : root;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, t);
        lp.frequency.exponentialRampToValueAtTime(220, t + beat / 2);
        const g = this.ctx.createGain();
        this._env(g, t, 0.11, 0.01, beat * 0.45);
        o.connect(lp); lp.connect(g); g.connect(this.master);
        o.start(t); o.stop(t + beat * 0.6);
      }
      barIndex++;
      nextBarTime += bar;
    };

    scheduleBar(); scheduleBar();
    this._musicTimer = setInterval(() => {
      while (nextBarTime < this.ctx.currentTime + bar * 1.5) scheduleBar();
    }, 250);
  }

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }
}
