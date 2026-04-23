// Penner-style putt simulation.
//
// We model the ball as a point rolling on a tilted plane with a single
// rolling-friction coefficient derived from the green's stimp reading.
// Euler-integrate over time to trace the trajectory, then binary-search
// the initial aim angle so the ball's path crosses the hole line at x=0.

const G = 9.81;
// Initial velocity of a ball released from a standard USGA Stimpmeter
// ramp (~6 ft/s). Used to derive rolling friction from the stimp reading.
const STIMP_V0 = 1.83;
// Simulation timestep in seconds (10 ms, per spec).
const DT = 0.01;
// Speed below which the ball is treated as stopped.
const STOP_SPEED = 0.05;
// Safety cap on simulation iterations (30 s worth).
const MAX_STEPS = 3000;

// From v0² = 2·μ·g·D with D in meters = stimp_feet · 0.3048.
// The spec called for μ = 1/(stimp·0.3048·g·2), but that drops the v0²
// term and produces unrealistically low friction (~0.017 at stimp 10);
// the physical value for a stimp 10 green is ~0.056, which is what this
// formula gives. The numerator was corrected to STIMP_V0².
function frictionFromStimp(stimp) {
  const stimpMeters = stimp * 0.3048;
  return (STIMP_V0 * STIMP_V0) / (2 * G * stimpMeters);
}

function simulate({ initialSpeed, aimAngle, aSide, aLongSlope, mu, targetY }) {
  let x = 0;
  let y = 0;
  let vx = initialSpeed * Math.sin(aimAngle);
  let vy = initialSpeed * Math.cos(aimAngle);
  const friction = mu * G;
  const trajectory = [{ x: 0, y: 0 }];
  let xAtTarget = null;

  for (let i = 0; i < MAX_STEPS; i++) {
    const speed = Math.hypot(vx, vy);
    if (speed < STOP_SPEED) break;

    // Friction opposes the velocity vector; side- and long-slope add
    // constant components along the tilted surface axes.
    const ax = aSide - friction * (vx / speed);
    const ay = aLongSlope - friction * (vy / speed);

    const prevY = y;
    vx += ax * DT;
    vy += ay * DT;
    x += vx * DT;
    y += vy * DT;

    if (xAtTarget === null && prevY < targetY && y >= targetY) {
      const t = (targetY - prevY) / (y - prevY);
      xAtTarget = x - vx * DT * (1 - t);
    }

    trajectory.push({ x, y });

    if (Math.abs(y) > targetY * 3 || Math.abs(x) > targetY * 3) break;
  }

  return { endX: x, endY: y, xAtTarget, trajectory };
}

// Compute the aim offset for a breaking putt.
//
// Conventions:
//   slopePercentSide  positive = right side slopes DOWN, ball breaks RIGHT
//                     → aimOffsetCm comes out negative (aim LEFT)
//   slopePercentLong  positive = uphill (ball plays longer)
//   aimOffsetCm       positive = right of hole, negative = left
export function calculateAim({
  distanceMeters,
  slopePercentSide = 0,
  slopePercentLong = 0,
  stimp = 10,
} = {}) {
  const mu = frictionFromStimp(stimp);
  const slopeFracSide = slopePercentSide / 100;
  const slopeFracLong = slopePercentLong / 100;

  // Energy balance: v0² = 2·g·D·(μ + slope_long). The equivalent flat
  // distance is D·(1 + slope_long/μ). Floored at 20% to keep the sim
  // stable when a steep downhill would otherwise need zero initial speed.
  const playDistanceMeters = Math.max(
    distanceMeters * (1 + slopeFracLong / mu),
    distanceMeters * 0.2,
  );
  const initialSpeed = Math.sqrt(2 * mu * G * playDistanceMeters);

  const aSide = G * slopeFracSide;
  const aLongSlope = -G * slopeFracLong;

  // Binary-search aim angle so the trajectory crosses y=distance at x=0.
  let low = -Math.PI / 3;
  let high = Math.PI / 3;
  let best = null;

  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const sim = simulate({
      initialSpeed,
      aimAngle: mid,
      aSide,
      aLongSlope,
      mu,
      targetY: distanceMeters,
    });
    best = { ...sim, aimAngle: mid };

    const criterionX = sim.xAtTarget !== null ? sim.xAtTarget : sim.endX;
    if (criterionX > 0) high = mid;
    else low = mid;
  }

  const aimOffsetCm = distanceMeters * Math.tan(best.aimAngle) * 100;

  return {
    aimOffsetCm,
    playDistanceMeters,
    trajectory: best.trajectory,
  };
}

