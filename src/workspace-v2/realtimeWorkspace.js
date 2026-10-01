import { reconcileBoardView } from '../realtime/boardBridge.js';
import { createSyncEngine } from '../realtime/engine.js';
import { createSessionLifecycle } from '../realtime/sessionLifecycle.js';
import { createSupabaseSyncAdapter } from '../realtime/supabaseAdapter.js';
import { SyncStatus } from '../realtime/types.js';

export function mountRealtimeWorkspace({
  client,
  adapter,
  sessionId,
  onView = () => {},
  onStatus = () => {},
  onError = () => {},
} = {}) {
  if (!sessionId) throw new Error('mountRealtimeWorkspace requires a sessionId.');
  if (!adapter && !client) throw new Error('mountRealtimeWorkspace requires a client or adapter.');

  const syncAdapter = adapter ?? createSupabaseSyncAdapter(client);
  const engine = createSyncEngine(syncAdapter);
  let view = null;
  let stopped = false;

  const lifecycle = createSessionLifecycle(engine, {
    onSnapshot(snapshot) {
      if (stopped) return;
      const nextView = reconcileBoardView(view, snapshot);
      if (nextView === view) return;
      view = nextView;
      onView(view);
    },
    onStatus(status, detail) {
      if (stopped) return;
      if (status === SyncStatus.DENIED) {
        view = null;
        onView(null);
      }
      onStatus(status, detail);
    },
    onError(error) {
      if (!stopped) onError(error);
    },
  });

  lifecycle.start(sessionId);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      lifecycle.stop();
    },
  };
}

