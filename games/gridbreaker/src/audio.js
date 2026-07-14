// Procedural WebAudio for TIMESHARD. No samples, no network.
// The signature trick: the ambient pad runs through a lowpass whose cutoff
// tracks the global time scale — frozen time sounds muffled and distant,
// flowing time blooms open. Call setFlow(0..1) every frame.

export class TimeshardAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this._musicTimer = null;
    this._flow = 0;
  }

  // Must be called from a user gesture (mobile autoplay policy).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      // iOS ≥16.4: without this, the mute switch silences WebAudio entirely —
      // the #1 reason the game seems to "have no sound by default" on iPhone.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older iOS */ }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);

      // long icy echo bus for chimes/shatters
      this.delay = this.ctx.createDelay(0.7);
      this.delay.delayTime.value = 0.34;
      const fb = this.ctx.createGain(); fb.gain.value = 0.35;
      const wet = this.ctx.createGain(); wet.gain.value = 0.28;
      this.delay.connect(fb); fb.connect(this.delay);
      this.delay.connect(wet); wet.connect(this.master);

      // music bus: pad -> flow-controlled lowpass -> master
      this.flowFilter = this.ctx.createBiquadFilter();
      this.flowFilter.type = 'lowpass';
      this.flowFilter.frequency.value = 220;
      this.flowFilter.Q.value = 0.8;
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.5;
      this.flowFilter.connect(this.musicGain);
      this.musicGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  // 0 = frozen, 1 = time fully flowing. Direct .value writes are cheap and
  // glide enough because the game already smooths the time scale.
  setFlow(f) {
    this._flow = f;
    if (this.flowFilter) this.flowFilter.frequency.value = 180 + f * f * 2800;
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

  // Firing a shard: short icy zip — sine gliss down + airy noise.
  fire() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1900, t);
    o.frequency.exponentialRampToValueAtTime(500, t + 0.12);
    const g = this.ctx.createGain();
    this._env(g, t, 0.22, 0.005, 0.13);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.2);

    const n = this._noise(0.12);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = this.ctx.createGain();
    this._env(ng, t, 0.12, 0.004, 0.1);
    n.connect(hp); hp.connect(ng); ng.connect(this.master);
    n.start(t); n.stop(t + 0.14);
  }

  // Crystal drone bursting: noise crack + glassy ringing partials.
  shatter(intensity = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this._noise(0.35);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2000;
    const g = this.ctx.createGain();
    this._env(g, t, 0.45 * intensity, 0.005, 0.28);
    src.connect(hp); hp.connect(g); g.connect(this.master); g.connect(this.delay);
    src.start(t); src.stop(t + 0.4);
    for (let i = 0; i < 6; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2600 + Math.random() * 5200;
      const og = this.ctx.createGain();
      const dt = Math.random() * 0.05;
      this._env(og, t + dt, 0.07 * intensity, 0.004, 0.3 + Math.random() * 0.35);
      o.connect(og); og.connect(this.delay); og.connect(this.master);
      o.start(t + dt); o.stop(t + dt + 0.8);
    }
  }

  // A door grinding open: low hiss + servo thunk.
  door() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const n = this._noise(0.35);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.3);
    const g = this.ctx.createGain();
    this._env(g, t, 0.16, 0.02, 0.3);
    n.connect(bp); bp.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 0.38);

    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t + 0.28);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.4);
    const og = this.ctx.createGain();
    this._env(og, t + 0.28, 0.2, 0.005, 0.14);
    o.connect(og); og.connect(this.master);
    o.start(t + 0.28); o.stop(t + 0.46);
  }

  // Absorbing a soul: warm rising shimmer.
  pickup() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [523, 784, 1046].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 0.94, t + i * 0.04);
      o.frequency.exponentialRampToValueAtTime(f, t + i * 0.04 + 0.12);
      const g = this.ctx.createGain();
      this._env(g, t + i * 0.04, 0.18, 0.01, 0.45);
      o.connect(g); g.connect(this.master); g.connect(this.delay);
      o.start(t + i * 0.04); o.stop(t + i * 0.04 + 0.6);
    });
  }

  // Trigger pulled on an empty tank: dull click.
  dryFire() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 220;
    const g = this.ctx.createGain();
    this._env(g, t, 0.08, 0.002, 0.05);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.08);
  }

  // Shooting a bolt out of the air: bright metallic ping.
  deflect() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [2093, 3136].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, t + i * 0.02, 0.14, 0.004, 0.22);
      o.connect(g); g.connect(this.master); g.connect(this.delay);
      o.start(t + i * 0.02); o.stop(t + i * 0.02 + 0.3);
    });
  }

  // Taking a hit: low slam + dark noise.
  hurt() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    const g = this.ctx.createGain();
    this._env(g, t, 0.7, 0.005, 0.35);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.45);

    const n = this._noise(0.3);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    const ng = this.ctx.createGain();
    this._env(ng, t, 0.3, 0.005, 0.25);
    n.connect(lp); lp.connect(ng); ng.connect(this.master);
    n.start(t); n.stop(t + 0.32);
  }

  // A drone charging its shot: a shimmering rise matching the telegraph time.
  charge(duration = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const D = Math.max(0.4, duration);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(1560, t + D * 0.95);
    const trem = this.ctx.createOscillator(); // flutter that quickens
    trem.frequency.setValueAtTime(7, t);
    trem.frequency.linearRampToValueAtTime(18, t + D * 0.95);
    const tg = this.ctx.createGain(); tg.gain.value = 0.03;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + D * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + D);
    trem.connect(tg); tg.connect(g.gain);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + D + 0.05);
    trem.start(t); trem.stop(t + D + 0.05);
  }

  // The release: a laser zap that reads as INCOMING — swells as it drops.
  laser() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1350, t);
    o.frequency.exponentialRampToValueAtTime(240, t + 0.42);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.18); // approaching…
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(lp); lp.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.5);

    const n = this._noise(0.2);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1600;
    const ng = this.ctx.createGain();
    this._env(ng, t, 0.07, 0.01, 0.16);
    n.connect(hp); hp.connect(ng); ng.connect(this.master);
    n.start(t); n.stop(t + 0.22);
  }

  // Passing a gateway: a HUGE crystalline crash — deep thump, layered glass,
  // long bell ring-out — nothing like a drone kill — blending into the whoosh.
  gate() {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;

    // deep body thump
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(85, t0);
    sub.frequency.exponentialRampToValueAtTime(34, t0 + 0.4);
    const sg = this.ctx.createGain();
    this._env(sg, t0, 0.55, 0.005, 0.45);
    sub.connect(sg); sg.connect(this.master);
    sub.start(t0); sub.stop(t0 + 0.5);

    // two-stage glass crash, bigger and darker than a drone crack
    for (const [dt2, peak, hpf] of [[0, 0.5, 900], [0.07, 0.35, 1600]]) {
      const src = this._noise(0.5);
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = hpf;
      const g = this.ctx.createGain();
      this._env(g, t0 + dt2, peak, 0.005, 0.4);
      src.connect(hp); hp.connect(g); g.connect(this.master); g.connect(this.delay);
      src.start(t0 + dt2); src.stop(t0 + dt2 + 0.55);
    }

    // long tuned bell partials ringing out through the echo bus
    [523, 784, 1046, 1568, 2093].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.01);
      const og = this.ctx.createGain();
      this._env(og, t0 + 0.03 + i * 0.02, 0.12, 0.005, 0.9 + i * 0.15);
      o.connect(og); og.connect(this.delay); og.connect(this.master);
      o.start(t0 + 0.03 + i * 0.02); o.stop(t0 + 1.6);
    });

    const t = t0 + 0.12;

    // the speed-up: bandpass noise sweeping upward, swelling then gone
    const n = this._noise(1.0);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(240, t);
    bp.frequency.exponentialRampToValueAtTime(3400, t + 0.85);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    n.connect(bp); bp.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 1.0);

    // a quiet rising tone underneath glues the two halves together
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(660, t + 0.8);
    const og = this.ctx.createGain();
    this._env(og, t, 0.12, 0.3, 0.55);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.95);
  }

  // Moment cleared: ascending crystal chime.
  clear() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [659, 880, 1109, 1319].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, t + i * 0.09, 0.2, 0.01, 0.6);
      o.connect(g); g.connect(this.master); g.connect(this.delay);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.8);
    });
  }

  gameOver() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [440, 349, 262, 220].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1200;
      const g = this.ctx.createGain();
      this._env(g, t + i * 0.24, 0.16, 0.02, 0.55);
      o.connect(lp); lp.connect(g); g.connect(this.master); g.connect(this.delay);
      o.start(t + i * 0.24); o.stop(t + i * 0.24 + 0.9);
    });
  }

  // Ambient pad: slow minor chords through the flow filter, plus a sparse
  // bell that keeps the frozen state from feeling dead.
  startMusic() {
    if (!this.ctx || this._musicTimer || !this.musicOn) return;
    const bar = 3.2; // seconds per chord
    const chords = [
      [110, 130.8, 164.8],   // Am
      [87.3, 110, 130.8],    // F
      [98, 123.5, 146.8],    // G
      [110, 130.8, 164.8],   // Am
    ];
    let barIndex = 0;
    let nextBarTime = this.ctx.currentTime + 0.1;

    const scheduleBar = () => {
      const t0 = nextBarTime;
      const chord = chords[barIndex % chords.length];
      for (const f of chord) {
        for (const det of [-4, 4]) {
          const o = this.ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = det;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.linearRampToValueAtTime(0.05, t0 + bar * 0.35);
          g.gain.linearRampToValueAtTime(0.0001, t0 + bar * 1.05);
          o.connect(g); g.connect(this.flowFilter);
          o.start(t0); o.stop(t0 + bar * 1.1);
        }
      }
      // sparse high bell straight to master (audible even when frozen)
      const bell = this.ctx.createOscillator();
      bell.type = 'sine';
      bell.frequency.value = chord[2] * 8;
      const bg = this.ctx.createGain();
      this._env(bg, t0 + bar * 0.5, 0.035, 0.01, 1.4);
      bell.connect(bg); bg.connect(this.delay); bg.connect(this.master);
      bell.start(t0 + bar * 0.5); bell.stop(t0 + bar * 0.5 + 1.6);

      barIndex++;
      nextBarTime += bar;
    };

    scheduleBar(); scheduleBar();
    this._musicTimer = setInterval(() => {
      while (nextBarTime < this.ctx.currentTime + bar * 1.5) scheduleBar();
    }, 300);
  }

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }
}
