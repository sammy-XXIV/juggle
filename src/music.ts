let audioCtx: AudioContext | null = null;
let masterVol: GainNode | null = null;
let loopRunning = false;
let nextBeat = 0;
let beatIdx = 0;
let timerId: number | undefined;

const BPM = 138;
const STEP = (60 / BPM) / 4;
const LEN = 32;

const BASS_SEQ: (number | null)[] = [
  110, null, 110, null, 146.8, null, 164.8, null,
  110, null, 130.8, null, 146.8, null, 110, null,
  110, null, 110, null, 164.8, null, 196, null,
  130.8, null, 146.8, null, 110, null, null, null,
];

const LEAD_SEQ: (number | null)[] = [
  null, 440, null, 523, null, 659, null, 523,
  440, null, 587, null, 523, null, 440, null,
  null, 440, null, 659, null, 784, null, 659,
  587, null, 523, null, 659, null, null, null,
];

const KICKS  = new Set([0, 8, 16, 24]);
const HIHATS = new Set([4, 12, 20, 28]);

function ac(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterVol = audioCtx.createGain();
    masterVol.gain.value = 0.18;
    masterVol.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function note(hz: number, t: number, dur: number, shape: OscillatorType, v: number) {
  const c = audioCtx!; const g = c.createGain();
  g.gain.setValueAtTime(v, t);
  g.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.15);
  g.connect(masterVol!);
  const o = c.createOscillator(); o.type = shape;
  o.frequency.value = hz; o.connect(g);
  o.start(t); o.stop(t + dur + 0.05);
}

function kick(t: number) {
  const c = audioCtx!; const g = c.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  g.connect(masterVol!);
  const o = c.createOscillator(); o.type = "sine";
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
  o.connect(g); o.start(t); o.stop(t + 0.25);
}

function hihat(t: number) {
  const c = audioCtx!;
  const buf = c.createBuffer(1, c.sampleRate * 0.05, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const g = c.createGain(); g.gain.setValueAtTime(0.07, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7000;
  f.connect(masterVol!); g.connect(f);
  const s = c.createBufferSource(); s.buffer = buf; s.connect(g);
  s.start(t);
}

function tick() {
  const c = ac();
  while (nextBeat < c.currentTime + 0.1) {
    const i = beatIdx % LEN;
    if (BASS_SEQ[i] != null) note(BASS_SEQ[i]!, nextBeat, STEP * 1.8, "square", 0.28);
    if (LEAD_SEQ[i] != null) note(LEAD_SEQ[i]!, nextBeat, STEP * 0.9, "sine",   0.18);
    if (KICKS.has(i))  kick(nextBeat);
    if (HIHATS.has(i)) hihat(nextBeat);
    nextBeat += STEP;
    beatIdx++;
  }
}

export function startMusic() {
  if (loopRunning) return;
  loopRunning = true;
  const c = ac();
  nextBeat = c.currentTime + 0.05;
  beatIdx = 0;
  tick();
  timerId = window.setInterval(tick, 50);
}

export function stopMusic() {
  if (!loopRunning) return;
  loopRunning = false;
  window.clearInterval(timerId);
  if (masterVol && audioCtx) {
    masterVol.gain.setTargetAtTime(0, audioCtx.currentTime, 0.3);
    setTimeout(() => { if (masterVol) masterVol.gain.value = 0.18; }, 1000);
  }
}
