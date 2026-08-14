// ---------------------------------------------------------------------------
// NATIVE BRIDGE
//
// The game runs identically in a browser and inside the iOS shell. Capacitor
// injects `window.Capacitor` at runtime, so everything here reads globals
// rather than importing from node_modules — which is what keeps the web build
// buildless. On the web every function below falls back to the browser API,
// or to a no-op where there isn't one.
// ---------------------------------------------------------------------------

const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);
const plugin = (name) => {
  const c = cap();
  return c && c.Plugins ? c.Plugins[name] : null;
};

export const isNative = () => {
  const c = cap();
  return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
};

// --- HAPTICS ---------------------------------------------------------------
//
// This is not a nice-to-have port: `navigator.vibrate` is not implemented by
// iOS Safari AT ALL, so every haptic in this game has been a silent no-op on
// iPhone since it was written. On the native side it maps to Core Haptics,
// which is also what a Unity build would ultimately be calling.
//
// The web API speaks in milliseconds; Core Haptics speaks in named impacts.
// Callers keep passing milliseconds — the mapping lives here so no call site
// has to know which platform it is on.
function impactStyle(ms) {
  if (ms <= 12) return 'LIGHT';
  if (ms <= 24) return 'MEDIUM';
  return 'HEAVY';
}

export function haptic(pattern) {
  const h = plugin('Haptics');
  if (h) {
    if (Array.isArray(pattern)) {
      // a web vibrate pattern is [buzz, gap, buzz, ...]; play the buzzes as
      // separate impacts on their own schedule so the shape survives
      let t = 0;
      for (let i = 0; i < pattern.length; i += 2) {
        const ms = pattern[i];
        setTimeout(() => { try { h.impact({ style: impactStyle(ms) }); } catch { /* denied */ } }, t);
        t += ms + (pattern[i + 1] || 0);
      }
    } else {
      try { h.impact({ style: impactStyle(pattern) }); } catch { /* denied */ }
    }
    return true;
  }
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
    return true;
  }
  return false;   // iOS Safari lands here, and always has
}

// A selection tick — for the crossing of a threshold rather than an impact.
// No web equivalent, so it degrades to a very short buzz.
export function hapticTick() {
  const h = plugin('Haptics');
  if (h) { try { h.selectionStart(); h.selectionChanged(); h.selectionEnd(); } catch { /* denied */ } return; }
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(6);
}

// --- DURABLE STORAGE -------------------------------------------------------
//
// WKWebView's localStorage can be evicted by iOS under disk pressure, which
// would silently wipe a player's bests and their whole archive. Preferences
// is UserDefaults-backed and survives.
//
// The game reads scores synchronously in a dozen places, so localStorage
// stays the working store and Preferences is a mirror: hydrated once at boot
// (before the game reads anything) and written through on every save. That
// keeps durability without turning every read site async.
const MIRRORED = [
  'timeshard_best', 'timeshard_runs', 'timeshard_doors', 'timeshard_archive',
  'timeshard_streak', 'timeshard_lastday', 'timeshard_besttime',
];

export async function hydrateStorage() {
  const prefs = plugin('Preferences');
  if (!prefs) return false;
  for (const k of MIRRORED) {
    try {
      const { value } = await prefs.get({ key: k });
      // Preferences wins only where localStorage has nothing: a fresh install
      // restored from an iCloud backup should not clobber a run in progress.
      if (value !== null && value !== undefined && localStorage.getItem(k) === null) {
        localStorage.setItem(k, value);
      }
    } catch { /* first launch */ }
  }
  return true;
}

export function persist(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
  const prefs = plugin('Preferences');
  if (prefs && MIRRORED.includes(key)) {
    prefs.set({ key, value }).catch(() => { /* best effort */ });
  }
}

// --- SHELL -----------------------------------------------------------------
// Things that only mean something inside the app: keep the screen awake during
// a run, and make sure a swipe never scrolls the shell behind the canvas.
export async function shellSetup() {
  if (!isNative()) return;
  document.documentElement.classList.add('native');
  const sb = plugin('StatusBar');
  if (sb) { try { await sb.hide(); } catch { /* not installed */ } }
}
