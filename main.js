import { ensurePermission } from './permission.js';
import { createSlopeReader } from './slope.js';
import { createStepCounter } from './stepCounter.js';
import { calculateAim } from './physics.js';
import {
  getStimp, setStimp,
  getStrideCm, setStrideCm,
  LIMITS,
} from './settings.js';

/* ---------- View registry ---------- */

const viewIds = [
  'home',
  'slope',
  'distanceIntro',
  'distanceActive',
  'distanceResult',
  'result',
  'settings',
];

const views = {};
for (const id of viewIds) {
  const dashed = id.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  views[id] = document.getElementById(`view-${dashed}`);
}

const state = {
  currentView: 'home',
  // 'standalone' = slope-only or distance-only entry from home
  // 'linked'     = New putt full flow (slope → distance → result)
  mode: 'standalone',
  measurement: { slopeSide: 0, slopeLong: 0, distance: 0 },
  slopeReader: null,
  stepCounter: null,
  currentSteps: 0,
};

function navigate(viewName) {
  stopSensors();
  clearError();
  for (const el of Object.values(views)) el.hidden = true;
  views[viewName].hidden = false;
  state.currentView = viewName;
  const enter = enterHooks[viewName];
  if (enter) enter();
}

function stopSensors() {
  if (state.slopeReader) { state.slopeReader.stop(); state.slopeReader = null; }
  if (state.stepCounter) { state.stepCounter.stop(); state.stepCounter = null; }
}

const enterHooks = {};

/* ---------- Error banner ---------- */

const errorEl = document.getElementById('error-msg');
function showError(msg) { errorEl.textContent = msg; errorEl.hidden = false; }
function clearError() { errorEl.hidden = true; errorEl.textContent = ''; }

/* ---------- Home ---------- */

const footerInfo = document.getElementById('footer-info');
function updateFooterInfo() {
  footerInfo.textContent = `v0.1 · Stimp ${getStimp()}`;
}
enterHooks.home = () => {
  state.mode = 'standalone';
  updateFooterInfo();
};

document.getElementById('btn-new-putt').addEventListener('click', async () => {
  clearError();
  const motion = await ensurePermission('motion');
  const orientation = await ensurePermission('orientation');
  if (motion === 'unsupported' || orientation === 'unsupported') {
    showError('Sensors are not available on this device');
    return;
  }
  if (motion !== 'granted' || orientation !== 'granted') {
    showError('Motion sensors need permission. Check your browser settings.');
    return;
  }
  state.mode = 'linked';
  state.measurement = { slopeSide: 0, slopeLong: 0, distance: 0 };
  navigate('slope');
});

document.getElementById('btn-slope-only').addEventListener('click', async () => {
  clearError();
  const result = await ensurePermission('orientation');
  if (result === 'unsupported') { showError('Slope sensor not available on this device'); return; }
  if (result !== 'granted') { showError('Slope sensor needs permission. Check your browser settings.'); return; }
  state.mode = 'standalone';
  navigate('slope');
});

document.getElementById('btn-distance-only').addEventListener('click', async () => {
  clearError();
  const result = await ensurePermission('motion');
  if (result === 'unsupported') { showError('Step sensor not available on this device'); return; }
  if (result !== 'granted') { showError('Motion sensor needs permission. Check your browser settings.'); return; }
  state.mode = 'standalone';
  navigate('distanceIntro');
});

document.getElementById('btn-open-settings').addEventListener('click', () => navigate('settings'));

/* ---------- Slope ---------- */

const slopeEls = {
  header: document.getElementById('slope-header'),
  subtext: document.getElementById('slope-subtext'),
  total: document.getElementById('readout-total'),
  percent: document.getElementById('readout-percent'),
  leftRight: document.getElementById('readout-leftright'),
  upDown: document.getElementById('readout-updown'),
  actionBtn: document.getElementById('btn-slope-action'),
  stabilityCards: [
    document.getElementById('card-total'),
    document.getElementById('card-leftright'),
    document.getElementById('card-updown'),
  ],
};

function formatSigned(value, positiveLabel, negativeLabel) {
  const abs = Math.abs(value);
  if (abs < 0.05) return '0.0°';
  return `${abs.toFixed(1)}° ${value > 0 ? positiveLabel : negativeLabel}`;
}

function renderSlope({ betaDeg, gammaDeg, totalDeg, percent, stabilityProgress = 0 }) {
  slopeEls.total.textContent = `${totalDeg.toFixed(1)}°`;
  slopeEls.percent.textContent = `${percent.toFixed(1)}%`;
  slopeEls.leftRight.textContent = formatSigned(gammaDeg, 'right', 'left');
  slopeEls.upDown.textContent = formatSigned(betaDeg, 'uphill', 'downhill');
  for (const c of slopeEls.stabilityCards) {
    c.style.setProperty('--stability', String(stabilityProgress));
    c.classList.toggle('is-stabilizing', stabilityProgress > 0);
  }
}

