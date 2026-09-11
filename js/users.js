// ================================================================
// users.js — the README's "❌ Web se naye staff users banane ka UI" gap.
//
// Lives inside the Setup screen (admin-only — see index.html's
// #setupStaffUsersCard and app.js's role gating). Mirrors Android's
// UserManagementActivity.kt: add a user (username/displayName/phone/role),
// list all users with role/active badges, Deactivate/Activate, Delete, and
// Reset (web) Password — with the same "never let an admin lock themselves
// out" guard Android uses (no Deactivate/Delete button on your own row).
//
// KEY DIFFERENCE FROM ANDROID (documented in the UI copy too): Android's
// User Management sets a password immediately, because that password IS the
// Android-local login check. This screen can't do that — a web-only
// webPasswordHash never reaches Android and vice versa (see auth.js's file
// header) — so a user created here has no password yet, and sets their own
// on first web login via the existing "claim" flow (login.js).
// ================================================================

import { users, createWebUser, setUserActive, deleteWebUser, setUserWebPassword } from "./data.js";
import { hashPassword } from "./auth.js";
import { getSession } from "./auth.js";
import { showToast } from "./ui.js";

function el(id) { return document.getElementById(id); }

const ROLE_LABELS = { admin: "Admin", manager: "Manager", cashier: "Cashier" };

function usernameTaken(username) {
  const n = username.trim().toLowerCase();
  return users.some(u => (u.username || "").trim().toLowerCase() === n);
}

function showFormError(msg) {
  const err = el("staffUserError");
  err.textContent = msg;
  err.classList.remove("hidden");
}

export function initStaffUsersScreen() {
  el("btnAddStaffUser").addEventListener("click", async () => {
    const displayName = el("staffDisplayName").value.trim();
    const username = el("staffUsername").value.trim();
    const phone = el("staffPhone").value.trim();
    const role = el("staffRole").value;
    el("staffUserError").classList.add("hidden");

    if (!displayName || !username) { showFormError("Naam aur username zaroori hain."); return; }
    if (!/^[A-Za-z0-9_.-]{2,40}$/.test(username)) { showFormError("Username sirf letters/numbers/_/./- (2-40 characters)."); return; }
    if (usernameTaken(username)) { showFormError("Ye username pehle se mojood hai."); return; }

    el("btnAddStaffUser").disabled = true;
    try {
      await createWebUser({ username, displayName, phone, role });
      showToast(`${displayName} add ho gaye — pehli login par khud password set karenge.`);
      el("staffDisplayName").value = "";
      el("staffUsername").value = "";
      el("staffPhone").value = "";
      el("staffRole").value = "cashier";
      renderStaffUsersList();
    } catch (e) {
      showFormError("Add nahi ho saka: " + e.message);
    } finally {
      el("btnAddStaffUser").disabled = false;
    }
  });

  renderStaffUsersList();
}

export function renderStaffUsersList() {
  const box = el("staffUsersList");
  if (!box) return; // guards against older index.html without this card

  const session = getSession();
  const myUsername = session ? session.username : null;

  box.innerHTML = "";
  if (!users.length) { box.innerHTML = "<p class='muted'>Koi user nahi hai.</p>"; return; }

  users
    .slice()
    .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""))
    .forEach(u => {
      const isSelf = u.username === myUsername;
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
        <div class="row-between">
          <div>
            <div><b>${u.displayName}</b> · ${u.username}</div>
            ${u.phone ? `<div class="muted">${u.phone}</div>` : ""}
            ${!u.webPasswordHash ? `<div class="muted">Web password abhi set nahi — pehli login par khud karega</div>` : ""}
          </div>
          <div style="text-align:right; white-space:nowrap;">
            <span class="role-badge role-${u.role}">${ROLE_LABELS[u.role] || u.role}</span>
            <span class="role-badge ${u.active ? "role-active" : "role-inactive"}">${u.active ? "Active" : "Inactive"}</span>
          </div>
        </div>
        <div class="history-actions">
          <span class="party-edit" data-action="reset">🔑 Reset Password</span>
          ${!isSelf ? `<span class="party-edit" data-action="toggle">${u.active ? "Deactivate" : "Activate"}</span>` : ""}
          ${!isSelf ? `<span class="party-delete" data-action="delete">✕ Delete</span>` : ""}
        </div>
      `;

      div.querySelector('[data-action="reset"]').addEventListener("click", async () => {
        const pw = prompt(`${u.displayName} (${u.username}) ke liye naya web password (kam az kam 4 characters):`);
        if (pw === null) return;
        if (pw.length < 4) { showToast("Password kam az kam 4 characters ka ho."); return; }
        try {
          const webPasswordHash = await hashPassword(pw);
          await setUserWebPassword(u.id, webPasswordHash);
          showToast("Password reset ho gaya");
          renderStaffUsersList();
        } catch (e) {
          showToast("Reset nahi ho saka: " + e.message);
        }
      });

      const toggleBtn = div.querySelector('[data-action="toggle"]');
      if (toggleBtn) {
        toggleBtn.addEventListener("click", async () => {
          const turningOff = u.active;
          if (!confirm(`${u.displayName} ko ${turningOff ? "deactivate" : "activate"} kar dein?`)) return;
          try {
            await setUserActive(u.id, !u.active);
            showToast(turningOff ? "User deactivate ho gaya" : "User activate ho gaya");
            renderStaffUsersList();
          } catch (e) {
            showToast("Nahi ho saka: " + e.message);
          }
        });
      }

      const deleteBtn = div.querySelector('[data-action="delete"]');
      if (deleteBtn) {
        deleteBtn.addEventListener("click", async () => {
          if (!confirm(`${u.displayName} (${u.username}) ko delete karna hai?`)) return;
          try {
            await deleteWebUser(u.id);
            showToast("User delete ho gaya");
            renderStaffUsersList();
          } catch (e) {
            showToast("Delete nahi ho saka: " + e.message);
          }
        });
      }

      box.appendChild(div);
    });
}
