import { loadTodayStats, loadDuesSummary } from "./data.js";

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function refreshDashboard() {
  const { totalSale, totalProfit } = await loadTodayStats();
  document.getElementById("statTodaySale").textContent = money(totalSale);
  document.getElementById("statTodayProfit").textContent = money(totalProfit);

  const { youllGet, youllGive } = await loadDuesSummary();
  document.getElementById("statYoullGet").textContent = money(youllGet);
  document.getElementById("statYoullGive").textContent = money(youllGive);
}

export function initDashboard({ onQuickSale }) {
  document.getElementById("btnQuickSale").addEventListener("click", onQuickSale);
}
