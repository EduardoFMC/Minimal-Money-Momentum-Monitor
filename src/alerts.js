// Motor de alertas: roda após cada atualização de cotações e decide o que
// merece notificação nativa. Ledger diário (settings.notifiedAlerts) garante
// no máximo 1 notificação por item/tipo/dia.
import { fmtBRL, fmtPct, daysUntil } from "./format";

const MATURITY_DAYS = [30, 7, 1, 0];

export function checkAlerts(data, settings, todayIso) {
  const ledger = new Set(settings.notifiedAlerts || []);
  const movePct = Number(settings.alertMovePct) > 0 ? Number(settings.alertMovePct) : 5;
  const on = (k) => settings[k] !== false; // ausente = ligado
  const notifications = [];
  const keys = [];
  const push = (k, title, body) => {
    if (ledger.has(k)) return;
    keys.push(k);
    notifications.push({ title, body });
  };

  if (on("alertTarget")) {
    for (const w of data.watchlist) {
      if (w.target != null && w.lastPrice != null && w.lastPrice <= w.target) {
        push(
          `${todayIso}|${w.id}|target`,
          `🎯 ${(w.ticker || w.name || "").toUpperCase()}: alvo atingido`,
          `${fmtBRL(w.lastPrice)} — alvo era ${fmtBRL(w.target)}`
        );
      }
    }
  }

  if (on("alertMove")) {
    for (const a of [...data.watchlist, ...data.variable]) {
      if (a.lastChange != null && Math.abs(a.lastChange) >= movePct) {
        push(
          `${todayIso}|${a.id}|move`,
          `${a.lastChange >= 0 ? "📈" : "📉"} ${(a.ticker || a.name || "").toUpperCase()} ${fmtPct(a.lastChange)}`,
          `Cotação agora: ${fmtBRL(a.lastPrice)}`
        );
      }
    }
  }

  if (on("alertMaturity")) {
    for (const f of data.fixed) {
      const d = daysUntil(f.maturity);
      if (d != null && MATURITY_DAYS.includes(d)) {
        push(
          `${todayIso}|${f.id}|venc`,
          `📅 ${f.name} vence ${d === 0 ? "hoje" : `em ${d} dia${d > 1 ? "s" : ""}`}`,
          `Valor estimado: ${fmtBRL(f.currentValue ?? f.estValue ?? f.applied)}`
        );
      }
    }
  }

  return { notifications, keys };
}
