// Motor do Planejamento: simulação mensal de patrimônio (renda fixa +
// variável) com aportes recorrentes, até alcançar a independência financeira
// (regra da taxa de retirada segura: patrimônio = custo anual / taxa).
// Módulo puro — sem dependências — para ser testável fora do app.

// frequência do aporte -> quantos aportes por mês (média)
export const FREQS = [
  { id: "semanal", label: "por semana", perMonth: 52 / 12 },
  { id: "quinzenal", label: "por quinzena", perMonth: 26 / 12 },
  { id: "mensal", label: "por mês", perMonth: 1 },
  { id: "bimestral", label: "a cada 2 meses", perMonth: 1 / 2 },
  { id: "trimestral", label: "a cada 3 meses", perMonth: 1 / 3 },
  { id: "semestral", label: "a cada 6 meses", perMonth: 1 / 6 },
];

export function freqFactor(id) {
  return FREQS.find((f) => f.id === id)?.perMonth ?? 1;
}

const r2 = (v) => Math.round(v * 100) / 100;

// Média mensal de saídas dos últimos 3 meses fechados (excluindo aportes em
// investimento, que são poupança e não custo de vida). Fallback: mês atual.
export function avgMonthlySpend(expenses, todayIso) {
  const curMonth = todayIso.slice(0, 7);
  const byMonth = new Map();
  for (const t of expenses) {
    if (t.type !== "out" || t.aporte) continue;
    const mk = t.date.slice(0, 7);
    byMonth.set(mk, (byMonth.get(mk) || 0) + t.amount);
  }
  const closed = [...byMonth.entries()]
    .filter(([mk]) => mk < curMonth)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 3);
  if (closed.length) return r2(closed.reduce((s, [, v]) => s + v, 0) / closed.length);
  const cur = byMonth.get(curMonth);
  return cur ? r2(cur) : null;
}

// Média mensal de gasto POR CATEGORIA nos últimos 3 meses fechados
// (excluindo aportes). Retorna [{ catId, avg }] em ordem decrescente.
export function avgMonthlyByCategory(expenses, todayIso) {
  const curMonth = todayIso.slice(0, 7);
  const months = new Set();
  for (const t of expenses) {
    if (t.type === "out" && !t.aporte && t.date.slice(0, 7) < curMonth) months.add(t.date.slice(0, 7));
  }
  const last3 = new Set([...months].sort().reverse().slice(0, 3));
  if (!last3.size) return [];
  const byCat = new Map();
  for (const t of expenses) {
    if (t.type !== "out" || t.aporte || !last3.has(t.date.slice(0, 7))) continue;
    byCat.set(t.catId, (byCat.get(t.catId) || 0) + t.amount);
  }
  return [...byCat.entries()]
    .map(([catId, sum]) => ({ catId, avg: r2(sum / last3.size) }))
    .sort((a, b) => b.avg - a.avg);
}

// Simulação mensal.
// cfg: {
//   p0rf, p0rv           — patrimônio inicial por classe
//   aporteMensal, pctRf  — aporte mensal equivalente e % dele para renda fixa
//   rfAA, rvAA           — retorno nominal anual (%) de cada classe
//   ipcaAA               — inflação anual (%) p/ descontar (0 = nominal)
//   custoMensal          — custo de vida mensal (em R$ de hoje)
//   retiradaPct          — taxa de retirada segura anual (%; regra dos 4%)
//   maxYears             — limite da simulação (default 80)
// }
// IR: renda fixa rende líquida de 15% (alíquota de longo prazo); renda
// variável compõe bruta (só tributa na venda) — nota exibida na UI.
export function simulatePlan(cfg) {
  const {
    p0rf = 0, p0rv = 0, aporteMensal = 0, pctRf = 100,
    rfAA = 0, rvAA = 0, ipcaAA = 0, custoMensal = 0,
    retiradaPct = 4, maxYears = 80,
  } = cfg;

  const infl = Math.max(0, ipcaAA) / 100;
  const realAA = (nomPct) => (1 + nomPct / 100) / (1 + infl) - 1;
  const rfNetAA = rfAA * 0.85; // IR 15% sobre o rendimento
  const mRf = Math.pow(1 + realAA(rfNetAA), 1 / 12) - 1;
  const mRv = Math.pow(1 + realAA(rvAA), 1 / 12) - 1;

  const fireNumber = retiradaPct > 0 ? (custoMensal * 12) / (retiradaPct / 100) : Infinity;
  const apRf = aporteMensal * (Math.min(100, Math.max(0, pctRf)) / 100);
  const apRv = aporteMensal - apRf;

  let rf = p0rf;
  let rv = p0rv;
  const months = [{ m: 0, rf: r2(rf), rv: r2(rv), total: r2(rf + rv) }];
  let reachedMonth = rf + rv >= fireNumber ? 0 : null;

  for (let m = 1; m <= maxYears * 12; m++) {
    rf = rf * (1 + mRf) + apRf;
    rv = rv * (1 + mRv) + apRv;
    const total = rf + rv;
    months.push({ m, rf: r2(rf), rv: r2(rv), total: r2(total) });
    if (reachedMonth == null && total >= fireNumber) reachedMonth = m;
  }

  return { fireNumber: r2(fireNumber), reachedMonth, months };
}

// Três cenários: conservador / atual / otimista (variação nos retornos).
export function simulateScenarios(cfg) {
  return {
    conservador: simulatePlan({ ...cfg, rfAA: cfg.rfAA - 1, rvAA: cfg.rvAA - 3 }),
    base: simulatePlan(cfg),
    otimista: simulatePlan({ ...cfg, rfAA: cfg.rfAA + 1, rvAA: cfg.rvAA + 3 }),
  };
}

export function monthsToLabel(m) {
  if (m == null) return null;
  const anos = Math.floor(m / 12);
  const meses = m % 12;
  if (anos === 0) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  if (meses === 0) return `${anos} ${anos === 1 ? "ano" : "anos"}`;
  return `${anos}a ${meses}m`;
}
