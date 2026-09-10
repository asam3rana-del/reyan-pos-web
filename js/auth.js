// ================================================================
// auth.js
//
// Web-side staff login. This is a SEPARATE gate from Firebase Anonymous
// Auth (firebase-init.js's ensureSignedIn()) — anon auth just proves this
// browser belongs to the branch (via branch_members/{uid}), the same way
// a Device ID grants an Android phone access. This screen is the second,
// staff-level gate on top of that, matching Android's LoginActivity.kt /
// username+password Room login.
//
// IMPORTANT DIFFERENCE FROM ANDROID (documented, not hidden):
// Android's PasswordHasher-hashed passwordHash is deliberately EXCLUDED
// from Firestore sync (see SyncQueueHelper.userJson()'s comment) so a
// phone's password never leaves the phone. This web app cannot see or
// check against that value. Instead each `users` document gets its own
// separate `webPasswordHash` field, set only from the browser, in the
// SAME "pbkdf2$<saltHex>$<hashHex>" format as Android's PasswordHasher.kt
// (120,000 rounds, HMAC-SHA256, 256-bit key) purely for consistency — the
// two hashes are never compared against each other. Practically: a
// username/displayName/role created via the Android app's User Management
// screen works here too, but the FIRST time that person logs in on the
// web they set a fresh web-only password for themselves (no way to check
// it against their Android password, since that never leaves the phone).
// Android pushes `users` docs with SetOptions.merge() (see SyncApi.kt), so
// this extra field survives future edits made from the Android side.
// ================================================================

const SESSION_KEY = "web_session"; // { username, displayName, role }

// ---------- PBKDF2 (Web Crypto SubtleCrypto — no external library needed) ----------

const ITERATIONS = 120000;
const KEY_LENGTH_BITS = 256;
const PREFIX = "pbkdf2$";

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}

async function pbkdf2(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  return await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial, KEY_LENGTH_BITS
  );
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return PREFIX + toHex(salt) + "$" + toHex(hash);
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith(PREFIX)) return false;
  const parts = stored.slice(PREFIX.length).split("$");
  if (parts.length !== 2) return false;
  const salt = fromHex(parts[0]);
  const expectedHex = parts[1];
  const actualHex = toHex(await pbkdf2(password, salt));
  // constant-time-ish compare
  if (actualHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

// ---------- Session (mirrors Android's SharedPreferences("session") — persists across reloads until Logout) ----------

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession({ username, displayName, role }) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ username, displayName, role }));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
