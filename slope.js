// Slope reader built on deviceorientation.
//
// Exposes a factory that starts/stops the sensor, calls onUpdate at
// ~10 Hz with smoothed values, and optionally calls onStable once
// the values have been stable (±STABILITY_TOLERANCE) for 2 seconds.

const SMOOTHING_TAU = 0.5;
const UI_INTERVAL_MS = 100;
const STABILITY_TOLERANCE = 0.1;
const STABILITY_DURATION_MS = 2000;

function toPercent(deg) {
  return Math.tan((deg * Math.PI) / 180) * 100;
}

export function createSlopeReader({ onUpdate, onStable } = {}) {
  const smoothed = { beta: 0, gamma: 0, lastEventTime: null, initialized: false };
  const stability = { ref: null, startTime: 0, fired: false };
  let uiIntervalId = null;

  function handleOrientation(event) {
    if (event.beta == null || event.gamma == null) return;
    const now = performance.now();
    if (!smoothed.initialized) {
      smoothed.beta = event.beta;
      smoothed.gamma = event.gamma;
      smoothed.lastEventTime = now;
      smoothed.initialized = true;
      return;
    }
    const dt = (now - smoothed.lastEventTime) / 1000;
    smoothed.lastEventTime = now;
    const alpha = 1 - Math.exp(-dt / SMOOTHING_TAU);
    smoothed.beta += (event.beta - smoothed.beta) * alpha;
    smoothed.gamma += (event.gamma - smoothed.gamma) * alpha;
  }

  function updateStability(beta, gamma) {
    if (!onStable || stability.fired) return stability.fired ? 1 : 0;
    const now = performance.now();
    if (stability.ref === null) {
      stability.ref = { beta, gamma };
      stability.startTime = now;
      return 0;
    }
    const dBeta = Math.abs(beta - stability.ref.beta);
    const dGamma = Math.abs(gamma - stability.ref.gamma);
    if (dBeta > STABILITY_TOLERANCE || dGamma > STABILITY_TOLERANCE) {
      stability.ref = { beta, gamma };
      stability.startTime = now;
      return 0;
    }
    const elapsed = now - stability.startTime;
    if (elapsed >= STABILITY_DURATION_MS) {
      stability.fired = true;
      onStable({ betaDeg: stability.ref.beta, gammaDeg: stability.ref.gamma });
      return 1;
    }
    return elapsed / STABILITY_DURATION_MS;
  }

  function tick() {
    if (!smoothed.initialized) return;
    const betaDeg = smoothed.beta;
    const gammaDeg = smoothed.gamma;
    const totalDeg = Math.sqrt(betaDeg * betaDeg + gammaDeg * gammaDeg);
    const percent = toPercent(totalDeg);
    const sidePercent = toPercent(gammaDeg);
    const longPercent = toPercent(betaDeg);
    const stabilityProgress = updateStability(betaDeg, gammaDeg);

    onUpdate?.({
      betaDeg, gammaDeg,
      totalDeg, percent,
      sidePercent, longPercent,
      stabilityProgress,
    });

    console.log('[slope]', {
      beta: betaDeg.toFixed(2),
      gamma: gammaDeg.toFixed(2),
      totalDeg: totalDeg.toFixed(2),
      percent: percent.toFixed(2),
      stabilityProgress: stabilityProgress.toFixed(2),
    });
  }

  return {
    start() {
      smoothed.initialized = false;
      smoothed.lastEventTime = null;
      stability.ref = null;
      stability.fired = false;
      window.addEventListener('deviceorientation', handleOrientation);
      uiIntervalId = setInterval(tick, UI_INTERVAL_MS);
    },
    stop() {
      window.removeEventListener('deviceorientation', handleOrientation);
      if (uiIntervalId) {
        clearInterval(uiIntervalId);
        uiIntervalId = null;
      }
    },
  };
}
