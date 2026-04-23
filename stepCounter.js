// Step counter via devicemotion. Detects rising edges of the
// accelerometer magnitude past a threshold, with a debounce window
// to suppress double-counting inside a single walk cycle.

export const DEFAULT_STRIDE_CM = 75;
const STRIDE_STORAGE_KEY = 'puttline.strideCm';

// Starting point. Walking with the phone in hand typically produces
// smoothed magnitude peaks of 11-13 m/s² over a ~9.81 baseline (gravity).
// Tune on the green if false positives/negatives show up.
const PEAK_THRESHOLD = 11.5;
// Extra dead-band below the threshold before another rising edge can
// count. Prevents rapid toggling when the signal hovers at the threshold.
const THRESHOLD_HYSTERESIS = 0.3;
// Minimum time between two counted steps. Walking cadence is ~1-2 Hz
// (500-1000 ms per step), so 250 ms is safely under that.
const MIN_STEP_INTERVAL_MS = 250;
// Low-pass filter strength. Small alpha = heavy smoothing.
const EMA_ALPHA = 0.3;
const GRAVITY = 9.81;

export function getStrideCm() {
  const stored = localStorage.getItem(STRIDE_STORAGE_KEY);
  const parsed = stored ? parseFloat(stored) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STRIDE_CM;
}

export function setStrideCm(cm) {
  localStorage.setItem(STRIDE_STORAGE_KEY, String(cm));
}

export function createStepCounter({ onStep } = {}) {
  let smoothed = GRAVITY;
  let aboveThreshold = false;
  let lastStepTime = 0;
  let count = 0;
  let running = false;

  function handleMotion(event) {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;

    const magnitude = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    smoothed = smoothed * (1 - EMA_ALPHA) + magnitude * EMA_ALPHA;

    if (!aboveThreshold && smoothed > PEAK_THRESHOLD) {
      aboveThreshold = true;
      const now = performance.now();
      if (now - lastStepTime >= MIN_STEP_INTERVAL_MS) {
        lastStepTime = now;
        count += 1;
        console.log('[step]', {
          count,
          magnitude: magnitude.toFixed(2),
          smoothed: smoothed.toFixed(2),
        });
        onStep?.(count);
      }
    } else if (aboveThreshold && smoothed < PEAK_THRESHOLD - THRESHOLD_HYSTERESIS) {
      aboveThreshold = false;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      count = 0;
      aboveThreshold = false;
      lastStepTime = 0;
      smoothed = GRAVITY;
      window.addEventListener('devicemotion', handleMotion);
    },
    stop() {
      if (!running) return;
      running = false;
      window.removeEventListener('devicemotion', handleMotion);
    },
    getCount() {
      return count;
    },
  };
}
