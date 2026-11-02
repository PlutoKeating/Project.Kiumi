import * as api from '../api.ts';
import { useStore } from '../store.ts';

/**
 * Keeps one WebSocket open for the document on the canvas. When an Agent (or a
 * teammate) changes it, the server sends the ops and the canvas updates without
 * a reload. Reconnects with backoff and catches up on missed revisions.
 */
export function startLive(): () => void {
  let socket: WebSocket | null = null;
  let documentId = '';
  let scope = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  let attempt = 0;
  let stopped = false;

  const close = () => {
    clearTimeout(timer); clearInterval(beat);
    const current = socket; socket = null;
    if (current) { current.onclose = null; current.close(); }
  };

  const connect = () => {
    if (stopped || !documentId || !api.teamId()) return;
    const id = documentId, key = api.workspaceKey();
    const ws = new WebSocket(api.liveUrl(id));
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      beat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 25_000);
      // Anything saved while we were disconnected is picked up here.
      void api.openDocument(id).then(remote => {
        const local = useStore.getState().doc;
        if (local.id === id && (remote.meta.rev ?? 0) > (local.meta.rev ?? 0)) void useStore.getState().receiveChange({ rev: remote.meta.rev! });
      }).catch(() => {});
    };
    ws.onmessage = event => {
      if (event.data === 'pong' || id !== useStore.getState().doc.id || key !== api.workspaceKey()) return;
      try {
        const notice = JSON.parse(String(event.data));
        if (notice.type === 'changed') void useStore.getState().receiveChange(notice);
      } catch { /* ignore malformed notices */ }
    };
    ws.onclose = () => {
      clearInterval(beat);
      if (stopped || socket !== ws) return;
      socket = null;
      timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** attempt++));
    };
  };

  const sync = () => {
    const { doc } = useStore.getState();
    const next = doc.id.startsWith('local-') ? '' : doc.id;
    const nextScope = api.workspaceKey();
    if (next === documentId && nextScope === scope) return;
    close(); documentId = next; scope = nextScope; attempt = 0;
    connect();
  };

  sync();
  const unsubscribe = useStore.subscribe(sync);
  return () => { stopped = true; unsubscribe(); close(); };
}
