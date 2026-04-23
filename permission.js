// Shared iOS motion/orientation permission helper.
// Result is cached per event-type so subsequent requests within a
// session don't re-trigger the browser prompt.

const permissionState = { motion: null, orientation: null };

export async function ensurePermission(kind) {
  const EventClass = kind === 'motion'
    ? window.DeviceMotionEvent
    : window.DeviceOrientationEvent;

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
