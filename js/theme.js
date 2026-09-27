// ================================================================
// theme.js — Dark/Light mode toggle. Mirrors ThemeManager.kt's LIGHT/DARK
// palettes (see css/style.css's html[data-theme="dark"] block for the exact
// same hex values), but since there's no per-Activity theming to redo here,
// the whole thing is just: set/read one localStorage flag + toggle an
// attribute that the CSS variables key off of.
//
// Device-local by design (like Android's SharedPreferences("app_prefs")) —
// not synced via Firestore, so switching theme on one browser doesn't flip
// it for the whole team.
// ================================================================

const THEME_KEY = "theme"; // "light" | "dark"

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const btn = document.getElementById("btnThemeToggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}

export function initTheme() {
  // index.html's inline head script already applied this pre-paint — this
  // just brings the toggle button's icon in sync with that and wires clicks.
  applyTheme(getStoredTheme());

  document.getElementById("btnThemeToggle").addEventListener("click", () => {
    const next = getStoredTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    applyTheme(next);
  });
}
