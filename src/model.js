// Modelo de dados + valores padrão
import { addMonths } from "./format";

export const DEFAULT_CATEGORIES = [
  { id: "alimentacao", name: "Alimentação", color: "#f59e0b" },
  { id: "mercado", name: "Mercado", color: "#84cc16" },
  { id: "transporte", name: "Transporte", color: "#38bdf8" },
  { id: "moradia", name: "Moradia", color: "#a78bfa" },
  { id: "assinaturas", name: "Assinaturas", color: "#f472b6" },
  { id: "lazer", name: "Lazer", color: "#fb7185" },
  { id: "saude", name: "Saúde", color: "#34d399" },
  { id: "educacao", name: "Educação", color: "#fbbf24" },
  { id: "salario", name: "Salário", color: "#4ade80" },
  { id: "investimentos", name: "Investimentos", color: "#22d3ee" },
  { id: "outros", name: "Outros", color: "#94a3b8" },
];

export const KINDS = {
  acao: "Ação",
  fii: "FII",
  cripto: "Cripto",
  moeda: "Moeda",
  opcao: "Opção",
  rendafixa: "Renda fixa",
  outro: "Outro",
};

// tipos cotados automaticamente via API
export const API_KINDS = ["acao", "fii", "cripto", "moeda"];

// Opção com dados suficientes para cotação automática (código do contrato +
// ativo-objeto + vencimento). Sem isso, o preço é manual (campo tracejado).
export function isAutoOption(a) {
  return a && a.kind === "opcao" && !!a.ticker && !!a.underlying && !!a.expiration;
}

// Ativo tem preço vindo de API (não é manual)?
export function isApiPriced(a) {
  return API_KINDS.includes(a.kind) || isAutoOption(a);
}

export const INDEXERS = ["% CDI", "IPCA +", "Selic +", "Prefixado", "Poupança", "Outro"];

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function defaultData() {
  return {
    version: 2,
    settings: {
      brapiToken: "",
      theme: { preset: "escuro", colors: {} },
      autoRefreshMin: 5,   // 0 = desligado
      autoLaunched: [],    // controle das assinaturas já lançadas ("2026-08|spotify|assinaturas|out")
      autoInvested: [],    // controle dos aportes mensais já lançados ("2026-08|<idAtivo>")
      importedFitids: [],  // FITIDs de extratos OFX já importados (deduplicação)
    },
    categories: DEFAULT_CATEGORIES,
    expenses: [],   // { id, date, desc, catId, amount, type: "in"|"out", recurring, auto?, aporte? }
    fixed: [],      // renda fixa: { id, name, issuer, indexer, rate, applied, appliedDate, maturity, liquidity, currentValue, monthly?, monthlyDay?, contribs?, estValue?, estNet?, estIr?, estIof?, estDate?, attrs, notes }
    variable: [],   // renda variável: { id, kind, ticker, name, qty, avgPrice, lastPrice, lastChange, lastUpdate, attrs, notes }
    watchlist: [],  // monitoramento: { id, kind, ticker, name, target, lastPrice, lastChange, lastUpdate, attrs, notes }
    history: [],    // snapshots diários do patrimônio: { d: "2026-07-14", rf, rv, total }
  };
}

// Garante que dados antigos/importados tenham todas as chaves
export function migrate(raw) {
  const base = defaultData();
  if (!raw || typeof raw !== "object") return base;
  const d = { ...base, ...raw };
  d.settings = { ...base.settings, ...(raw.settings || {}) };
  d.settings.theme = { ...base.settings.theme, ...(raw.settings?.theme || {}) };
  for (const k of ["categories", "expenses", "fixed", "variable", "watchlist", "history"]) {
    if (!Array.isArray(d[k])) d[k] = base[k];
  }
  for (const k of ["autoLaunched", "autoInvested", "importedFitids"]) {
    if (!Array.isArray(d.settings[k])) d.settings[k] = [];
  }
  if (typeof d.settings.autoRefreshMin !== "number") d.settings.autoRefreshMin = 5;
  if (d.categories.length === 0) d.categories = DEFAULT_CATEGORIES;
  d.version = 2;
  return d;
}

// Lança automaticamente as assinaturas/recorrentes do(s) mês(es) que
// chegaram desde a última ocorrência. Um "ledger" em settings.autoLaunched
// garante que cada mês só é lançado uma vez (apagar não recria).
// Retorna { data, count } ou null se não houver nada a fazer.
export function launchRecurring(d, todayIso) {
  const curMonth = todayIso.slice(0, 7);
  const ledger = new Set(d.settings.autoLaunched || []);
  const norm = (s) => (s || "").trim().toLowerCase();
  const keyOf = (t) => `${norm(t.desc)}|${t.catId}|${t.type}`;

  // última ocorrência de cada recorrente (aportes têm ledger próprio)
  const latest = new Map();
  for (const t of d.expenses) {
    if (!t.recurring || t.aporte) continue;
    const k = keyOf(t);
    const g = latest.get(k);
    if (!g || t.date > g.date) latest.set(k, t);
  }

  const newTx = [];
  const newKeys = [];
  for (const [key, last] of latest) {
    const day = parseInt(last.date.slice(8, 10), 10) || 1;
    let m = addMonths(last.date.slice(0, 7), 1);
    while (m <= curMonth) {
      const lk = `${m}|${key}`;
      if (!ledger.has(lk)) {
        newKeys.push(lk);
        const exists = d.expenses.some((t) => t.recurring && t.date.slice(0, 7) === m && keyOf(t) === key);
        if (!exists) {
          const daysInMonth = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
          newTx.push({
            id: uid(),
            date: `${m}-${String(Math.min(day, daysInMonth)).padStart(2, "0")}`,
            desc: last.desc,
            catId: last.catId,
            amount: last.amount,
            type: last.type,
            recurring: true,
            auto: true,
          });
        }
      }
      m = addMonths(m, 1);
    }
  }

  if (!newTx.length && !newKeys.length) return null;
  return {
    data: {
      ...d,
      expenses: [...d.expenses, ...newTx],
      settings: {
        ...d.settings,
        autoLaunched: [...(d.settings.autoLaunched || []), ...newKeys].slice(-600),
      },
    },
    count: newTx.length,
  };
}

