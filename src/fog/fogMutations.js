import { mutateWithConflictRecovery } from '../realtime/mutationBridge.js';

/**
 * Client-side fog mutation bridge for Issue #10 Task 3. Talks exclusively through the
 * existing Issue #8/#9 `createSyncEngine` (see `src/realtime/engine.js`) and its
 * `mutate_session` RPC contract — there is no second Supabase client, websocket, channel
 * lifecycle or authorization path here, and no direct write to `fog_cells`/`fog_areas`/
 * `fog_level_state`. See `supabase/migrations/20260925223100_fog_mutations.sql` for the exact
 * backend command/payload shapes this bridge must match; a payload key beyond what that
 * migration's `keys` array lists for a command is rejected server-side as `22023`.
 *
 * `expectedRevision` is never assembled here: `engine.mutate()` attaches it from the engine's
 * own applied-snapshot watermark (an exact decimal string, compared with BigInt — this bridge
 * never touches it as a JS `Number`), so a caller of this bridge cannot supply a stale or
 * fabricated one even by accident.
 *
 * Every method already runs through `mutateWithConflictRecovery`: a `40001` (stale revision)
 * or `40P01` (aborted concurrent transaction) rehydrates the authoritative snapshot exactly
 * once and resolves `{ ok: false, conflict: true, error }` — it never retries the mutation
 * itself. A fog command can disclose or conceal information, so an automatic blind replay
 * after a conflict or a lost response is exactly the "reveal unintended cells" failure mode
 * design §13.2 forbids; the caller must always decide to retry intentionally.
 *
 * @param {ReturnType<import('../realtime/engine.js').createSyncEngine>} engine
 */
export function createFogMutationBridge(engine) {
  const commands = {
    paint: (sessionId, { levelId, mode, cells }) =>
      engine.mutate(sessionId, { type: 'fog.paint', payload: { levelId, mode, cells } }),

    createArea: (sessionId, { levelId, name, cells, revealedByDefault }) =>
      engine.mutate(sessionId, { type: 'fog.area.create', payload: { levelId, name, cells, revealedByDefault } }),

    updateArea: (sessionId, { levelId, areaId, name, cells, revealedByDefault }) =>
      engine.mutate(sessionId, { type: 'fog.area.update', payload: { levelId, areaId, name, cells, revealedByDefault } }),

    deleteArea: (sessionId, { levelId, areaId }) =>
      engine.mutate(sessionId, { type: 'fog.area.delete', payload: { levelId, areaId } }),

    setAreaVisibility: (sessionId, { levelId, areaId, revealed }) =>
      engine.mutate(sessionId, { type: 'fog.area.setVisibility', payload: { levelId, areaId, revealed } }),

    revealAll: (sessionId, { levelId }) =>
      engine.mutate(sessionId, { type: 'fog.revealAll', payload: { levelId } }),

    hideAll: (sessionId, { levelId }) =>
      engine.mutate(sessionId, { type: 'fog.hideAll', payload: { levelId } }),

    resetDefaults: (sessionId, { levelId }) =>
      engine.mutate(sessionId, { type: 'fog.resetDefaults', payload: { levelId } }),

    setCampaignEnabled: (sessionId, { enabled }) =>
      engine.mutate(sessionId, { type: 'fog.setCampaignEnabled', payload: { enabled } }),

    setLocationOverride: (sessionId, { locationId, enabled }) =>
      engine.mutate(sessionId, { type: 'fog.setLocationOverride', payload: { locationId, enabled } }),

    setLevelOverride: (sessionId, { levelId, enabled }) =>
      engine.mutate(sessionId, { type: 'fog.setLevelOverride', payload: { levelId, enabled } }),
  };

  const bridge = {};
  for (const [name, sendCommand] of Object.entries(commands)) {
    bridge[name] = (sessionId, args) => mutateWithConflictRecovery(engine, sessionId, () => sendCommand(sessionId, args));
  }
  return bridge;
}
