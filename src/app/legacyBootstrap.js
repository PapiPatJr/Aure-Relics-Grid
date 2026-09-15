/**
 * Temporary v0.9 bridge for the existing v0.5.2 prototype.
 *
 * The current grid app lives in the root-level script.js file. Issue #4 is a
 * re-platforming step, not a feature rewrite, so this module deliberately
 * boots the legacy script inside Vite while later issues split the code into
 * focused modules for auth, campaigns, realtime sync, fog, terrain, movement,
 * and battle cards.
 */
export async function bootLegacyPrototype() {
  document.documentElement.dataset.aureRelicsRuntime = 'vite';
  await import('../../script.js');
}