function onSlopeCaptured({ betaDeg, gammaDeg }) {
  // Convert device angles to percent and stash on measurement.
  // Gamma = roll (left/right tilt), beta = pitch (up/downhill).
  state.measurement.slopeSide = Math.tan((gammaDeg * Math.PI) / 180) * 100;
  state.measurement.slopeLong = Math.tan((betaDeg * Math.PI) / 180) * 100;
  navigate('distanceIntro');
}

enterHooks.slope = () => {
  if (state.mode === 'linked') {
    slopeEls.header.textContent = 'Place phone at ball';
    slopeEls.subtext.hidden = false;
    slopeEls.subtext.textContent = 'Lay flat on the green — values will lock automatically when steady';
    slopeEls.actionBtn.textContent = 'Skip';
    state.slopeReader = createSlopeReader({
      onUpdate: renderSlope,
      onStable: onSlopeCaptured,
    });
  } else {
    slopeEls.header.textContent = 'Slope';
    slopeEls.subtext.hidden = true;
    slopeEls.actionBtn.textContent = 'Stop';
    state.slopeReader = createSlopeReader({ onUpdate: renderSlope });
  }
  // Reset any leftover pulse state
  for (const c of slopeEls.stabilityCards) {
    c.style.setProperty('--stability', '0');
    c.classList.remove('is-stabilizing');
  }
  state.slopeReader.start();
};

slopeEls.actionBtn.addEventListener('click', () => {
  if (state.mode === 'linked') {
    // Skip: capture current smoothed readout and move on
    const betaPct = readPercentFromText(slopeEls.upDown.textContent, 'downhill');
    const gammaPct = readPercentFromText(slopeEls.leftRight.textContent, 'left');
    state.measurement.slopeLong = betaPct;
    state.measurement.slopeSide = gammaPct;
    navigate('distanceIntro');
  } else {
    navigate('home');
  }
});

// Parse "X.X° label" back into a signed percent. Used by the Skip button
// so we don't have to plumb the last raw reading separately.
function readPercentFromText(text, negativeLabel) {
  const m = /([-\d.]+)°\s*(\w+)?/.exec(text);
  if (!m) return 0;
  const deg = parseFloat(m[1]);
  const sign = m[2] === negativeLabel ? -1 : 1;
  return Math.tan((deg * sign * Math.PI) / 180) * 100;
}

/* ---------- Distance ---------- */

const distanceEls = {
  steps: document.getElementById('readout-steps'),
  live: document.getElementById('readout-distance'),
  finalDistance: document.getElementById('readout-final-distance'),
  finalSteps: document.getElementById('readout-final-steps'),
};

function formatSteps(n) { return `${n} ${n === 1 ? 'step' : 'steps'}`; }
function formatDistance(m) { return `${m.toFixed(1)} m`; }
function metersFromSteps(s) { return (s * getStrideCm()) / 100; }

function onStepDetected(count) {
  state.currentSteps = count;
  distanceEls.steps.textContent = formatSteps(count);
  distanceEls.live.textContent = formatDistance(metersFromSteps(count));
}

document.getElementById('btn-distance-start').addEventListener('click', () => {
  state.currentSteps = 0;
  distanceEls.steps.textContent = formatSteps(0);
  distanceEls.live.textContent = formatDistance(0);
  state.stepCounter = createStepCounter({ onStep: onStepDetected });
  state.stepCounter.start();
  views.distanceIntro.hidden = true;
  views.distanceActive.hidden = false;
  state.currentView = 'distanceActive';
});

document.getElementById('btn-distance-cancel').addEventListener('click', () => navigate('home'));

document.getElementById('btn-distance-stop').addEventListener('click', () => {
  stopSensors();
  const meters = metersFromSteps(state.currentSteps);
  if (state.mode === 'linked') {
    state.measurement.distance = meters;
    navigate('result');
  } else {
    distanceEls.finalDistance.textContent = formatDistance(meters);
    distanceEls.finalSteps.textContent = formatSteps(state.currentSteps);
    views.distanceActive.hidden = true;
    views.distanceResult.hidden = false;
    state.currentView = 'distanceResult';
  }
});

document.getElementById('btn-distance-again').addEventListener('click', () => navigate('distanceIntro'));
document.getElementById('btn-distance-done').addEventListener('click', () => navigate('home'));

/* ---------- Result (linked flow) ---------- */

const resultEls = {
  aim: document.getElementById('readout-aim'),
  distance: document.getElementById('readout-result-distance'),
  playDistance: document.getElementById('readout-result-playdistance'),
  slopeSide: document.getElementById('readout-result-slope-side'),
  slopeLong: document.getElementById('readout-result-slope-long'),
  svg: document.getElementById('trajectory-svg'),
  stimpValue: document.getElementById('result-stimp-value'),
};

