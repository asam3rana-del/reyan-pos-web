import { isConfigured, ensureSignedIn, branchId } from "./firebase-init.js";
import {
  startProductListener, startCustomerListener, startSupplierListener, startUserListener,
  startCategoryListener, startUnitListener
} from "./data.js";
import { initSetupScreen } from "./setup.js";
import { getShopInfo, saveShopInfo } from "./shop.js";
import { getSession, clearSession } from "./auth.js";
import { initLoginScreen } from "./login.js";
import { refreshDashboard, initDashboard } from "./dashboard.js";
import { initSaleScreen, focusQuickSale, refreshSaleCustomerList } from "./sale.js";
import { initSaleHistoryScreen, renderSaleHistory } from "./saleHistory.js";
import { initPurchaseScreen, refreshPurchaseSupplierList, enterPurchaseEditMode } from "./purchase.js";
import { initPurchaseHistoryScreen, renderPurchaseHistory } from "./purchaseHistory.js";
import { initProductsScreen, refreshProductsScreen } from "./products.js";
import { initPartiesScreen, refreshPartiesList } from "./parties.js";
import { initPartyReportsScreen, renderPartyReportsList } from "./partyReports.js";
import { initReportsScreens, renderDayBook, renderPnl, renderBalanceSheet } from "./reports.js";
import { initStockScreens, renderStockScreen } from "./stock.js";
import { initCashScreen, refreshCashScreen } from "./cash.js";
import { initCashRegisterScreen, refreshCashRegisterScreen } from "./cashRegister.js";
import { initShellLedgerScreen, refreshShellLedgerScreen } from "./shellLedger.js";
import { initAppSettingsScreen } from "./appSettings.js";
import { initExpensesScreen, refreshExpensesScreen } from "./expenses.js";
import { initStaffUsersScreen, renderStaffUsersList } from "./users.js";
import { initRemindersScreen, renderReminders } from "./reminders.js";
import { initPaymentsReportScreen, renderPaymentsReport } from "./paymentsReport.js";
import { initZakatScreen, renderZakatScreen } from "./zakat.js";
import { initAuditLogScreen, renderAuditLog } from "./auditLog.js";
import { showToast } from "./ui.js";

// ---------- Role-based screen access (mirrors the Android app's Phase 4
// per-Activity role checks — see PurchaseActivity.kt/ReportsActivity.kt/etc:
// MainActivity there only HIDES a tile for the wrong role, each Activity's
// own onCreate() also refuses to open for the wrong role, so hiding a nav
// button here isn't the only gate either. Screens not listed are open to
// every logged-in role (New Sale, Day Book, Stock, Parties, Cash, Expenses —
// same as Android). ----------
const SCREEN_ACCESS = {
  purchase: ["admin"],          // PurchaseActivity.kt: admin only
  purchaseHistory: ["admin"],   // same screen family as Purchase above
  reports: ["admin", "manager"],// ReportsActivity.kt/BalanceSheetActivity.kt
  paymentsReport: ["admin", "manager"], // PaymentsReportActivity.kt — same financial-visibility gate as Reports
  zakat: ["admin", "manager"],  // ZakatActivity.kt — same financial-visibility gate as Reports
  auditLog: ["admin", "manager"], // combined cross-device activity trail — same financial-visibility gate as Reports
  setup: ["admin"]              // Firebase project/branch + shop info
};

let currentRole = null; // set once in enterApp(); null before login (setup/login screens stay open pre-login)

function roleAllowed(screenName) {
  if (!currentRole) return true; // no session yet — pre-login setup/login flow
  const allowed = SCREEN_ACCESS[screenName];
  return !allowed || allowed.includes(currentRole);
}

function roleAccessMessage(screenName) {
  const allowed = SCREEN_ACCESS[screenName] || [];
  return allowed.length === 1
    ? "Sirf Admin is screen ko access kar sakte hain"
    : "Sirf Admin/Manager is screen ko access kar sakte hain";
}

