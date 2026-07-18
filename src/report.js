// Resumo mensal: totais, comparação com a média recente, top categorias e
// estabelecimentos, patrimônio no mês. Tudo derivado dos dados locais.
import { monthKey, addMonths } from "./format";

const r2 = (v) => Math.round(v * 100) / 100;
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

export function computeMonthlyReport(data, mk) {
  const inMonth = data.expenses.filter((t) => monthKey(t.date) === mk);
  let entradas = 0, saidas = 0, assinaturas = 0, aportes = 0;
  const byCat = new Map();
  const byMerchant = new Map();
  for (const t of inMonth) {
    if (t.type === "in") {
      entradas += t.amount;
      continue;
    }
    saidas += t.amount;
    if (t.recurring) assinaturas += t.amount;
    if (t.aporte) aportes += t.amount;
    byCat.set(t.catId, (byCat.get(t.catId) || 0) + t.amount);
    const key = norm(t.desc);
    if (key) {
      const cur = byMerchant.get(key) || { name: String(t.desc).replace(/\s+/g, " ").trim(), count: 0, total: 0 };
      cur.count++;
      cur.total += t.amount;
      byMerchant.set(key, cur);
    }
  }

  // média de saídas dos até 3 meses anteriores que tiveram movimento
  let prevSum = 0, prevCount = 0;
  for (let i = 1; i <= 3; i++) {
    const pk = addMonths(mk, -i);
    const s = data.expenses
      .filter((t) => monthKey(t.date) === pk && t.type === "out")
      .reduce((a, t) => a + t.amount, 0);
    if (s > 0) {
      prevSum += s;
      prevCount++;
    }
  }
  const mediaAnterior = prevCount ? r2(prevSum / prevCount) : null;

  const cat = (id) => data.categories.find((c) => c.id === id);
  const topCategorias = [...byCat.entries()]
    .map(([id, total]) => ({ id, name: cat(id)?.name || "Sem categoria", color: cat(id)?.color || "#888", total: r2(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);
  const topEstabelecimentos = [...byMerchant.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
    .map((m) => ({ ...m, total: r2(m.total) }));

  const hist = (data.history || []).filter((h) => h.d.slice(0, 7) === mk);
  const patrimonio = hist.length ? { inicio: hist[0].total, fim: hist[hist.length - 1].total } : null;

  return {
    month: mk,
    count: inMonth.length,
    entradas: r2(entradas),
    saidas: r2(saidas),
    saldo: r2(entradas - saidas),
    assinaturas: r2(assinaturas),
    aportes: r2(aportes),
    mediaAnterior,
    topCategorias,
    topEstabelecimentos,
    patrimonio,
  };
}
