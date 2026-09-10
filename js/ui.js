let toastTimer = null;

export function showToast(message) {
  const t = document.getElementById("toast");
  t.textContent = message;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3000);
}
