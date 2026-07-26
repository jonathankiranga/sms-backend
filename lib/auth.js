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

module.exports = { createToken, verifyToken };