export function showScreen(name) {
  if (!roleAllowed(name)) {
    showToast(roleAccessMessage(name));
    return;
  }

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
  if (name === "purchaseHistory") renderPurchaseHistory();
  if (name === "saleHistory") renderSaleHistory();
  if (name === "products") refreshProductsScreen();
  if (name === "stock") renderStockScreen();
  if (name === "parties") refreshPartiesList();
  if (name === "partyReports") renderPartyReportsList();
  if (name === "cash") refreshCashScreen();
  if (name === "cashRegister") refreshCashRegisterScreen();
  if (name === "shellLedger") refreshShellLedgerScreen();
  if (name === "expenses") refreshExpensesScreen();
  if (name === "reminders") renderReminders();
  if (name === "paymentsReport") renderPaymentsReport();
  if (name === "zakat") renderZakatScreen();
  if (name === "auditLog") renderAuditLog();
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
  window.__appBooted = true; // tells index.html's diagnostic banner the module graph loaded
  wireNav();
  initReportsScreens();
  initStockScreens();
  initRemindersScreen();
  initPaymentsReportScreen();
  initZakatScreen();
  initAuditLogScreen();
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
  currentRole = session.role;

  document.getElementById("appHeader").classList.remove("hidden");
  document.getElementById("branchLabel").textContent = "Branch: " + branchId();

  document.getElementById("userBadge").classList.remove("hidden");
  document.getElementById("userBadgeText").textContent = `👤 ${session.displayName} (${session.role})`;
  // Setup (Firebase project/branch + shop info) is sensitive enough to keep
  // admin-only, same gating Android applies to its User Management screen.
  document.getElementById("navSetupBtn").classList.toggle("hidden", session.role !== "admin");
  // Purchase/Purchase History: admin-only, matching PurchaseActivity.kt.
  document.querySelector('#mainNav .nav-btn[data-screen="purchase"]').classList.toggle("hidden", session.role !== "admin");
  document.querySelector('#mainNav .nav-btn[data-screen="purchaseHistory"]').classList.toggle("hidden", session.role !== "admin");
  // Reports (P&L + Balance Sheet): admin or manager, matching ReportsActivity.kt/BalanceSheetActivity.kt.
  document.querySelector('#mainNav .nav-btn[data-screen="reports"]').classList.toggle("hidden", !(session.role === "admin" || session.role === "manager"));
  // Zakat: admin or manager, matching ZakatActivity.kt's own role check.
  document.getElementById("navZakatBtn").classList.toggle("hidden", !(session.role === "admin" || session.role === "manager"));
  // Audit Log: admin or manager, same financial-visibility gate as Reports/Zakat.
  document.getElementById("navAuditLogBtn").classList.toggle("hidden", !(session.role === "admin" || session.role === "manager"));
  // Today's Profit: admin-only stat, matching MainActivity.kt's dashboard (cashier/manager only see Today's Sale).
  document.getElementById("statTodayProfitCard").classList.toggle("hidden", session.role !== "admin");
  // Dashboard financial-visibility cleanup: cashier only sees Today's Sale, Low
  // Stock and Shell-Owed (if >0) on the dashboard, same gate as Reports/Zakat —
  // Register status, Overdue Dues and Recent Activity are admin/manager only.
  const financialOnly = session.role === "admin" || session.role === "manager";
  document.getElementById("statRegisterCard").classList.toggle("hidden", !financialOnly);
  document.getElementById("recentActivitySection").classList.toggle("hidden", !financialOnly);
  // statOverdueCard itself is left alone here — it starts hidden in the HTML
  // and dashboard.js only ever fetches/reveals it for admin/manager (passed
  // in below via initDashboard's `role`), so a cashier session never turns it on.
  // Staff Users card (inside Setup): admin-only, matching UserManagementActivity.kt.
  document.getElementById("setupStaffUsersCard").classList.toggle("hidden", session.role !== "admin");
  document.getElementById("btnLogout").addEventListener("click", () => {
    clearSession();
    location.reload();
  });

  startProductListener(() => { refreshProductsScreen(); });
  startCustomerListener(() => { refreshSaleCustomerList(); refreshPartiesList(); });
  startSupplierListener(() => { refreshPurchaseSupplierList(); refreshPartiesList(); });
  startUserListener(() => { renderStaffUsersList(); });
  startCategoryListener(() => { refreshProductsScreen(); });
  startUnitListener(() => { refreshProductsScreen(); });

  initSaleScreen();
  initSaleHistoryScreen();
  initPurchaseScreen();
  initPurchaseHistoryScreen({
    onEdit: (purchase, supplierName) => {
      enterPurchaseEditMode(purchase, supplierName);
      showScreen("purchase");
    }
  });
  initProductsScreen();
  initPartiesScreen();
  initPartyReportsScreen();
  initCashScreen();
  initCashRegisterScreen();
  initShellLedgerScreen();
  initExpensesScreen();
  if (session.role === "admin") { initStaffUsersScreen(); initAppSettingsScreen(); }
  initDashboard({ onQuickSale: () => { showScreen("sale"); focusQuickSale(); }, role: session.role });

  showScreen("dashboard");
}

boot();
