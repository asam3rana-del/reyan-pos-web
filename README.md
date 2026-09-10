# IBTISAAM Kiryana Store — Web Version (Phase 2)

Ye web app **Android app ke same Firebase project** se connect hoti hai — koi
alag database nahi, same customers/products/sales sab kuch same jagah se aata
hai. Isay kisi bhi PC/laptop ke Chrome browser mein khol kar POS ki tarah use
kar sakte hain, aur Android tablet ke sath data automatically milta rahega
(dono taraf se Firestore ke zariye).

## Is version mein kya hai (Phase 2 — abhi shuruwat)

- ✅ Setup/Connect screen (Firebase config + branch code)
- ✅ Dashboard (Today's Sale/Profit, Dues Summary, Quick Actions)
- ✅ Sale/Billing screen — computer POS jaisa (two-pane: item entry left,
  cart/total/payment right, hamesha visible)
- ✅ Day Book (date-wise sales list)
- ✅ Stock Report (Low Stock filter)
- ✅ Purchase screen — Sale jaisa hi two-pane layout (supplier + bill date,
  item entry left, bill/payment right). Save karne par stock barhta hai,
  product ka cost weighted-average se update hota hai (bilkul Android app
  jaisa), matched supplier ki balance/payment/cash-out record hoti hai.
  Supplier sirf naam se match hota hai (naya supplier abhi Purchase screen se
  nahi bantay — pehle "Parties" screen se bana lein, phir yahan naam se select
  ho jayega). Purchase edit/history abhi nahi hai (sirf naya purchase record karna).
- ✅ Customers/Suppliers ka pura CRUD — nayi "Parties" screen (Customers ↔
  Suppliers tab toggle): add/edit/delete, phone, opening balance, customer
  credit limit, search, aur current balance ("You'll get"/"You'll give")
  har record ke sath dikhta hai. Running `balance` field kabhi bhi edit se
  overwrite nahi hota — sirf sale/purchase/payment se increment hota hai
  (bilkul Android app ke `PartyRepository.kt`/`SyncQueueHelper.kt` jaisa),
  is liye do devices ek waqt mein alag cheezein edit karein to balance kabhi
  out of sync nahi hota.
- ✅ Reports screen — do tabs:
  - **Profit & Loss**: Today/This Week/This Month/All Time filter pills, Total
    Sales/Gross Profit/Total Purchases/Total Expenses cards, poora P&L
    statement (Revenue → COGS → Gross Profit → Expenses → Net Profit), Top
    Products aur Daily Sales breakdown.
  - **Balance Sheet**: Assets (Cash in Hand, Bank Balance, Stock at cost,
    Receivables, Advance Paid to Suppliers), Liabilities (Payables, Advance
    from Customers), Capital/Equity — bilkul Android app ki
    `ReportsActivity.kt`/`BalanceSheetActivity.kt` ki formula ke sath (stock
    value nikalne mein smallest-unit-cost fix bhi shamil hai).
- ✅ Cash In / Cash Out screen — Android app ki `CashActivity.kt` jaisa: amount,
  method (Cash/Bank), Cash Out ke liye expense category dropdown (Rent,
  Utility Bills, Wages, waghera — "Miscellaneous" choose karne par ek extra
  description field khulta hai), aur optional reason/note. Aaj ke Cash
  In/Cash Out totals upar cards mein dikhte hain, neeche Recent Transactions
  list bhi hai. Ye entries wahi `cash_transactions` collection mein jati hain
  jo Purchase screen automatically banata hai, is liye Reports/Balance Sheet
  mein bhi turant reflect hoti hain.
- ✅ Expenses screen — Android app ki `ExpenseActivity.kt` jaisa: amount,
  expense category dropdown (Rent, Wages, Salaries, Zakat, waghera —
  "Miscellaneous" par description field), optional note, Today's/This
  Month's total cards, aur delete-able list. Ye alag `expenses` collection
  mein jata hai (Cash In/Out se bilkul separate) — yehi collection hai jo
  Reports ke P&L "Total Expenses"/Net Profit padhte hain.
- ✅ **Staff Login** — Device ID access ab sirf pehla darwaza hai; is ke baad
  ek dusra username/password login bhi hai (bilkul Android app ke
  `LoginActivity.kt` jaisa). Pehli martaba is branch pe koi bhi web login
  nahi to "Create Admin Account" screen aati hai. Android app ke User
  Management se banaya hua username web pe bhi kaam karta hai — pehli
  martaba web pe login karte waqt sirf apna **web password set karna**
  padta hai (Android ka password kabhi Firestore mein nahi jata — is liye
  cross-check nahi ho sakta, dono passwords alag hain, jaisa neeche
  "Technical note" mein likha hai). Login ke baad header mein naam/role
  dikhta hai + Logout button. **⚙ Setup** screen (Firebase project/branch +
  shop info) ab sirf **admin** role ke liye dikhti hai — baqi screens har
  logged-in role ke liye khuli hain (poora per-screen role-permission system
  abhi is phase ka hissa nahi, sirf Setup ka gate hai).
- ✅ **Bill Print** — Sale save karne ke baad "🖨 Print Last Receipt" button
  aur Purchase save karne ke baad "🖨 Print Last Bill" button aata hai; Day
  Book ki har row par bhi ek "🖨 Print" link hai (kisi bhi din ki koi bhi
  purani sale dobara print/reprint ki ja sakti hai). Button dabane se ek
  naya tab khulta hai jisme thermal-receipt-jaisi simple printable bill
  hoti hai (shop name/address/phone header ke sath) — wahan se browser ka
  apna Print dialog use karke printer par print ya "Save as PDF" kiya ja
  sakta hai. Koi server/PDF library nahi lagi, sirf browser ka built-in
  print feature use hua hai.

## Abhi is mein kya NAHI hai (agle phase mein aayega)

- ❌ Poora role-based permission system (abhi sirf Setup screen admin-only hai)
- ❌ Web se naye staff users banane ka apna UI (Android app ke User
  Management se hi banane padte hain; web sirf login/web-password set karta hai)
- ❌ Purchase edit/history (README ke Purchase section mein pehle se likha hua)

Jab chahein, agla message mein bol dein "Purchase bhi web pe bana do" ya jo
bhi chahiye — isi tarah, ek ek karke add hota jayega.

---

## Setup — pehli martaba connect karna

1. **Firebase Console** kholein → apna project (wahi jo Android app
   `google-services.json` ya Settings > Cloud Sync Setup mein use ho raha
   hai) → ⚙️ **Project settings** → sab se neeche **"Your apps"** section.
2. Agar wahan koi **Web app (</>) icon** nahi hai, "Add app" → Web choose
   karein → naam kuch bhi de dein → "Register app". Ye Google Play/App Store
   se related nahi — sirf ek web config nikalta hai.
3. Jo `firebaseConfig` object dikhega, usmein se ye values copy karein:
   - `projectId`
   - `apiKey`
   - `appId`
   - `storageBucket` (optional)
4. **Branch Code** wahi dalein jo Android app ke Settings > Cloud Sync Setup
   mein diya tha (bilkul same, letters/numbers/_/- allowed).
5. Web app kholein → Setup screen mein ye sab values dal kar **Connect**
   dabayein.
6. Connect hone ke baad ek **"Device ID"** dikhega (jaisay Android app ka
   Device ID hota hai). Ye ID copy karein.
7. Firebase Console → **Firestore Database** → `branch_members` collection
   → naya document banayein:
   - Document ID: **wahi Device ID** jo copy kiya
   - Field: `branchId` (string) = aap ka branch code
8. Wapas web app pe aayein, page refresh karein — ab data load hona shuru ho
   jayega.

⚠️ **Step 7 zaroori hai** — is ke baghair Firestore "permission denied" dega
(bilkul waisay jaisay naye Android device ko access dene ke liye karte hain).

---

## Hosting — kahan chalayein

Teen tareeqay, jo bhi aasan lage:

### Option A — Firebase Hosting (recommended, free)
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting,firestore:indexes
```
Isse ek public URL milega (e.g. `https://your-project.web.app`) jo kisi bhi
PC/laptop/tablet ke browser se khul jayega.

### Option B — Sirf local PC pe (bina internet-facing hosting ke)
`webapp` folder ko kisi bhi simple local server se serve karein (Firebase JS
SDK ko `file://` se modules load karne mein masla hota hai, isliye seedha
double-click se `index.html` kholna kaam nahi karega):
```bash
cd webapp
python3 -m http.server 8080
```
Phir browser mein `http://localhost:8080` kholein.

### Option C — GitHub Pages
`webapp` folder ko GitHub Pages se serve kar dein (repo Settings > Pages >
folder select karein). Firebase Hosting jaisa hi kaam karega.

---

## Technical note (agli baat-cheet ke liye)

Firestore schema (`sales`, `products`, `customers` waghera ke fields)
**Android app ke `SyncQueueHelper.kt` se exactly match karta hai** — is liye
web se banayi gayi sale Android app ke Day Book/Reports mein bhi sahi dikhegi,
aur stock/customer balance dono taraf se sahi update hote hain. Naya field ya
collection Android side add ho to, `webapp/js/data.js` mein wahi shape yahan
bhi add karni hogi.

Naye files is round mein add huay:
- `js/auth.js` — PBKDF2 password hashing (browser ka built-in Web Crypto,
  koi extra library nahi) + session storage (localStorage, Logout tak
  persist karta hai — bilkul Android ke SharedPreferences session jaisa).
- `js/login.js` — Staff Login screen ka logic (Create Admin / normal Login /
  first-time "claim" password set karna).
- `js/shop.js` — Shop Name/Phone/Address, sirf is browser mein save hota hai
  (Android app ka `shop_name`/`shop_phone`/`shop_address` Firestore mein sync
  hi nahi hota — sirf uske local Room `app_settings` table mein hai — is liye
  web ko apni alag copy rakhni padi, receipt header ke liye).
- `js/print.js` — Sale/Purchase receipt ko naye tab mein print-ready HTML ke
  taur par kholta hai.

**Zaroori baat — `users` collection mein ek naya field `webPasswordHash`
add hua hai.** Android ka `SyncQueueHelper.userJson()` jaan-boojh kar
`passwordHash` Firestore mein kabhi nahi bhejta (comment: "so it never sits
in Firestore") — is liye web is se cross-check nahi kar sakta. Web apna
alag `webPasswordHash` field use karta hai (same "pbkdf2$salt$hash" format,
sirf consistency ke liye, dono hash kabhi compare nahi hote). Android
`users` docs ko `SetOptions.merge()` se likhta hai (`SyncApi.kt`), is liye
ye naya field Android side se future edits mein delete/overwrite nahi hoga —
lekin agar kabhi Android side ka koi tool/script `users` collection ko
**poora overwrite (set without merge)** karay, to ye field ud jayega
(gayab ho jayega); abhi tak koi aisi jagah nahi mili is codebase mein.
