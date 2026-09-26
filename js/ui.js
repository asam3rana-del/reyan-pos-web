let toastTimer = null;

export function showToast(message) {
  const t = document.getElementById("toast");
  t.textContent = message;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3000);
}

// ================================================================
// Generic modal — used by Party Reports/Dashboard/Item Search for report
// popups, action-sheets and edit-rate dialogs (this app had no modal system
// before; every screen was a full page toggled by showScreen()).
// ================================================================
let modalWired = false;

function wireModalOnce() {
  if (modalWired) return;
  modalWired = true;
  const overlay = document.getElementById("modalOverlay");
  document.getElementById("modalClose").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
}

export function showModal(title, bodyHtml) {
  wireModalOnce();
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = bodyHtml;
  document.getElementById("modalOverlay").classList.remove("hidden");
  return document.getElementById("modalBody");
}

export function closeModal() {
  document.getElementById("modalOverlay").classList.add("hidden");
}
