// ================================================================
// appSettings.js — the Setup screen's "Shop / App Settings" card. Thin UI
// layer over data.js's startAppSettingsListener()/saveAppSetting(), which
// already mirror Android's SettingsActivity.kt whitelisted keys
// (SYNCED_APP_SETTING_KEYS). No delete/list here, same as Android's own
// Settings screen — just one form that upserts whichever keys changed.
// ================================================================

import { appSettings, startAppSettingsListener, saveAppSetting } from "./data.js";
import { showToast } from "./ui.js";

function el(id) { return document.getElementById(id); }

function fillForm() {
  el("appSetShopName").value = appSettings.shop_name || "";
  el("appSetShopPhone").value = appSettings.shop_phone || "";
  el("appSetShopAddress").value = appSettings.shop_address || "";
  el("appSetReceiptFooter").value = appSettings.receipt_footer || "";
  el("appSetCurrency").value = appSettings.currency || "Rs";
  el("appSetTaxPercent").value = appSettings.tax_percent || "";
}

export function initAppSettingsScreen() {
  startAppSettingsListener(fillForm);

  el("btnSaveAppSettings").addEventListener("click", async () => {
    const fields = {
      shop_name: el("appSetShopName").value.trim(),
      shop_phone: el("appSetShopPhone").value.trim(),
      shop_address: el("appSetShopAddress").value.trim(),
      receipt_footer: el("appSetReceiptFooter").value.trim(),
      currency: el("appSetCurrency").value,
      tax_percent: el("appSetTaxPercent").value || "0"
    };

    const btn = el("btnSaveAppSettings");
    btn.disabled = true;
    try {
      // Only push keys that actually changed — avoids rewriting every key
      // (and re-triggering the Firestore listener six times) on every save.
      for (const [key, value] of Object.entries(fields)) {
        if ((appSettings[key] || "") !== String(value)) {
          await saveAppSetting(key, value);
        }
      }
      showToast("Settings save ho gayi");
    } catch (e) {
      showToast("Error: " + e.message);
    } finally {
      btn.disabled = false;
    }
  });
}
