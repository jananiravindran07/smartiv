/**
 * The alarm tone from the prototype, generated with the Web Audio API so no
 * audio file has to ship. Browsers block audio until the first user gesture,
 * so `unlock()` is called from the first interaction.
 */
let context: AudioContext | null = null;

export function unlockAlarm() {
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context = new Ctor();
  }
  if (context.state === 'suspended') void context.resume();
}

export function beep() {
  if (!context) return;
  try {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(now + 0.4);
  } catch {
    // An unavailable audio device must never break the dashboard.
  }
}

/** True while the browser reports a user preference for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
