// Estimativa automática do valor atual da renda fixa usando as séries
// públicas do Banco Central (SGS): CDI diário (12), Selic diária (11) e
// IPCA mensal (433). Tudo estimativa BRUTA "de mercado" — o valor exato é o
// da corretora — mas dá o momentum diário sem digitar nada.
import { httpGet } from "./backend";
import { parseNum, todayISO } from "./format";

const SERIES = { cdi: 12, selic: 11, ipca: 433 };
const ESTIMABLE = ["% CDI", "Selic +", "IPCA +", "Prefixado"];

// cache por sessão: cada série é buscada uma vez por data inicial
const cache = new Map();

const brDate = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const isoDate = (br) => {
  const [d, m, y] = br.split("/");
  return `${y}-${m}-${d}`;
};

async function fetchSeries(code, startISO) {
  const key = `${code}|${startISO}`;
  if (!cache.has(key)) {
    const url =
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados` +
      `?formato=json&dataInicial=${brDate(startISO)}&dataFinal=${brDate(todayISO())}`;
    const p = (async () => {
      const json = JSON.parse(await httpGet(url));
      return (Array.isArray(json) ? json : [])
        .map((e) => ({ date: isoDate(e.data), value: parseFloat(e.valor) }))
        .filter((e) => !isNaN(e.value));
    })().catch((e) => {
      cache.delete(key); // não deixa um erro grudar no cache
      throw e;
    });
    cache.set(key, p);
  }
  return cache.get(key);
}

export function isEstimable(f) {
  if (!(f.applied > 0) || !f.appliedDate || !ESTIMABLE.includes(f.indexer)) return false;
  const rate = parseNum(f.rate);
  // % CDI e Prefixado precisam da taxa; Selic+/IPCA+ aceitam spread vazio (= 0)
  if ((f.indexer === "% CDI" || f.indexer === "Prefixado") && !(rate > 0)) return false;
  return true;
}

function daysBetween(aISO, bISO) {
  return Math.max(0, Math.round((new Date(bISO) - new Date(aISO)) / 86400000));
}

function weekdaysBetween(aISO, bISO) {
  let count = 0;
  const d = new Date(aISO + "T00:00:00");
  const end = new Date(bISO + "T00:00:00");
  while (d < end) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// IR regressivo sobre o rendimento; LCI/LCA/CRI/CRA/incentivadas são isentas
export function irForDays(days) {
  if (days <= 180) return 22.5;
  if (days <= 360) return 20;
  if (days <= 720) return 17.5;
  return 15;
}

export function isIrExempt(f) {
  return /\b(lci|lca|cri|cra|incentivad|poupan|debênture.?incentivada)/i.test(
    `${f.name || ""} ${f.notes || ""}`
  );
}

function computeGross(f, s, today) {
  const rate = parseNum(f.rate);
  const start = f.appliedDate;
  const days = daysBetween(start, today);
  switch (f.indexer) {
    case "% CDI": {
      const pct = rate / 100;
      let factor = 1;
      for (const e of s.cdi) if (e.date >= start) factor *= 1 + (e.value / 100) * pct;
      return f.applied * factor;
    }
    case "Selic +": {
      const spread = isNaN(rate) ? 0 : rate;
      let factor = 1;
      for (const e of s.selic) if (e.date >= start) factor *= 1 + e.value / 100;
      return f.applied * factor * Math.pow(1 + spread / 100, days / 365);
    }
    case "IPCA +": {
      const spread = isNaN(rate) ? 0 : rate;
      let factor = 1;
      // série mensal (data = 1º dia do mês de referência); só meses após a aplicação
      for (const e of s.ipca) if (e.date > start) factor *= 1 + e.value / 100;
      return f.applied * factor * Math.pow(1 + spread / 100, days / 365);
    }
    case "Prefixado": {
      // convenção 252 dias úteis/ano (feriados não descontados — estimativa)
      const du = weekdaysBetween(start, today);
      return f.applied * Math.pow(1 + rate / 100, du / 252);
    }
    default:
      return null;
  }
}

const r2 = (v) => Math.round(v * 100) / 100;

// Retorna { updates, errors }. updates = null quando não há nada a fazer
// (sem ativos estimáveis ou todos já estimados hoje).
export async function estimateFixedAssets(fixed) {
  const today = todayISO();
  const targets = fixed.filter(isEstimable);
  if (!targets.length) return { updates: null, errors: [] };
  if (targets.every((f) => f.estDate === today)) return { updates: null, errors: [] };

  const earliest = targets.reduce((min, f) => (f.appliedDate < min ? f.appliedDate : min), today);
  const need = {
    cdi: targets.some((f) => f.indexer === "% CDI"),
    selic: targets.some((f) => f.indexer === "Selic +"),
    ipca: targets.some((f) => f.indexer === "IPCA +"),
  };

  const errors = [];
  const s = { cdi: [], selic: [], ipca: [] };
  const results = await Promise.allSettled([
    need.cdi ? fetchSeries(SERIES.cdi, earliest) : Promise.resolve([]),
    need.selic ? fetchSeries(SERIES.selic, earliest) : Promise.resolve([]),
    need.ipca ? fetchSeries(SERIES.ipca, earliest) : Promise.resolve([]),
  ]);
  const names = ["cdi", "selic", "ipca"];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") s[names[i]] = r.value;
    else if (need[names[i]]) errors.push(`Banco Central (${names[i].toUpperCase()}): ${r.reason?.message || r.reason}`);
  });

  const updates = fixed.map((f) => {
    if (!isEstimable(f)) return f;
    // se a série necessária falhou, mantém a estimativa anterior
    const seriesKey = f.indexer === "% CDI" ? "cdi" : f.indexer === "Selic +" ? "selic" : f.indexer === "IPCA +" ? "ipca" : null;
    if (seriesKey && need[seriesKey] && s[seriesKey].length === 0 && f.indexer !== "Prefixado") return f;
    const gross = computeGross(f, s, today);
    if (gross == null || isNaN(gross)) return f;
    const days = daysBetween(f.appliedDate, today);
    const ir = isIrExempt(f) ? 0 : irForDays(days);
    const net = f.applied + (gross - f.applied) * (1 - ir / 100);
    return { ...f, estValue: r2(gross), estNet: r2(net), estIr: ir, estDate: today };
  });
  return { updates, errors };
}