const r2 = (v) => Math.round(v * 100) / 100;

// Aplica um aporte avulso AGORA a uma aplicação de renda fixa: soma ao valor
// investido como uma parcela (contrib) datada de hoje e força re-estimativa.
// A saída em Despesas é criada por quem chama.
export function withContribution(f, amount, todayIso) {
  const contribs = Array.isArray(f.contribs) && f.contribs.length
    ? [...f.contribs]
    : [{ date: f.appliedDate, amount: f.applied ?? 0 }];
  contribs.push({ date: todayIso, amount });
  // zera a estimativa antiga (era p/ o principal antigo) — a próxima
  // atualização recalcula; até lá o card usa o valor aplicado
  return { ...f, applied: r2((f.applied ?? 0) + amount), contribs, estValue: null, estNet: null, estIr: null, estIof: null, estDate: null };
}

// Aporte mensal ("reinvestimento como assinatura"): para cada aplicação de
// renda fixa com `monthly` > 0, lança o aporte de cada mês que já chegou —
// somando ao valor investido (parcela em `contribs`) e registrando uma SAÍDA
// nas despesas (o dinheiro sai do saldo). Ledger evita lançar o mesmo mês 2x.
// Retorna { data, count } ou null se não houver nada a lançar.
export function applyMonthlyContributions(d, todayIso) {
  const curMonth = todayIso.slice(0, 7);
  const ledger = new Set(d.settings.autoInvested || []);
  const hasInvCat = d.categories.some((c) => c.id === "investimentos");
  const catId = "investimentos";

  const newExpenses = [];
  const newKeys = [];
  let count = 0;
  let changed = false;

  const fixed = d.fixed.map((f) => {
    const monthly = Number(f.monthly) || 0;
    if (monthly <= 0 || !f.appliedDate) return f;
    const day = Math.min(Math.max(parseInt(f.monthlyDay, 10) || parseInt(f.appliedDate.slice(8, 10), 10) || 1, 1), 28);
    // aportes começam no mês seguinte ao da aplicação inicial
    let contribs = Array.isArray(f.contribs) && f.contribs.length
      ? [...f.contribs]
      : [{ date: f.appliedDate, amount: f.applied ?? 0 }];
    let applied = f.applied ?? 0;
    let local = false;
    let m = addMonths(f.appliedDate.slice(0, 7), 1);
    while (m <= curMonth) {
      const lk = `${m}|${f.id}`;
      if (!ledger.has(lk)) {
        newKeys.push(lk);
        const date = `${m}-${String(day).padStart(2, "0")}`;
        contribs.push({ date, amount: monthly });
        applied = r2(applied + monthly);
        newExpenses.push({
          id: uid(),
          date,
          desc: `Aporte: ${f.name || "investimento"}`,
          catId,
          amount: monthly,
          type: "out",
          // recurring: false — a recorrência é controlada pelo ledger de
          // aportes (autoInvested), não pelo mecanismo de assinaturas, para
          // não lançar em duplicidade nem inflar o total de "Assinaturas".
          recurring: false,
          auto: true,
          aporte: true,
        });
        count++;
        local = true;
      }
      m = addMonths(m, 1);
    }
    if (!local) return f;
    changed = true;
    return { ...f, applied, contribs, estDate: null }; // força re-estimativa
  });

  if (!changed) return null;
  return {
    data: {
      ...d,
      fixed,
      expenses: [...d.expenses, ...newExpenses],
      categories: hasInvCat ? d.categories : [...d.categories, { id: "investimentos", name: "Investimentos", color: "#22d3ee" }],
      settings: {
        ...d.settings,
        autoInvested: [...(d.settings.autoInvested || []), ...newKeys].slice(-600),
      },
    },
    count,
  };
}

// Registra/atualiza o snapshot de hoje do patrimônio (para o gráfico de
// evolução). Devolve o MESMO objeto se nada mudou (evita gravações à toa).
export function upsertHistory(d, todayIso) {
  const rf = d.fixed.reduce((s, f) => s + (f.currentValue ?? f.estValue ?? f.applied ?? 0), 0);
  const rv = d.variable.reduce((s, a) => s + (a.qty || 0) * (a.lastPrice ?? a.avgPrice ?? 0), 0);
  const entry = { d: todayIso, rf: r2(rf), rv: r2(rv), total: r2(rf + rv) };
  const last = d.history[d.history.length - 1];
  if (last && last.d === todayIso && last.total === entry.total && last.rf === entry.rf && last.rv === entry.rv) {
    return d;
  }
  const history =
    last && last.d === todayIso
      ? [...d.history.slice(0, -1), entry]
      : [...d.history, entry].slice(-730); // ~2 anos de histórico diário
  return { ...d, history };
}
