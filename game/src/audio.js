// Sound, synthesized live with WebAudio — no audio files, nothing fetched.
//
// Short oscillator and filtered-noise blips cover the vocabulary of the street:
// gunshots, punches, crashes, horns, pickup chimes, cash-register rings, mission
// jingles and UI clicks, plus a two-tone siren that loops while a cruiser is close
// and Marco is wanted. The AudioContext is created lazily on the first user gesture
// (browsers refuse to start one sooner) and every entry point is guarded, so a
// machine without audio simply plays the game silent.

export function createAudio() {
  let context = null;
  let master = null;
  let sirenNodes = null;
  let muted = false;

  function ensure() {
    if (context !== null) return context;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      context = new AC();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(context.destination);
    } catch {
      context = null;
    }
    return context;
  }

  /** One oscillator blip with an exponential decay envelope, optionally pitch-sliding. */
  function tone(freq, freqEnd, duration, type, volume, delay = 0) {
    const ctx = ensure();
    if (ctx === null || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** One burst of filtered noise (impacts, gunfire, body blows) with the same envelope. */
  function noise(duration, volume, filterFreq, delay = 0) {
    const ctx = ensure();
    if (ctx === null || muted) return;
    const t0 = ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t0);
  }

  return {
    /** Call from any click or key press: browsers only unlock audio on a gesture. */
    unlock() {
      ensure();
      if (context !== null && context.state === 'suspended') context.resume().catch(() => {});
    },
    click() { tone(660, 660, 0.06, 'square', 0.12); },
    punch() { noise(0.09, 0.5, 700); tone(120, 60, 0.08, 'sine', 0.3); },
    gunshot() { noise(0.14, 0.7, 2600); tone(220, 40, 0.1, 'sawtooth', 0.2); },
    dryFire() { tone(1200, 900, 0.04, 'square', 0.1); },
    crash() { noise(0.22, 0.55, 500); tone(90, 45, 0.2, 'sine', 0.35); },
    honk() { tone(392, 392, 0.16, 'square', 0.1); tone(392, 392, 0.22, 'square', 0.1, 0.2); },
    pickup() { tone(880, 880, 0.07, 'sine', 0.22); tone(1318, 1318, 0.1, 'sine', 0.22, 0.07); },
    cash() { tone(1046, 1046, 0.06, 'triangle', 0.25); tone(1568, 1568, 0.12, 'triangle', 0.25, 0.06); },
    door() { tone(300, 180, 0.09, 'square', 0.15); noise(0.05, 0.2, 900); },
    engine() { tone(70, 140, 0.3, 'sawtooth', 0.1); },
    jingle() {
      const notes = [523, 659, 784, 1046];
      notes.forEach((n, i) => tone(n, n, 0.16, 'triangle', 0.25, i * 0.11));
    },
    fail() { tone(392, 392, 0.14, 'triangle', 0.22); tone(311, 233, 0.3, 'triangle', 0.22, 0.14); },
    busted() { tone(220, 110, 0.5, 'sawtooth', 0.2); },
    /**
     * Start or stop the looping two-tone siren. An LFO square wave wobbles one
     * oscillator between two pitches — the cheapest convincing police car there is.
     */
    setSiren(on) {
      const ctx = ensure();
      if (ctx === null) return;
      if (on && sirenNodes === null && !muted) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = 840;
        lfo.type = 'square';
        lfo.frequency.value = 0.9;
        lfoGain.gain.value = 160;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        gain.gain.value = 0.04;
        osc.connect(gain);
        gain.connect(master);
        osc.start();
        lfo.start();
        sirenNodes = { osc, lfo, gain };
      } else if (!on && sirenNodes !== null) {
        try {
          sirenNodes.osc.stop();
          sirenNodes.lfo.stop();
        } catch { /* already stopped */ }
        sirenNodes = null;
      }
    },
    toggleMute() {
      muted = !muted;
      if (master !== null && context !== null) master.gain.value = muted ? 0 : 0.5;
      if (muted) this.setSiren(false);
      return muted;
    },
    isMuted() { return muted; },
  };
}