// --- Sanity checks (call manually from console to verify) ----------------

export function runSanityTests() {
  const results = [];

  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (err) { results.push({ name, ok: false, err: err.message }); }
  }

  function assertCloseTo(actual, expected, tolerance, label) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${label}: expected ${expected}±${tolerance}, got ${actual.toFixed(3)}`);
    }
  }

  test('flat green: aim ≈ 0, play ≈ distance', () => {
    const r = calculateAim({ distanceMeters: 5, slopePercentSide: 0, slopePercentLong: 0, stimp: 10 });
    assertCloseTo(r.aimOffsetCm, 0, 1, 'aim');
    assertCloseTo(r.playDistanceMeters, 5, 0.05, 'playDistance');
  });

  test('pure uphill: aim 0, play longer', () => {
    const r = calculateAim({ distanceMeters: 5, slopePercentSide: 0, slopePercentLong: 1, stimp: 10 });
    assertCloseTo(r.aimOffsetCm, 0, 1, 'aim');
    if (r.playDistanceMeters <= 5) throw new Error('expected play > 5m on uphill');
  });

  test('pure downhill: aim 0, play shorter', () => {
    const r = calculateAim({ distanceMeters: 5, slopePercentSide: 0, slopePercentLong: -1, stimp: 10 });
    assertCloseTo(r.aimOffsetCm, 0, 1, 'aim');
    if (r.playDistanceMeters >= 5) throw new Error('expected play < 5m on downhill');
  });

  test('2% right-breaking, 5m, stimp 10: aim LEFT with measurable break', () => {
    const r = calculateAim({ distanceMeters: 5, slopePercentSide: 2, slopePercentLong: 0, stimp: 10 });
    if (r.aimOffsetCm >= 0) throw new Error(`expected negative (left) aim, got ${r.aimOffsetCm}`);
    const abs = Math.abs(r.aimOffsetCm);
    if (abs < 20) throw new Error(`expected at least 20 cm break, got ${abs.toFixed(1)}`);
    if (abs > 200) throw new Error(`expected less than 200 cm break, got ${abs.toFixed(1)}`);
  });

  test('flipping slope flips aim sign symmetrically', () => {
    const rR = calculateAim({ distanceMeters: 5, slopePercentSide: 2, slopePercentLong: 0, stimp: 10 });
    const rL = calculateAim({ distanceMeters: 5, slopePercentSide: -2, slopePercentLong: 0, stimp: 10 });
    if (Math.sign(rR.aimOffsetCm) === Math.sign(rL.aimOffsetCm)) {
      throw new Error('sign of aim should flip');
    }
    assertCloseTo(Math.abs(rR.aimOffsetCm), Math.abs(rL.aimOffsetCm), 2, 'symmetry');
  });

  test('shorter putt breaks less than longer at same slope', () => {
    const s = calculateAim({ distanceMeters: 1, slopePercentSide: 2, slopePercentLong: 0, stimp: 10 });
    const l = calculateAim({ distanceMeters: 5, slopePercentSide: 2, slopePercentLong: 0, stimp: 10 });
    if (Math.abs(s.aimOffsetCm) >= Math.abs(l.aimOffsetCm)) {
      throw new Error('short should break less');
    }
  });

  test('faster green breaks more than slower at same slope', () => {
    const slow = calculateAim({ distanceMeters: 5, slopePercentSide: 2, slopePercentLong: 0, stimp: 8 });
    const fast = calculateAim({ distanceMeters: 5, slopePercentSide: 2, slopePercentLong: 0, stimp: 12 });
    if (Math.abs(fast.aimOffsetCm) <= Math.abs(slow.aimOffsetCm)) {
      throw new Error('faster green should break more');
    }
  });

  console.group('physics.js sanity tests');
  for (const r of results) {
    if (r.ok) console.log('PASS:', r.name);
    else console.error('FAIL:', r.name, '—', r.err);
  }
  console.groupEnd();
  return results;
}
