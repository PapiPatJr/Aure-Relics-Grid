import { SyncStatus } from './types.js';

/** Normalize a raw `session_events` row (snake_case) into the engine's InvalidationEnvelope shape. */
function normalizeEvent(row) {
  return {
    schemaVersion: row.schema_version,
    id: row.id,
    sessionId: row.session_id,
    revision: typeof row.revision === 'string' ? row.revision : String(row.revision),
    type: row.type,
  };
}

/**
 * Best-effort classification of a realtime channel status callback's error payload as an
 * authorization failure, used only on the subscribe() transport-status path (never for
 * hydrate()/mutate() RPC errors, which are already unambiguous via their SQLSTATE `code` and are
 * thrown through as-is). Not contract-guaranteed by Issue #8A — see
 * docs/testing/issue-08c-verification.md for why this exists and what was actually observed.
 * Conservative on purpose: an unrecognized error stays `reconnecting`, never `denied`, since a
 * false "denied" would incorrectly clear a session's revision watermarks (see engine.js).
 */
function isAuthorizationErrorPayload(err) {
  if (!err) return false;
  const code = err.code ?? err.status;
  if (code === '42501' || code === 401 || code === 403) return true;
  const message = String(err.message ?? err.reason ?? '').toLowerCase();
  return message.includes('not authorized') || message.includes('permission denied') || message.includes('access denied');
}

/**
 * Production SyncAdapter backed by the Issue #8A Supabase contract (see
 * docs/issue-08a-realtime-contract.md — hydrate -> get_session_snapshot, subscribe -> sanitized
 * session_events Postgres Changes, mutate -> mutate_session). Uses only the ordinary authenticated
 * browser client (the same one getSupabaseClient() returns) — never a service-role key, never a
 * client-side role/view-mode flag. The backend remains the sole authority; this adapter only maps
 * Supabase calls and channel statuses onto the engine's transport-neutral SyncAdapter contract.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @returns {import('./types.js').SyncAdapter}
 */
export function createSupabaseSyncAdapter(client) {
  let generation = 0; // bumped on every subscribe()/disconnect(); invalidates stale channel callbacks
  let currentChannel = null; // the channel from the most recent subscribe() call, if any
  const trackedChannels = new Set();

  function removeChannel(channel) {
    if (!trackedChannels.has(channel)) return; // already removed; stay idempotent regardless of the underlying client
    trackedChannels.delete(channel);
    try { client.removeChannel(channel); } catch { /* best-effort cleanup; nothing to recover */ }
  }

  return {
    async hydrate(sessionId) {
      const { data, error } = await client.rpc('get_session_snapshot', { p_session: sessionId });
      if (error) throw error;
      return data;
    },

    subscribe(sessionId, { onEvent, onStatus }) {
      // Defense in depth: a caller is expected to unsubscribe before subscribing again (the engine
      // always does), but if it doesn't, don't leak the abandoned channel's live transport resources.
      if (currentChannel) removeChannel(currentChannel);
      generation += 1;
      const myGeneration = generation;
      const isCurrent = () => myGeneration === generation;
      let closing = false; // true once *this* callback initiated teardown, so its own CLOSED isn't misreported

      const channel = client.channel(`session:${sessionId}`, {
        config: { postgres_changes_options: { wait: true, timeout: 15000 } },
      });
      trackedChannels.add(channel);
      currentChannel = channel;

      channel.on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'session_events',
        filter: `session_id=eq.${sessionId}`,
      }, payload => {
        if (!isCurrent()) return; // stale callback from an old subscribe()/disconnect() generation
        onEvent(normalizeEvent(payload.new));
      });

      channel.subscribe((status, err) => {
        if (!isCurrent()) return; // stale callback: session switch or disconnect already happened
        if (status === 'SUBSCRIBED') { onStatus(SyncStatus.SYNCED); return; }
        if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
          const next = isAuthorizationErrorPayload(err) ? SyncStatus.DENIED : SyncStatus.RECONNECTING;
          onStatus(next, err ? { error: err } : undefined);
          return;
        }
        if (status === 'CLOSED' && !closing) {
          onStatus(SyncStatus.CLOSED);
        }
      });

      return () => {
        closing = true;
        if (myGeneration === generation) generation += 1; // no further callback from this channel counts as current
        removeChannel(channel);
        if (currentChannel === channel) currentChannel = null;
      };
    },

    async mutate(sessionId, command) {
      const { data, error } = await client.rpc('mutate_session', { p_session: sessionId, p_command: command });
      if (error) throw error;
      return data;
    },

    disconnect() {
      generation += 1; // every outstanding channel callback becomes stale
      for (const channel of [...trackedChannels]) removeChannel(channel);
      currentChannel = null;
    },
  };
}
