const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'default_session_secret_change_me';
const ALGO = 'sha256';

// Stateless token that embeds teacher_id, role and school_id to avoid DB lookups on each request.
// Payload shape: { teacherId, role, school_id, exp }
function createToken(payload, ttlSeconds = 60 * 60 * 4) {
  if (!payload || !payload.teacherId) throw new Error('payload.teacherId required');
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const obj = Object.assign({}, payload, { exp });
  const json = JSON.stringify(obj);
  const b64 = Buffer.from(json).toString('base64');
  const sig = crypto.createHmac(ALGO, SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  try {
    const expected = crypto.createHmac(ALGO, SECRET).update(b64).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (e) { return null; }
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const obj = JSON.parse(json);
    if (!obj.teacherId || !obj.exp) return null;
    if (Math.floor(Date.now() / 1000) > obj.exp) return null;
    // return the embedded payload (teacherId, role, school_id)
    return { teacherId: obj.teacherId, role: obj.role, school_id: obj.school_id, exp: obj.exp };
  } catch (e) { return null; }
}

// Session-based auth — verifies Bearer token from otp_sessions table
async function authenticate(req, res, next) {
  const auth = (req.headers.authorization || '').trim();
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const sessionId = auth.split(' ')[1];
  const [rows] = await req.db.execute(
    'SELECT phone, verified, expires_at FROM otp_sessions WHERE session_id = ?',
    [sessionId]
  );
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
  const sess = rows[0];
  if (!sess.verified || !sess.expires_at || new Date(sess.expires_at) <= new Date()) {
    return res.status(401).json({ error: 'Session expired' });
  }
  req.user = { phone: sess.phone };
  next();
}

module.exports = { createToken, verifyToken, authenticate };