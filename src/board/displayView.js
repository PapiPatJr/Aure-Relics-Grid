/**
 * Pure presentation projection over a src/realtime/boardBridge.js BoardView. Never touches
 * authority: for 'player' mode it only ever nulls `dm`, and `authority` is passed through by
 * reference so mutationBridge/boardActions.js keep reading the original, authoritative value.
 *
 * Post-review architecture amendment (see
 * docs/superpowers/plans/2026-09-24-issue-09-dm-player-visibility.md): a manager-shaped BoardView
 * (authority.canManage === true) carries every token/character/initiative entry the backend lets
 * a manager see, including hidden/fog-blocked tokens and unapproved characters. Independent review
 * found that projecting such a view to 'player' by only nulling `dm` therefore leaked private
 * battlefield state into any player-facing rendering of it (the DM preview). A real player's own
 * BoardView (authority.canManage === false) is already the backend's authorized recipient
 * projection and must pass through unchanged aside from `dm`.
 *
 * The backend now stamps each token/character/initiative entry with an authoritative
 * `publicVisible` boolean (private.session_projection, Issue #9 review-fix migration) computed
 * with the exact same predicates the backend already uses to build a real player's own array.
 * This function never recomputes or approximates that predicate client-side — it only ever reads
 * the flag the backend already attached.
 */

/**
 * @param {import('../realtime/boardBridge.js').BoardView|null} view
 * @param {'dm'|'player'} presentationMode
 * @returns {import('../realtime/boardBridge.js').BoardView|null}
 */
export function deriveDisplayView(view, presentationMode) {
  if (view === null) return null;

  if (presentationMode === 'dm') return view;

  if (presentationMode === 'player') {
    if (view.authority?.canManage) {
      const tokens = (view.tokens || []).filter(token => token.publicVisible === true);
      const publicTokenIds = new Set(tokens.map(token => token.id));
      const characters = (view.characters || []).filter(character => character.publicVisible === true);
      const initiative = (view.initiative || [])
        .filter(entry => entry.publicVisible === true && publicTokenIds.has(entry.tokenId));
      return { ...view, dm: null, tokens, characters, initiative };
    }
    return { ...view, dm: null };
  }

  throw new Error(`Unknown presentationMode: ${presentationMode}`);
}
