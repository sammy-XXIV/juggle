let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function gain(c: AudioContext, value: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(value, c.currentTime);
  g.connect(c.destination);
  return g;
}

function osc(c: AudioContext, type: OscillatorType, freq: number, g: GainNode): OscillatorNode {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime);
  o.connect(g);
  return o;
}

function noise(c: AudioContext, g: GainNode): AudioBufferSourceNode {
  const buf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(g);
  return src;
}

export const Sounds = {
  /** Quick upward ding when collecting a coin */
  coin() {
    const c = getCtx();
    const t = c.currentTime;
    const g = gain(c, 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    const o = osc(c, "sine", 880, g);
    o.frequency.linearRampToValueAtTime(1320, t + 0.12);
    o.start(t); o.stop(t + 0.25);
  },

  /** Short whoosh when switching lanes */
  lane() {
    const c = getCtx();
    const t = c.currentTime;
    const g = gain(c, 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.1);
    filter.Q.value = 1.5;
    filter.connect(g);
    const n = c.createBufferSource();
    const buf = c.createBuffer(1, c.sampleRate * 0.15, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    n.connect(filter);
    n.start(t); n.stop(t + 0.1);
  },

  /** Low boom when hitting a candle */
  die() {
    const c = getCtx();
    const t = c.currentTime;
    // rumble
    const g1 = gain(c, 0.6);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    const o = osc(c, "sawtooth", 80, g1);
    o.frequency.exponentialRampToValueAtTime(20, t + 0.5);
    o.start(t); o.stop(t + 0.5);
    // noise burst
    const g2 = gain(c, 0.4);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    const n = noise(c, g2);
    n.start(t); n.stop(t + 0.3);
  },

  /** Tick when the 20s round fires */
  round() {
    const c = getCtx();
    const t = c.currentTime;
    const g = gain(c, 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    const o = osc(c, "square", 440, g);
    o.start(t); o.stop(t + 0.08);
  },

  /** Ascending chime on cash out */
  cashOut() {
    const c = getCtx();
    const notes = [523, 659, 784]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const t = c.currentTime + i * 0.12;
      const g = gain(c, 0.3);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      const o = osc(c, "sine", freq, g);
      o.start(t); o.stop(t + 0.25);
    });
  },

  /** Soft click on button tap */
  tap() {
    const c = getCtx();
    const t = c.currentTime;
    const g = gain(c, 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    const n = noise(c, g);
    n.start(t); n.stop(t + 0.04);
  },
};
