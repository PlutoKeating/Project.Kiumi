/**
 * One Durable Object per document. It holds no document state (D1 is the source
 * of truth); it only fans change notices out to every open editor, so an
 * Agent's edit appears on the canvas immediately. Uses the hibernation API, so
 * idle documents cost nothing.
 */
export class DocHub {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/publish') {
      const message = await request.text();
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(message); } catch { /* closed sockets are reaped by the runtime */ }
      }
      return new Response('ok');
    }
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [url.searchParams.get('client') ?? '']);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response('not found', { status: 404 });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'ping') socket.send('pong');
  }

  webSocketClose(socket: WebSocket, code: number): void {
    try { socket.close(code === 1005 ? 1000 : code); } catch { /* already closed */ }
  }
}

export interface ChangeNotice {
  type: 'changed';
  rev: number;
  /** Who made the change: `user` (browser save) or `agent` (MCP / API client). */
  by: 'user' | 'agent';
  /** Browser client id of the writer, so it can ignore its own echo. */
  from?: string;
  /** Present when small enough to apply without refetching. */
  ops?: unknown[];
  title?: string;
}
