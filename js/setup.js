import { getConfig, saveConfig, ensureSignedIn } from "./firebase-init.js";
import { getShopInfo, saveShopInfo } from "./shop.js";

export function initSetupScreen(onConnected) {
  const el = (id) => document.getElementById(id);
  const existing = getConfig();
  if (existing) {
    el("cfgProjectId").value = existing.projectId || "";
    el("cfgApiKey").value = existing.apiKey || "";
    el("cfgAppId").value = existing.appId || "";
    el("cfgStorageBucket").value = existing.storageBucket || "";
    el("cfgBranchId").value = existing.branchId || "";
  }
  const shop = getShopInfo();
  el("cfgShopName").value = shop.name || "";
  el("cfgShopPhone").value = shop.phone || "";
  el("cfgShopAddress").value = shop.address || "";

  el("btnSaveConfig").addEventListener("click", async () => {
    const cfg = {
      projectId: el("cfgProjectId").value,
      apiKey: el("cfgApiKey").value,
      appId: el("cfgAppId").value,
      storageBucket: el("cfgStorageBucket").value,
      branchId: el("cfgBranchId").value
    };
    const err = el("setupError");
    err.classList.add("hidden");

    if (!cfg.projectId || !cfg.apiKey || !cfg.appId) {
      err.textContent = "Project ID, API Key aur App ID zaroori hain.";
      err.classList.remove("hidden");
      return;
    }
    if (!/^[A-Za-z0-9_-]{2,50}$/.test(cfg.branchId.trim())) {
      err.textContent = "Branch Code 2-50 characters, sirf letters/numbers/_/- ho sakta hai.";
      err.classList.remove("hidden");
      return;
    }

    saveConfig(cfg);
    saveShopInfo({
      name: el("cfgShopName").value,
      phone: el("cfgShopPhone").value,
      address: el("cfgShopAddress").value
    });

    // Visible confirmation the click was even received, before we know
    // whether sign-in will succeed or fail — helps tell "nothing happened"
    // apart from "it tried and silently failed" on devices with no console access.
    alert("Connect dabaya gaya — sign-in try ho raha hai...");

    try {
      const uid = await ensureSignedIn();
      el("deviceIdBox").classList.remove("hidden");
      el("deviceIdText").textContent = uid;
      alert("Connected! Device ID: " + uid);
      if (onConnected) {
        try {
          await onConnected();
        } catch (e2) {
          alert("Step 2 error: " + (e2 && e2.message ? e2.message : e2));
        }
      }
    } catch (e) {
      const msg = "Connect nahi ho saka — values dobara check karein. (" + (e && e.message ? e.message : e) + ")";
      err.textContent = msg;
      err.classList.remove("hidden");
      alert(msg);
    }
  });
}
