// ================================================================
// shop.js
//
// Shop Name / Phone / Address for the printed receipt header.
//
// NOTE: Android's shop_name/shop_phone/shop_address (SettingsActivity.kt)
// live in the LOCAL Room app_settings table only — they are not in
// firestore.rules' isSyncedCollection() list, so this web app has no way
// to read them from the cloud. Kept here as a small per-browser setting
// instead (same idea as the Firebase config values in firebase-init.js),
// entered once on the Setup screen. Defaults match Android's own default.
// ================================================================

const LS_KEYS = {
  name: "shop_name",
  phone: "shop_phone",
  address: "shop_address"
};

export function getShopInfo() {
  return {
    name: localStorage.getItem(LS_KEYS.name) || "IBTISAAM Kiryana Store",
    phone: localStorage.getItem(LS_KEYS.phone) || "",
    address: localStorage.getItem(LS_KEYS.address) || ""
  };
}

export function saveShopInfo({ name, phone, address }) {
  localStorage.setItem(LS_KEYS.name, (name || "").trim());
  localStorage.setItem(LS_KEYS.phone, (phone || "").trim());
  localStorage.setItem(LS_KEYS.address, (address || "").trim());
}
