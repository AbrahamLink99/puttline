// User preferences in localStorage.

const KEYS = {
  strideCm: 'puttline.strideCm',
  stimp: 'puttline.stimp',
};

export const DEFAULTS = Object.freeze({
  strideCm: 75,
  stimp: 10,
});

export const LIMITS = Object.freeze({
  strideCm: { min: 30, max: 150 },
  stimp: { min: 6, max: 14 },
});

function readNumber(key, def, min, max) {
  const raw = localStorage.getItem(key);
  const parsed = raw == null ? NaN : parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return def;
  return parsed;
}

export function getStrideCm() {
  return readNumber(KEYS.strideCm, DEFAULTS.strideCm, LIMITS.strideCm.min, LIMITS.strideCm.max);
}
export function setStrideCm(v) {
  localStorage.setItem(KEYS.strideCm, String(v));
}
export function getStimp() {
  return readNumber(KEYS.stimp, DEFAULTS.stimp, LIMITS.stimp.min, LIMITS.stimp.max);
}
export function setStimp(v) {
  localStorage.setItem(KEYS.stimp, String(v));
}
