/**
 * Pure bridge between an authorized SessionSnapshot (Issue #8A) and a normalized, stable
 * "board view model" the legacy board can render read-only. No DOM, no script.js import, no
 * Supabase — this module only ever transforms data it is handed. It never invents anything
 * absent from the snapshot: no HP is derived from a condition label, no hidden token is
 * reconstructed, and `dm` is exactly what the snapshot says (null for a player projection,
 * passed through unchanged for an owner projection) — there is no code path here that could
 * promote a player-shaped input into a DM-shaped view.
 */

/** Same strict decimal-string revision rule as engine.js (kept local/duplicated on purpose: this
 * module must stay independently importable without pulling in engine.js's private internals). */
function toBigInt(revision) {
  if (typeof revision !== 'string' || !/^(0|[1-9]\d*)$/.test(revision)) {
    throw new Error('Revision must be a non-negative decimal string.');
  }
  return BigInt(revision);
}

const stableTokenKey = token => `${token?.kind ?? ''}\u0000${token?.label ?? ''}\u0000${token?.id ?? ''}`;

/**
 * @typedef {Object} BoardView
 * @property {string} sessionId
 * @property {string} revision
 * @property {object|null} session
 * @property {number|null} roundNumber
 * @property {object|null} authority
 * @property {object[]} tokens
 * @property {object[]} characters
 * @property {object[]} initiative
 * @property {object|null} dm
 * @property {import('./types.js').FogProjection|null} fog The active presented level's fog
 *   projection (Issue #10), passed through exactly as the snapshot gives it — never recomputed,
 *   re-authorized, or defaulted to anything but `null` when absent.
 */

/**
 * Build a BoardView from a raw SessionSnapshot. Always rebuilds every array from the snapshot
 * alone — this is what gives reconcileBoardView its replacement (not merge) semantics: a token,
 * character or initiative entry missing from the snapshot is simply absent from the result.
 * @param {import('./types.js').SessionSnapshot} snapshot
 * @returns {BoardView}
 */
export function createBoardView(snapshot) {
  if (!snapshot || typeof snapshot.revision !== 'string') {
    throw new Error('createBoardView requires a snapshot with a decimal-string revision.');
  }
  return {
    sessionId: snapshot.sessionId,
    revision: snapshot.revision,
    session: snapshot.session ?? null,
    roundNumber: snapshot.roundNumber ?? null,
    authority: snapshot.authority ?? null,
    tokens: Array.isArray(snapshot.tokens) ? [...snapshot.tokens].sort((a, b) => {
      const ka = stableTokenKey(a), kb = stableTokenKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }) : [],
    characters: Array.isArray(snapshot.characters) ? [...snapshot.characters] : [],
    initiative: Array.isArray(snapshot.initiative) ? [...snapshot.initiative] : [],
    // Never fabricated when absent; passed through exactly as given when present.
    dm: snapshot.dm ?? null,
    fog: snapshot.fog ?? null,
  };
}

/**
 * Apply an authoritative snapshot on top of a previous view, with replacement semantics and
 * revision-guarded staleness protection — the same rule engine.js itself uses (BigInt, never
 * lexical, never Number). A snapshot for a different session is always a fresh install (revisions
 * are never comparable across sessions, per the 8A contract). A stale, duplicate, or
 * lower-revision snapshot returns `previousView` unchanged, by reference, so a caller can cheaply
 * check `result === previousView` to skip re-rendering.
 * @param {BoardView|null} previousView
 * @param {import('./types.js').SessionSnapshot|null|undefined} snapshot
 * @returns {BoardView|null}
 */
export function reconcileBoardView(previousView, snapshot) {
  if (!snapshot) return previousView ?? null;
  if (!previousView || previousView.sessionId !== snapshot.sessionId) return createBoardView(snapshot);
  const nextRevision = toBigInt(snapshot.revision);
  const previousRevision = toBigInt(previousView.revision);
  if (nextRevision <= previousRevision) return previousView;
  return createBoardView(snapshot);
}
