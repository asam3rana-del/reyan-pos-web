// ================================================================
// login.js
//
// Staff login screen. Runs AFTER Firebase anonymous sign-in + branch access
// is already established (see app.js) — this is the second, staff-level
// gate, same relationship Android has between its Device ID access and its
// own username+password LoginActivity. See auth.js's file header for why
// passwords are web-only (not shared with Android's passwordHash).
//
// Three sub-views inside #screen-login, shown/hidden as needed:
//   #loginCreateAdmin — only when this branch has ZERO `users` docs yet
//                        (fresh branch, or one only ever used via Android
//                        before any User Management account existed).
//   #loginNormal       — the everyday username+password form.
//   #loginClaim        — shown when the typed username matches a real
//                        Android-created user (User Management) who has
//                        never set a web password before.
// ================================================================

import { fetchUsersOnce, findUserByUsername, createWebUser, setUserWebPassword, startUserListener } from "./data.js";
import { hashPassword, verifyPassword, setSession } from "./auth.js";
import { showToast } from "./ui.js";

function el(id) { return document.getElementById(id); }

let pendingClaimUser = null; // the matched no-password-yet user, while #loginClaim is showing

function showMode(mode) {
  el("loginCreateAdmin").classList.toggle("hidden", mode !== "createAdmin");
  el("loginNormal").classList.toggle("hidden", mode !== "normal");
  el("loginClaim").classList.toggle("hidden", mode !== "claim");
}

export async function initLoginScreen(onLoggedIn) {
  el("loginError").classList.add("hidden");
  startUserListener(); // keep the cache warm for the rest of the app post-login

  const existingUsers = await fetchUsersOnce();
  showMode(existingUsers.length === 0 ? "createAdmin" : "normal");

  // ---------- Create Admin Account (first-ever web/branch login) ----------
  el("btnCreateAdmin").onclick = async () => {
    const displayName = el("createAdminDisplayName").value.trim();
    const username = el("createAdminUsername").value.trim();
    const pw = el("createAdminPassword").value;
    const pw2 = el("createAdminPasswordConfirm").value;
    const err = el("loginError");
    err.classList.add("hidden");

    if (!username || !displayName) { showLoginError("Naam aur username zaroori hain."); return; }
    if (pw.length < 4) { showLoginError("Password kam az kam 4 characters ka ho."); return; }
    if (pw !== pw2) { showLoginError("Dono password match nahi ho rahe."); return; }

    el("btnCreateAdmin").disabled = true;
    try {
      const webPasswordHash = await hashPassword(pw);
      await createWebUser({ username, displayName, role: "admin", webPasswordHash });
      setSession({ username, displayName, role: "admin" });
      showToast("Admin account ban gaya — welcome!");
      onLoggedIn();
    } catch (e) {
      showLoginError("Account nahi ban saka: " + e.message);
    } finally {
      el("btnCreateAdmin").disabled = false;
    }
  };

  // ---------- Normal login ----------
  el("btnLogin").onclick = async () => {
    const username = el("loginUsername").value.trim();
    const pw = el("loginPassword").value;
    if (!username || !pw) { showLoginError("Username aur password dalein."); return; }

    el("btnLogin").disabled = true;
    try {
      // Re-fetch fresh (not just the maybe-stale listener cache) so a user created
      // moments ago on another device/tab is found immediately.
      const fresh = await fetchUsersOnce();
      const user = fresh.find(u => (u.username || "").trim().toLowerCase() === username.toLowerCase());

      if (!user) { showLoginError("Ye username nahi mila. Android app ke User Management se pehle add karwayein."); return; }
      if (user.active === false) { showLoginError("Ye account disable hai — admin se raabta karein."); return; }

      if (!user.webPasswordHash) {
        // Android-created account, never logged into the web before — claim flow.
        pendingClaimUser = user;
        el("claimDisplayName").textContent = user.displayName || user.username;
        el("claimRole").textContent = user.role || "cashier";
        el("claimPassword").value = "";
        el("claimPasswordConfirm").value = "";
        showMode("claim");
        el("loginError").classList.add("hidden");
        return;
      }

      const ok = await verifyPassword(pw, user.webPasswordHash);
      if (!ok) { showLoginError("Password ghalat hai."); return; }

      setSession({ username: user.username, displayName: user.displayName, role: user.role });
      onLoggedIn();
    } catch (e) {
      showLoginError("Login nahi ho saka: " + e.message);
    } finally {
      el("btnLogin").disabled = false;
    }
  };

  // ---------- Claim / first-time web password ----------
  el("btnClaimSetPassword").onclick = async () => {
    if (!pendingClaimUser) return;
    const pw = el("claimPassword").value;
    const pw2 = el("claimPasswordConfirm").value;
    if (pw.length < 4) { showLoginError("Password kam az kam 4 characters ka ho."); return; }
    if (pw !== pw2) { showLoginError("Dono password match nahi ho rahe."); return; }

    el("btnClaimSetPassword").disabled = true;
    try {
      const webPasswordHash = await hashPassword(pw);
      await setUserWebPassword(pendingClaimUser.id, webPasswordHash);
      setSession({ username: pendingClaimUser.username, displayName: pendingClaimUser.displayName, role: pendingClaimUser.role });
      showToast("Web password set ho gaya — welcome!");
      onLoggedIn();
    } catch (e) {
      showLoginError("Password set nahi ho saka: " + e.message);
    } finally {
      el("btnClaimSetPassword").disabled = false;
    }
  };

  el("btnClaimBack").onclick = () => {
    pendingClaimUser = null;
    showMode("normal");
    el("loginError").classList.add("hidden");
  };
}

function showLoginError(msg) {
  const err = el("loginError");
  err.textContent = msg;
  err.classList.remove("hidden");
}
