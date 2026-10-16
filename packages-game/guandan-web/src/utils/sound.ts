import { ref } from 'vue';

export type SoundName = 'play' | 'bomb' | 'single' | 'win' | 'lose';

const muted = ref(localStorage.getItem('guandan_muted') === '1');
let ctx: AudioContext | null = null;

export function isMuted() {
  return muted.value;
}
export function setMuted(v: boolean) {
  muted.value = v;
  localStorage.setItem('guandan_muted', v ? '1' : '0');
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC: typeof AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** 在用户手势（点击/开局）中调用，解锁浏览器音频自动播放限制 */
export function resumeAudio() {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.2,
) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.02);
}

function noiseBurst(start: number, dur: number, gain = 0.3) {
  const c = getCtx();
  if (!c) return;
  const size = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, size, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const g = c.createGain();
  g.gain.value = gain;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  src.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  src.start(c.currentTime + start);
  src.stop(c.currentTime + start + dur);
}

/** 播放音效（受静音开关控制） */
export function playSound(name: SoundName) {
  if (muted.value) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  switch (name) {
    case 'play':
      tone(520, 0, 0.08, 'triangle', 0.14);
      break;
    case 'bomb':
      noiseBurst(0, 0.38, 0.35);
      tone(110, 0, 0.42, 'sawtooth', 0.25);
      tone(68, 0.02, 0.46, 'sine', 0.32);
      break;
    case 'single':
      tone(880, 0, 0.12, 'sine', 0.2);
      tone(1175, 0.12, 0.18, 'sine', 0.2);
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.18, 'triangle', 0.22));
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) => tone(f, i * 0.16, 0.24, 'sine', 0.22));
      break;
  }
}

/** 震动反馈（桌面端无操作；不受静音开关影响，可单独控制） */
export function vibrate(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
