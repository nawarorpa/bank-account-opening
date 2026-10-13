import crypto from 'node:crypto';

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const getConfig = () => ({
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'ChangeMeImmediately123!',
  secret: process.env.ADMIN_SESSION_SECRET || 'change-this-admin-session-secret',
});

const sign = (value, secret) =>
  crypto.createHmac('sha256', secret).update(value).digest('base64url');

const safeEqual = (left, right) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const parseCookies = (header = '') => Object.fromEntries(
  header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=');
      return index === -1
        ? [part, '']
        : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    }),
);

export function authenticateAdminCredentials(username, password) {
  const config = getConfig();
  return safeEqual(username, config.username) && safeEqual(password, config.password);
}

export function createAdminSession(username) {
  const config = getConfig();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${username}.${expiresAt}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload, config.secret)}`;
}

export function verifyAdminSession(token) {
  if (!token) return null;
  const config = getConfig();
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  let payload;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = sign(payload, config.secret);
  if (!safeEqual(signature, expected)) return null;

  const [username, expiresAtRaw] = payload.split('.');
  const expiresAt = Number(expiresAtRaw);
  if (!username || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  return { username, expiresAt };
}

export function setAdminSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = SESSION_TTL_MS;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${Math.floor(maxAge / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
  );
}

export function clearAdminSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
  );
}

export function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifyAdminSession(cookies[COOKIE_NAME]);
  if (!session) {
    return res.status(401).json({ message: 'Administrator authentication required.' });
  }
  req.admin = session;
  next();
}
