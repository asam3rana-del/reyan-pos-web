// ================================================================
// appLock.js — device-local PIN lock, the web equivalent of Android's
// AppLock.kt (Settings > Security > Fingerprint/Both re-locking on resume).
// No fingerprint API here, so it's PIN-only, but the shape is the same:
// leaving the app and coming back re-shows a lock screen if enabled.
//
// Storage: localStorage only (device-local), same as Android's
// SharedPreferences("app_prefs")/("app_lock_state") — deliberately NOT
// synced via Firestore, since a PIN is a per-device thing, not a
// branch-wide setting.
//   applock_enabled   -> "1" | absent
//   applock_pin_hash  -> pbkdf2$<salt>$<hash>, same format auth.js uses
//
// Re-lock trigger: Android arms itself when the whole app (not just one
// Activity) leaves the foreground (startedCount hits 0). The closest web
// equivalent is the Page Visibility API — `visibilitychange` firing hidden
// covers switching tabs/apps, minimizing, and turning the screen off.
// ================================================================

import { hashPassword, verifyPassword, clearSession } from "./auth.js";
import { showToast } from "./ui.js";

const KEY_ENABLED = "applock_enabled";
const KEY_PIN_HASH = "applock_pin_hash";

function isEnabled() {
  try { return localStorage.getItem(KEY_ENABLED) === "1"; } catch { return false; }
}

function getPinHash() {
  try { return localStorage.getItem(KEY_PIN_HASH); } catch { return null; }
}

function el(id) { return document.getElementById(id); }

// ---------------------------------------------------------------
// Settings screen (Settings > 🔒 App Lock)
// ---------------------------------------------------------------

function refreshSettingsView() {
  const on = isEnabled();
  el("appLockStatusOff").classList.toggle("hidden", on);
  el("appLockStatusOn").classList.toggle("hidden", !on);
}

function showSettingsMsg(msg, isError = true) {
  const p = el("appLockSettingsMsg");
  p.textContent = msg;
  p.style.color = isError ? "var(--red)" : "var(--teal-fg)";
  p.classList.remove("hidden");
}

function validPin(pin) {
  return /^[0-9]{4,6}$/.test(pin);
}

export function initAppLockSettingsScreen() {
  refreshSettingsView();

  el("btnAppLockEnable").addEventListener("click", async () => {
    const pin = el("appLockNewPin").value;
    const pin2 = el("appLockNewPinConfirm").value;
    if (!validPin(pin)) { showSettingsMsg("PIN 4-6 digits ka hona chahiye."); return; }
    if (pin !== pin2) { showSettingsMsg("Dono PIN match nahi ho rahe."); return; }

    const hash = await hashPassword(pin);
    localStorage.setItem(KEY_PIN_HASH, hash);
    localStorage.setItem(KEY_ENABLED, "1");
    el("appLockNewPin").value = "";
    el("appLockNewPinConfirm").value = "";
    refreshSettingsView();
    showToast("App Lock on ho gaya");
  });

  el("btnAppLockChange").addEventListener("click", async () => {
    const pin = el("appLockChangePin").value;
    const pin2 = el("appLockChangePinConfirm").value;
    if (!validPin(pin)) { showSettingsMsg("PIN 4-6 digits ka hona chahiye."); return; }
    if (pin !== pin2) { showSettingsMsg("Dono PIN match nahi ho rahe."); return; }

    const hash = await hashPassword(pin);
    localStorage.setItem(KEY_PIN_HASH, hash);
    el("appLockChangePin").value = "";
    el("appLockChangePinConfirm").value = "";
    showToast("PIN update ho gaya");
  });

  el("btnAppLockDisable").addEventListener("click", () => {
    localStorage.removeItem(KEY_ENABLED);
    localStorage.removeItem(KEY_PIN_HASH);
    refreshSettingsView();
    showToast("App Lock off kar diya");
  });
}

// ---------------------------------------------------------------
// The lock overlay itself
// ---------------------------------------------------------------

let overlayWired = false;
let wasHidden = false; // tracks whether the tab was ever hidden this session

function showLockOverlay() {
  el("appLockPinInput").value = "";
  el("appLockError").textContent = "";
  el("appLockOverlay").classList.remove("hidden");
  setTimeout(() => el("appLockPinInput").focus(), 50);
}

function hideLockOverlay() {
  el("appLockOverlay").classList.add("hidden");
}

async function attemptUnlock() {
  const pin = el("appLockPinInput").value;
  const hash = getPinHash();
  const ok = await verifyPassword(pin, hash);
  if (ok) {
    hideLockOverlay();
  } else {
    el("appLockError").textContent = "PIN ghalat hai.";
    el("appLockPinInput").value = "";
    el("appLockPinInput").focus();
  }
}

function wireOverlayOnce() {
  if (overlayWired) return;
  overlayWired = true;

  el("btnAppLockUnlock").addEventListener("click", attemptUnlock);
  el("appLockPinInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") attemptUnlock();
  });
  el("btnAppLockForgot").addEventListener("click", () => {
    // Same "start over" escape hatch as forgetting your staff password —
    // logs out entirely rather than trying to recover the PIN itself.
    clearSession();
    location.reload();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      wasHidden = true;
    } else if (wasHidden && isEnabled() && getPinHash()) {
      showLockOverlay();
    }
  });
}

/**
 * Call once, right after a successful login (enterApp). If a PIN is already
 * set, shows the lock immediately (covers reloading the page/reopening the
 * installed PWA with a saved session — same as Android re-locking a
 * process restored after a background-kill).
 */
export function initAppLockGuard() {
  wireOverlayOnce();
  if (isEnabled() && getPinHash()) {
    showLockOverlay();
  }
}
