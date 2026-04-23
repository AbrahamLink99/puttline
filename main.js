import { createStepCounter, getStrideCm } from './stepCounter.js';

/* Views */
const views = {
  start: document.getElementById('view-start'),
  slope: document.getElementById('view-slope'),
  distanceIntro: document.getElementById('view-distance-intro'),
  distanceActive: document.getElementById('view-distance-active'),
  distanceResult: document.getElementById('view-distance-result'),
};

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== name;
  }
  clearError();
}

/* Error banner on the start view */
const errorMsg = document.getElementById('error-msg');

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.hidden = false;
}

function clearError() {
  errorMsg.hidden = true;
  errorMsg.textContent = '';
}

/* Permission — iOS 13+ needs an explicit request triggered by a user
   gesture. Result is cached per-event-type so we don't re-prompt within
   a session. Non-iOS browsers skip the request entirely. */
const permissionState = { motion: null, orientation: null };

async function ensurePermission(kind) {
  const EventClass = kind === 'motion' ? window.DeviceMotionEvent : window.DeviceOrientationEvent;
  if (typeof EventClass === 'undefined') return 'unsupported';
  if (permissionState[kind] === 'granted') return 'granted';
  if (typeof EventClass.requestPermission !== 'function') {
    permissionState[kind] = 'granted';
    return 'granted';
  }
  try {
    const result = await EventClass.requestPermission();
    permissionState[kind] = result;
    return result;
  } catch (err) {
    console.error(`[permission] ${kind} request failed`, err);
    return 'denied';
  }
}

/* Slope */
const readoutTotal = document.getElementById('readout-total');
const readoutPercent = document.getElementById('readout-percent');
const readoutLeftRight = document.getElementById('readout-leftright');
const readoutUpDown = document.getElementById('readout-updown');

const SLOPE_SMOOTHING_TAU = 0.5;
const SLOPE_UI_INTERVAL_MS = 100;

const slopeState = {
  beta: 0,
  gamma: 0,
  lastEventTime: null,
  initialized: false,
  uiIntervalId: null,
};

function handleOrientation(event) {
  if (event.beta == null || event.gamma == null) return;
  const now = performance.now();
  if (!slopeState.initialized) {
    slopeState.beta = event.beta;
    slopeState.gamma = event.gamma;
    slopeState.lastEventTime = now;
    slopeState.initialized = true;
    return;
  }
  const dt = (now - slopeState.lastEventTime) / 1000;
  slopeState.lastEventTime = now;
  const alpha = 1 - Math.exp(-dt / SLOPE_SMOOTHING_TAU);
  slopeState.beta += (event.beta - slopeState.beta) * alpha;
  slopeState.gamma += (event.gamma - slopeState.gamma) * alpha;
}

function formatSigned(value, positiveLabel, negativeLabel) {
  const abs = Math.abs(value);
  if (abs < 0.05) return '0.0°';
  const label = value > 0 ? positiveLabel : negativeLabel;
  return `${abs.toFixed(1)}° ${label}`;
}

function updateSlopeUI() {
  const { beta, gamma } = slopeState;
  const totalDeg = Math.sqrt(beta * beta + gamma * gamma);
  const percent = Math.tan((totalDeg * Math.PI) / 180) * 100;
  readoutTotal.textContent = `${totalDeg.toFixed(1)}°`;
  readoutPercent.textContent = `${percent.toFixed(1)}%`;
  readoutLeftRight.textContent = formatSigned(gamma, 'right', 'left');
  readoutUpDown.textContent = formatSigned(beta, 'uphill', 'downhill');
  console.log('[slope]', {
    beta: beta.toFixed(2),
    gamma: gamma.toFixed(2),
    totalDeg: totalDeg.toFixed(2),
    percent: percent.toFixed(2),
  });
}

function startSlope() {
  slopeState.initialized = false;
  slopeState.lastEventTime = null;
  window.addEventListener('deviceorientation', handleOrientation);
  slopeState.uiIntervalId = setInterval(updateSlopeUI, SLOPE_UI_INTERVAL_MS);
  showView('slope');
}

function stopSlope() {
  window.removeEventListener('deviceorientation', handleOrientation);
  if (slopeState.uiIntervalId) {
    clearInterval(slopeState.uiIntervalId);
    slopeState.uiIntervalId = null;
  }
  showView('start');
}

async function onCalibrateClick() {
  clearError();
  const result = await ensurePermission('orientation');
  if (result === 'unsupported') {
    showError('Slope sensor not available on this device');
    return;
  }
  if (result !== 'granted') {
    showError('Slope sensor needs permission. Check your browser settings.');
    return;
  }
  startSlope();
}

/* Distance */
const readoutSteps = document.getElementById('readout-steps');
const readoutDistance = document.getElementById('readout-distance');
const readoutFinalDistance = document.getElementById('readout-final-distance');
const readoutFinalSteps = document.getElementById('readout-final-steps');

let stepCounter = null;
let currentSteps = 0;

function formatSteps(n) {
  return `${n} ${n === 1 ? 'step' : 'steps'}`;
}

function formatDistance(meters) {
  return `${meters.toFixed(1)} m`;
}

function metersFromSteps(steps) {
  return (steps * getStrideCm()) / 100;
}

function onStepDetected(count) {
  currentSteps = count;
  readoutSteps.textContent = formatSteps(count);
  readoutDistance.textContent = formatDistance(metersFromSteps(count));
}

async function onMeasureDistanceClick() {
  clearError();
  const result = await ensurePermission('motion');
  if (result === 'unsupported') {
    showError('Step sensor not available on this device');
    return;
  }
  if (result !== 'granted') {
    showError('Motion sensor needs permission. Check your browser settings.');
    return;
  }
  showView('distanceIntro');
}

function startStepCounting() {
  currentSteps = 0;
  readoutSteps.textContent = formatSteps(0);
  readoutDistance.textContent = formatDistance(0);
  stepCounter = createStepCounter({ onStep: onStepDetected });
  stepCounter.start();
  showView('distanceActive');
}

function stopStepCounting() {
  if (stepCounter) {
    stepCounter.stop();
    stepCounter = null;
  }
  readoutFinalDistance.textContent = formatDistance(metersFromSteps(currentSteps));
  readoutFinalSteps.textContent = formatSteps(currentSteps);
  showView('distanceResult');
}

/* Wire up buttons */
document.getElementById('btn-calibrate').addEventListener('click', onCalibrateClick);
document.getElementById('btn-slope-stop').addEventListener('click', stopSlope);

document.getElementById('btn-measure-distance').addEventListener('click', onMeasureDistanceClick);
document.getElementById('btn-distance-start').addEventListener('click', startStepCounting);
document.getElementById('btn-distance-stop').addEventListener('click', stopStepCounting);
document.getElementById('btn-distance-again').addEventListener('click', startStepCounting);
document.getElementById('btn-distance-done').addEventListener('click', () => showView('start'));
