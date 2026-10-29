// OIDC login for the editor. The Worker runs the authorization-code flow with
// PKCE and keeps a signed session cookie, so the browser never holds tokens.

export interface AuthEnv {
  ID_ISSUER_URL?: string;
  ID_CLIENT_ID?: string;
  KIUMI_DATA_KEY?: string;
}

export interface SessionUser {
  sub: string;
  name?: string;
  email?: string;
}

const SESSION_COOKIE = 'kiumi_session';
const STATE_COOKIE = 'kiumi_oidc';
const SESSION_TTL = 60 * 60 * 24 * 30;

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = (text: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

const encoder = new TextEncoder();

async function hmacKey(env: AuthEnv): Promise<CryptoKey> {
  const secret = env.KIUMI_DATA_KEY ?? 'kiumi-dev-only-secret';
  return crypto.subtle.importKey('raw', encoder.encode(`session:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

async function sign(env: AuthEnv, value: string): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(value));
  return `${value}.${b64url(new Uint8Array(mac))}`;
}

async function unsign(env: AuthEnv, signed: string | undefined): Promise<string | null> {
  if (!signed) return null;
  const index = signed.lastIndexOf('.');
  if (index < 0) return null;
  const value = signed.slice(0, index);
  const mac = fromB64url(signed.slice(index + 1));
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), mac, encoder.encode(value));
  return ok ? value : null;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function config(env: AuthEnv) {
  const issuer = env.ID_ISSUER_URL;
  const clientId = env.ID_CLIENT_ID;
  if (!issuer || !clientId) return null;
  return { issuer: issuer.replace(/\/$/, ''), clientId };
}

export async function currentUser(request: Request, env: AuthEnv): Promise<SessionUser | null> {
  const raw = await unsign(env, readCookie(request, SESSION_COOKIE));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as SessionUser & { exp: number };
    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: session.sub, name: session.name, email: session.email };
  } catch {
    return null;
  }
}

async function verifyIdToken(token: string, env: AuthEnv, issuer: string, clientId: string): Promise<SessionUser> {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('malformed id_token');
  const header = JSON.parse(new TextDecoder().decode(fromB64url(headerPart))) as { alg: string; kid?: string };
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(payloadPart))) as Record<string, unknown>;

  const jwks = (await (await fetch(`${issuer}/.well-known/jwks.json`)).json()) as {
    keys: (JsonWebKey & { kid?: string })[];
  };
  const jwk = jwks.keys.find((key) => key.kid === header.kid) ?? jwks.keys[0];
  if (!jwk) throw new Error('no signing key');
  const key = await crypto.subtle.importKey(
    'jwk',
    { ...jwk, alg: header.alg, ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    fromB64url(signaturePart),
    encoder.encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new Error('bad id_token signature');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) throw new Error('id_token expired');
  const claimIssuer = String(payload.iss ?? '').replace(/\/$/, '');
  if (claimIssuer && claimIssuer !== issuer) throw new Error('issuer mismatch');
  // aud may be a single value or a list, depending on what the issuer grants.
  const audience = payload.aud;
  const audiences = Array.isArray(audience) ? audience.map(String) : audience ? [String(audience)] : [];
  if (audiences.length && !audiences.includes(clientId)) {
    throw new Error(`audience mismatch: ${audiences.join(',')} vs ${clientId}`);
  }

  return {
    sub: String(payload.sub),
    name: (payload.name ?? payload.email ?? payload.sub) as string,
    email: payload.email as string | undefined,
  };
}

/** Routes /auth/*; returns null when the path is not an auth route. */
export async function handleAuth(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const cfg = config(env);

  if (url.pathname === '/auth/logout') {
    return new Response(null, {
      status: 302,
      headers: { location: '/', 'set-cookie': cookie(SESSION_COOKIE, '', 0) },
    });
  }

  if (url.pathname === '/auth/login') {
    if (!cfg) return new Response('login is not configured', { status: 503 });
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const next = url.searchParams.get('next') ?? '/';
    const redirectUri = new URL('/auth/callback', url).toString();

    const authorize = new URL(`${cfg.issuer}/oauth2/auth`);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', cfg.clientId);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('scope', 'openid profile email offline_access');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');

    const packed = JSON.stringify({ state, verifier, next });
    return new Response(null, {
      status: 302,
      headers: {
        location: authorize.toString(),
        'set-cookie': cookie(STATE_COOKIE, await sign(env, packed), 600),
      },
    });
  }

  if (url.pathname === '/auth/callback') {
    if (!cfg) return new Response('login is not configured', { status: 503 });
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const packed = await unsign(env, readCookie(request, STATE_COOKIE));
    if (!code || !state || !packed) return new Response('bad login state', { status: 400 });
    const saved = JSON.parse(packed) as { state: string; verifier: string; next: string };
    if (saved.state !== state) return new Response('state mismatch', { status: 400 });

    const redirectUri = new URL('/auth/callback', url).toString();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: cfg.clientId,
      code_verifier: saved.verifier,
    });
    const tokenResponse = await fetch(`${cfg.issuer}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!tokenResponse.ok) {
      return new Response(`token exchange failed: ${await tokenResponse.text()}`, { status: 502 });
    }
    const tokens = (await tokenResponse.json()) as { id_token?: string; access_token?: string };
    if (!tokens.id_token) return new Response('no id_token', { status: 502 });

    const user = await verifyIdToken(tokens.id_token, env, cfg.issuer, cfg.clientId);
    const session = await sign(
      env,
      JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL }),
    );
    const headers = new Headers({ location: saved.next || '/' });
    headers.append('set-cookie', cookie(SESSION_COOKIE, session, SESSION_TTL));
    headers.append('set-cookie', cookie(STATE_COOKIE, '', 0));
    return new Response(null, { status: 302, headers });
  }

  return null;
}
