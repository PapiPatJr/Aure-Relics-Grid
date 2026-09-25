/**
 * Pure presentation projection over a src/realtime/boardBridge.js BoardView. Never touches
 * authority: for 'player' mode it only ever nulls `dm`, and `authority` is passed through by
 * reference so mutationBridge/boardActions.js keep reading the original, authoritative value.
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
    return { ...view, dm: null };
  }

  throw new Error(`Unknown presentationMode: ${presentationMode}`);
}
