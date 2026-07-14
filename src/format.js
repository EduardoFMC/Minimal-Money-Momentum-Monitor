// Formatação pt-BR
export function fmtBRL(v) {
  if (v == null || isNaN(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtNum(v, digits = 2) {
  if (v == null || isNaN(v)) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: digits });
}

export function fmtPct(v, signed = true) {
  if (v == null || isNaN(v)) return "—";
  const s = v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return (signed && v > 0 ? "+" : "") + s + "%";
}

// Aceita "1.234,56", "1234.56", "R$ 10,50"...
export function parseNum(s) {
  if (typeof s === "number") return s;
  if (s == null || s === "") return NaN;
  let t = String(s).trim().replace(/\s/g, "").replace("R$", "");
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  return parseFloat(t);
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  return isNaN(d) ? "—" : d.toLocaleDateString("pt-BR");
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthKey(dateISO) {
  return (dateISO || "").slice(0, 7);
}

export function monthLabel(key) {
  // key = "YYYY-MM"
  const d = new Date(key + "-01T00:00:00");
  if (isNaN(d)) return key;
  const s = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function addMonths(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(iso.slice(0, 10) + "T00:00:00");
  if (isNaN(target)) return null;
  const now = new Date(todayISO() + "T00:00:00");
  return Math.round((target - now) / 86400000);
}