function formatAim(cm) {
  const abs = Math.abs(cm);
  if (abs < 1) return '0 cm';
  const label = cm > 0 ? 'right' : 'left';
  return `${Math.round(abs)} cm ${label}`;
}

function renderResult() {
  const { slopeSide, slopeLong, distance } = state.measurement;
  const stimp = getStimp();
  const result = calculateAim({
    distanceMeters: Math.max(distance, 0.1),
    slopePercentSide: slopeSide,
    slopePercentLong: slopeLong,
    stimp,
  });

  resultEls.aim.textContent = formatAim(result.aimOffsetCm);
  resultEls.distance.textContent = `${distance.toFixed(1)} m`;
  const playDelta = Math.abs(result.playDistanceMeters - distance);
  resultEls.playDistance.textContent = playDelta >= 0.2
    ? `plays as ${result.playDistanceMeters.toFixed(1)} m`
    : '';

  resultEls.slopeSide.textContent =
    Math.abs(slopeSide) < 0.05
      ? '0.0% side'
      : `${Math.abs(slopeSide).toFixed(1)}% ${slopeSide > 0 ? 'right' : 'left'}`;
  resultEls.slopeLong.textContent =
    Math.abs(slopeLong) < 0.05
      ? '0.0% level'
      : `${Math.abs(slopeLong).toFixed(1)}% ${slopeLong > 0 ? 'up' : 'down'}`;

  resultEls.stimpValue.textContent = String(stimp);
  renderTrajectory(result.trajectory, distance, result.aimOffsetCm);

  console.log('[result]', { ...state.measurement, stimp, ...result });
}

function renderTrajectory(trajectory, distance, aimOffsetCm) {
  const svg = resultEls.svg;
  const W = 300;
  const H = 240;
  const pad = 24;

  // Determine horizontal scale: need to fit trajectory AND aim/hole positions.
  let maxAbsX = 0;
  for (const p of trajectory) maxAbsX = Math.max(maxAbsX, Math.abs(p.x));
  maxAbsX = Math.max(maxAbsX, Math.abs(aimOffsetCm) / 100);
  const xRange = Math.max(maxAbsX * 1.3, 0.2); // meters

  const sx = (xMeters) => W / 2 + (xMeters / xRange) * (W / 2 - pad);
  const sy = (yMeters) => H - pad - (yMeters / distance) * (H - 2 * pad);

  const ball = { x: sx(0), y: sy(0) };
  const hole = { x: sx(0), y: sy(distance) };
  const aim = { x: sx(aimOffsetCm / 100), y: sy(distance) };

  const pathD = trajectory
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`)
    .join(' ');

  svg.innerHTML = `
    <line x1="${ball.x}" y1="${ball.y}" x2="${aim.x}" y2="${aim.y}"
      stroke="#f0f5e8" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.6" />
    <path d="${pathD}" stroke="#ffd966" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${hole.x}" cy="${hole.y}" r="7" fill="#06180c" stroke="#f0f5e8" stroke-width="1.5" />
    <circle cx="${ball.x}" cy="${ball.y}" r="5" fill="#f0f5e8" />
  `;
}

enterHooks.result = renderResult;

document.getElementById('btn-stimp-up').addEventListener('click', () => {
  const next = Math.min(getStimp() + 0.5, LIMITS.stimp.max);
  setStimp(next);
  renderResult();
  updateFooterInfo();
});
document.getElementById('btn-stimp-down').addEventListener('click', () => {
  const next = Math.max(getStimp() - 0.5, LIMITS.stimp.min);
  setStimp(next);
  renderResult();
  updateFooterInfo();
});

document.getElementById('btn-result-new').addEventListener('click', async () => {
  clearError();
  state.mode = 'linked';
  state.measurement = { slopeSide: 0, slopeLong: 0, distance: 0 };
  navigate('slope');
});
document.getElementById('btn-result-done').addEventListener('click', () => navigate('home'));

/* ---------- Settings ---------- */

const settingsEls = {
  stimp: document.getElementById('setting-stimp'),
  stride: document.getElementById('setting-stride'),
};

enterHooks.settings = () => {
  settingsEls.stimp.value = String(getStimp());
  settingsEls.stride.value = String(getStrideCm());
};

settingsEls.stimp.addEventListener('change', () => {
  const v = parseFloat(settingsEls.stimp.value);
  if (Number.isFinite(v)) {
    setStimp(Math.min(Math.max(v, LIMITS.stimp.min), LIMITS.stimp.max));
    updateFooterInfo();
  }
});
settingsEls.stride.addEventListener('change', () => {
  const v = parseFloat(settingsEls.stride.value);
  if (Number.isFinite(v)) {
    setStrideCm(Math.min(Math.max(v, LIMITS.strideCm.min), LIMITS.strideCm.max));
  }
});

document.getElementById('btn-settings-back').addEventListener('click', () => navigate('home'));

/* ---------- Boot ---------- */

updateFooterInfo();
enterHooks.home();
