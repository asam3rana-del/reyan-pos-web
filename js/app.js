import { isConfigured, ensureSignedIn, branchId } from "./firebase-init.js";
import { startProductListener, startCustomerListener, startSupplierListener } from "./data.js";
import { initSetupScreen } from "./setup.js";
import { getShopInfo, saveShopInfo } from "./shop.js";
import { getSession, clearSession } from "./auth.js";
import { initLoginScreen } from "./login.js";
import { refreshDashboard, initDashboard } from "./dashboard.js";
import { initSaleScreen, focusQuickSale, refreshSaleCustomerList } from "./sale.js";
import { initPurchaseScreen, refreshPurchaseSupplierList } from "./purchase.js";
import { initPartiesScreen, refreshPartiesList } from "./parties.js";
import { initReportsScreens, renderDayBook, renderStock, renderPnl, renderBalanceSheet } from "./reports.js";
import { initCashScreen, refreshCashScreen } from "./cash.js";
import { initExpensesScreen, refreshExpensesScreen } from "./expenses.js";
import { showToast } from "./ui.js";

function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById("screen-" + name).classList.remove("hidden");
  // Scoped to #mainNav so this doesn't also strip the "active" class off the
  // Customers/Suppliers tab toggle inside the Parties screen (parties.js owns
  // that highlighting itself, same "nav-btn" class, different nav group).
  document.querySelectorAll("#mainNav .nav-btn").forEach(b => b.classList.remove("active"));
  const activeBtn = document.querySelector(`#mainNav .nav-btn[data-screen="${name}"]`);
  if (activeBtn) activeBtn.classList.add("active");

  if (name === "dashboard") refreshDashboard();
  if (name === "dayBook") renderDayBook(document.getElementById("dayBookDate").value);
  if (name === "stock") renderStock();
  if (name === "parties") refreshPartiesList();
  if (name === "cash") refreshCashScreen();
  if (name === "expenses") refreshExpensesScreen();
  if (name === "reports") {
    // Refresh whichever sub-tab (P&L / Balance Sheet) is currently active.
    const bsActive = document.getElementById("tabBalanceSheet")?.classList.contains("active");
    if (bsActive) renderBalanceSheet(); else renderPnl();
  }
}

function wireNav() {
  document.querySelectorAll("[data-screen]").forEach(elm => {
    elm.addEventListener("click", () => showScreen(elm.dataset.screen));
  });
}

// Independent of the Setup screen's "Connect" flow (which re-runs the whole
// Firebase connect + sign-in sequence) — this only saves the receipt-header
// text, so it's safe to wire once, always, and re-use on repeat visits to
// Setup after login (e.g. an admin updating the shop's printed address).
function wireShopInfoOnlySave() {
  const el = (id) => document.getElementById(id);
  const shop = getShopInfo();
  el("cfgShopName").value = shop.name || "";
  el("cfgShopPhone").value = shop.phone || "";
  el("cfgShopAddress").value = shop.address || "";

  el("btnSaveShopInfo").addEventListener("click", () => {
    saveShopInfo({
      name: el("cfgShopName").value,
      phone: el("cfgShopPhone").value,
      address: el("cfgShopAddress").value
    });
    showToast("Shop info save ho gayi");
  });
}

async function boot() {
  wireNav();
  initReportsScreens();
  wireShopInfoOnlySave();

  if (!isConfigured()) {
    initSetupScreen(startApp);
    showScreen("setup");
    return;
  }
  await startApp();
}

// Runs once we have (or just got) a valid cloud config: signs in anonymously
// (branch/device-level access, same role as Android's Device ID), then hands
// off to the staff login gate before the real app screens are wired up.
async function startApp() {
  try {
    await ensureSignedIn();
  } catch (e) {
    console.error("Sign-in failed", e);
  }

  const session = getSession();
  if (session) {
    enterApp(session);
    return;
  }

  await initLoginScreen(() => enterApp(getSession()));
  showScreen("login");
}

// Runs exactly once per successful login — wires up every real screen and
// starts the Firestore listeners. Logout reloads the page instead of trying
// to unwind all of this, which keeps it simple and avoids double-binding the
// same buttons if a session ever churns mid-session.
function enterApp(session) {
  document.getElementById("appHeader").classList.remove("hidden");
  document.getElementById("branchLabel").textContent = "Branch: " + branchId();

  document.getElementById("userBadge").classList.remove("hidden");
  document.getElementById("userBadgeText").textContent = `👤 ${session.displayName} (${session.role})`;
  // Setup (Firebase project/branch + shop info) is sensitive enough to keep
  // admin-only, same gating Android applies to its User Management screen.
  document.getElementById("navSetupBtn").classList.toggle("hidden", session.role !== "admin");
  document.getElementById("btnLogout").addEventListener("click", () => {
    clearSession();
    location.reload();
  });

  startProductListener(() => { /* products cache refreshes automatically */ });
  startCustomerListener(() => { refreshSaleCustomerList(); refreshPartiesList(); });
  startSupplierListener(() => { refreshPurchaseSupplierList(); refreshPartiesList(); });

  initSaleScreen();
  initPurchaseScreen();
  initPartiesScreen();
  initCashScreen();
  initExpensesScreen();
  initDashboard({ onQuickSale: () => { showScreen("sale"); focusQuickSale(); } });

  showScreen("dashboard");
}

boot();
