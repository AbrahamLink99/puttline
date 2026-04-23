const viewStart = document.getElementById('view-start');
const viewSlope = document.getElementById('view-slope');
const btnCalibrate = document.getElementById('btn-calibrate');
const btnStop = document.getElementById('btn-stop');
const errorMsg = document.getElementById('error-msg');

const readoutTotal = document.getElementById('readout-total');
const readoutPercent = document.getElementById('readout-percent');
const readoutLeftRight = document.getElementById('readout-leftright');
const readoutUpDown = document.getElementById('readout-updown');

// Smoothing time constant in seconds. Higher = smoother but laggier.
const SMOOTHING_TAU = 0.5;
// How often the UI updates (ms). The sensor fires ~60 Hz; we only
// need to repaint at ~10 Hz to feel responsive without thrashing the DOM.
const UI_INTERVAL_MS = 100;

const state = {
  beta: 0,
  gamma: 0,
  lastEventTime: null,
  uiIntervalId: null,
  initialized: false,
};

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.hidden = false;
}

function clearError() {
  errorMsg.hidden = true;
  errorMsg.textContent = '';
}

function showSlopeView() {
  clearError();
  viewStart.hidden = true;
  viewSlope.hidden = false;
}

function showStartView() {
  viewSlope.hidden = true;
  viewStart.hidden = false;
}

function handleOrientation(event) {
  if (event.beta == null || event.gamma == null) return;

  const now = performance.now();
  if (!state.initialized) {
    state.beta = event.beta;
    state.gamma = event.gamma;
    state.lastEventTime = now;
    state.initialized = true;
    return;
  }

  // Exponential moving average weighted by elapsed time, so the
  // smoothing behaves the same regardless of the sensor's sample rate.
  const dt = (now - state.lastEventTime) / 1000;
  state.lastEventTime = now;
  const alpha = 1 - Math.exp(-dt / SMOOTHING_TAU);
  state.beta += (event.beta - state.beta) * alpha;
  state.gamma += (event.gamma - state.gamma) * alpha;
}

function formatSigned(value, positiveLabel, negativeLabel) {
  const abs = Math.abs(value);
  if (abs < 0.05) return '0.0°';
  const label = value > 0 ? positiveLabel : negativeLabel;
  return `${abs.toFixed(1)}° ${label}`;
}

function updateUI() {
  const { beta, gamma } = state;
  const totalDeg = Math.sqrt(beta * beta + gamma * gamma);
  const percent = Math.tan((totalDeg * Math.PI) / 180) * 100;

  readoutTotal.textContent = `${totalDeg.toFixed(1)}°`;
  readoutPercent.textContent = `${percent.toFixed(1)}%`;
  readoutLeftRight.textContent = formatSigned(gamma, 'right', 'left');
  readoutUpDown.textContent = formatSigned(beta, 'uphill', 'downhill');

  console.log('[slope]', {
    betaRaw: beta.toFixed(2),
    gammaRaw: gamma.toFixed(2),
    totalDeg: totalDeg.toFixed(2),
    percent: percent.toFixed(2),
  });
}

function attachSensor() {
  state.initialized = false;
  state.lastEventTime = null;
  window.addEventListener('deviceorientation', handleOrientation);
  state.uiIntervalId = setInterval(updateUI, UI_INTERVAL_MS);
  showSlopeView();
}

function detachSensor() {
  window.removeEventListener('deviceorientation', handleOrientation);
  if (state.uiIntervalId) {
    clearInterval(state.uiIntervalId);
    state.uiIntervalId = null;
  }
}

async function startCalibration() {
  clearError();

  if (typeof DeviceOrientationEvent === 'undefined') {
    showError('Slope sensor not available on this device');
    return;
  }

  // iOS 13+ requires an explicit permission request triggered by a user gesture.
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') {
        showError('Slope sensor needs permission. Check your browser settings.');
        return;
      }
    } catch (err) {
      console.error('[slope] permission request failed', err);
      showError('Slope sensor needs permission. Check your browser settings.');
      return;
    }
  }

  attachSensor();
}

function stopCalibration() {
  detachSensor();
  showStartView();
}

btnCalibrate.addEventListener('click', startCalibration);
btnStop.addEventListener('click', stopCalibration);
