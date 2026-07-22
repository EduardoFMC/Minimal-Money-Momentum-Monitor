// Estimativa automática do valor atual da renda fixa usando as séries
// públicas do Banco Central (SGS): CDI diário (12), Selic diária (11) e
// IPCA mensal (433). Tudo estimativa BRUTA "de mercado" — o valor exato é o
// da corretora — mas dá o momentum diário sem digitar nada.
import { httpGet } from "./backend";
import { parseNum, todayISO, addMonths } from "./format";

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

// IOF regressivo: incide sobre o rendimento apenas nos primeiros 30 dias
// (96% no 1º dia caindo até 0% no 30º). A partir do 30º dia é isento.
const IOF_TABLE = [96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36, 33, 30, 26, 23, 20, 16, 13, 10, 6, 3, 0];
export function iofForDays(days) {
  if (days >= 30 || days <= 0) return 0;
  return IOF_TABLE[days - 1];
}

export function isIrExempt(f) {
  return /\b(lci|lca|cri|cra|incentivad|poupan|debênture.?incentivada)/i.test(
    `${f.name || ""} ${f.notes || ""}`
  );
}

// Rendimento bruto de UMA parcela (aporte) desde sua data até `asOf`.
// asOf permite avaliar em qualquer data (reconstrução do passado / projeção).
// Diárias (CDI/Selic) usam `< asOf`: a taxa do dia só credita no FIM do dia,
// então "hoje" inclui as taxas até ontem — igual ao extrato do banco.
// (A série da Selic publica o próprio dia; sem isso contaria um dia a mais.)
function trancheGross(indexer, rate, amount, start, s, asOf) {
  const days = daysBetween(start, asOf);
  switch (indexer) {
    case "% CDI": {
      const pct = rate / 100;
      let factor = 1;
      for (const e of s.cdi) if (e.date >= start && e.date < asOf) factor *= 1 + (e.value / 100) * pct;
      return amount * factor;
    }
    case "Selic +": {
      const spread = isNaN(rate) ? 0 : rate;
      let factor = 1;
      for (const e of s.selic) if (e.date >= start && e.date < asOf) factor *= 1 + e.value / 100;
      return amount * factor * Math.pow(1 + spread / 100, days / 365);
    }
    case "IPCA +": {
      const spread = isNaN(rate) ? 0 : rate;
      let factor = 1;
      // série mensal (data = 1º dia do mês de referência); só meses após a aplicação
      for (const e of s.ipca) if (e.date > start && e.date <= asOf) factor *= 1 + e.value / 100;
      return amount * factor * Math.pow(1 + spread / 100, days / 365);
    }
    case "Prefixado": {
      // convenção 252 dias úteis/ano (feriados não descontados — estimativa)
      const du = weekdaysBetween(start, asOf);
      return amount * Math.pow(1 + rate / 100, du / 252);
    }
    default:
      return null;
  }
}

// Parcelas de aporte da aplicação. Sem aportes mensais, é uma parcela só.
function tranchesOf(f) {
  if (Array.isArray(f.contribs) && f.contribs.length) {
    return f.contribs.filter((c) => c && c.date && c.amount > 0);
  }
  return [{ date: f.appliedDate, amount: f.applied }];
}

const r2 = (v) => Math.round(v * 100) / 100;
// Bancos TRUNCAM o valor bruto nos centavos (convenção CETIP/B3), não arredondam
const trunc2 = (v) => Math.floor(v * 100 + 1e-7) / 100;

// Versão da lógica de estimativa. Ao mudar o cálculo (ex.: nowcast do CDI),
// incrementar para invalidar estimativas já gravadas com estDate de hoje.
const EST_VERSION = 4;

// Estima valor bruto, líquido, IR e IOF efetivos considerando cada aporte
// separadamente (aportes mais novos pagam mais IR/IOF). Segue as convenções
// dos bancos: bruto truncado nos centavos; IOF e IR arredondados cada um em
// centavos e subtraídos em sequência. Retorna null se algo não calcular.
function estimateOne(f, s, today) {
  const rate = parseNum(f.rate);
  // LCI/LCA/CRI/CRA: sem IR; e sem IOF na prática (carência impede resgate < 30d)
  const exempt = isIrExempt(f);
  let grossT = 0, netT = 0, yieldTotal = 0, irWeighted = 0, iofWeighted = 0;
  let oldestDays = 0;
  for (const t of tranchesOf(f)) {
    const g = trancheGross(f.indexer, rate, t.amount, t.date, s, today);
    if (g == null || isNaN(g)) return null;
    const days = daysBetween(t.date, today);
    oldestDays = Math.max(oldestDays, days);
    const gT = trunc2(g);
    const y = r2(gT - t.amount);
    const iof = exempt ? 0 : iofForDays(days);
    const ir = exempt ? 0 : irForDays(days);
    const iofAmt = r2(Math.max(0, y) * (iof / 100));
    const irAmt = r2(Math.max(0, y - iofAmt) * (ir / 100));
    grossT += gT;
    netT += t.amount + y - iofAmt - irAmt;
    yieldTotal += y;
    irWeighted += y * ir;
    iofWeighted += y * iof;
  }
  // alíquotas efetivas ponderadas pelo rendimento de cada parcela
  const estIr = yieldTotal > 0 ? Math.round((irWeighted / yieldTotal) * 10) / 10 : exempt ? 0 : irForDays(oldestDays);
  const estIof = yieldTotal > 0 ? Math.round((iofWeighted / yieldTotal) * 10) / 10 : 0;
  return { estValue: r2(grossT), estNet: r2(netT), estIr, estIof, estDate: today, estVer: EST_VERSION };
}

// Retorna { updates, errors }. updates = null quando não há nada a fazer
// (sem ativos estimáveis ou todos já estimados hoje).
export async function estimateFixedAssets(fixed) {
  const today = todayISO();
  const targets = fixed.filter(isEstimable);
  if (!targets.length) return { updates: null, errors: [] };
  // recalcula se algum ativo não foi estimado hoje OU se a lógica mudou (versão)
  if (targets.every((f) => f.estDate === today && f.estVer === EST_VERSION)) return { updates: null, errors: [] };

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
    if (r.status === "fulfilled") s[names[i]] = [...r.value]; // cópia (nowcast muta)
    else if (need[names[i]]) errors.push(`Banco Central (${names[i].toUpperCase()}): ${r.reason?.message || r.reason}`);
  });
  // preenche os dias úteis já decorridos que o BCB ainda não publicou
  nowcast(s, today);

  const updates = fixed.map((f) => {
    if (!isEstimable(f)) return f;
    // se a série necessária falhou, mantém a estimativa anterior
    const seriesKey = f.indexer === "% CDI" ? "cdi" : f.indexer === "Selic +" ? "selic" : f.indexer === "IPCA +" ? "ipca" : null;
    if (seriesKey && need[seriesKey] && s[seriesKey].length === 0 && f.indexer !== "Prefixado") return f;
    const est = estimateOne(f, s, today);
    if (!est) return f;
    return { ...f, ...est };
  });
  return { updates, errors };
}

// Taxas atuais de mercado para o Planejamento: CDI anualizado (última taxa
// diária ^252) e IPCA acumulado em 12 meses. Usa o cache das séries do BCB.
export async function currentMarketRates() {
  const today = todayISO();
  const cdiStart = addMonths(today.slice(0, 7), -1) + "-01";
  const ipcaStart = addMonths(today.slice(0, 7), -14) + "-01";
  const [rc, ri] = await Promise.allSettled([
    fetchSeries(SERIES.cdi, cdiStart),
    fetchSeries(SERIES.ipca, ipcaStart),
  ]);
  let cdiAA = null;
  let ipca12 = null;
  if (rc.status === "fulfilled" && rc.value.length) {
    const last = rc.value[rc.value.length - 1].value;
    cdiAA = (Math.pow(1 + last / 100, 252) - 1) * 100;
  }
  if (ri.status === "fulfilled" && ri.value.length) {
    const last12 = ri.value.slice(-12);
    ipca12 = (last12.reduce((f, e) => f * (1 + e.value / 100), 1) - 1) * 100;
  }
  return { cdiAA, ipca12 };
}

// ===== Curva de patrimônio (reconstrução do passado + projeção do futuro) =====

const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function lastDayOfMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 0);
  return `${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Último dia útil estritamente antes de `iso`.
function prevBusinessDay(iso) {
  const d = new Date(iso + "T00:00:00");
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return isoOf(d);
}

// Estende as séries repetindo a última taxa conhecida até `toISO`.
// Usado tanto para "nowcast" (preencher dias úteis já decorridos que o BCB
// ainda não publicou — ele atrasa ~1-2 dias) quanto para projeção futura.
// Não mexe no cache: recebe cópias. includeIpca controla a série mensal.
function extendSeriesTo(s, toISO, includeIpca = true) {
  for (const key of ["cdi", "selic"]) {
    const arr = s[key];
    if (!arr.length) continue;
    const last = arr[arr.length - 1];
    const d = new Date(last.date + "T00:00:00");
    d.setDate(d.getDate() + 1);
    const end = new Date(toISO + "T00:00:00");
    while (d <= end) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) arr.push({ date: isoOf(d), value: last.value, proj: true });
      d.setDate(d.getDate() + 1);
    }
  }
  if (!includeIpca) return;
  const ip = s.ipca;
  if (ip.length) {
    const last = ip[ip.length - 1];
    let m = addMonths(last.date.slice(0, 7), 1);
    const endM = toISO.slice(0, 7);
    while (m <= endM) {
      ip.push({ date: `${m}-01`, value: last.value, proj: true });
      m = addMonths(m, 1);
    }
  }
}

// Preenche a lacuna de publicação do BCB: os dias úteis já decorridos até
// ontem que ainda não estão na série (só CDI/Selic diários; IPCA é mensal e
// tem outra dinâmica). Alinha o valor "bruto hoje" com o do banco/corretora.
function nowcast(s, today) {
  extendSeriesTo(s, prevBusinessDay(today), false);
}

// Parcelas do ativo incluindo aportes mensais futuros até o horizonte.
function projectedTranches(f, horizonISO) {
  const base = Array.isArray(f.contribs) && f.contribs.length
    ? [...f.contribs]
    : [{ date: f.appliedDate, amount: f.applied ?? 0 }];
  const monthly = Number(f.monthly) || 0;
  if (monthly > 0 && f.appliedDate) {
    const day = Math.min(Math.max(parseInt(f.monthlyDay, 10) || parseInt(f.appliedDate.slice(8, 10), 10) || 1, 1), 28);
    const lastMonth = base.reduce((mx, t) => (t.date.slice(0, 7) > mx ? t.date.slice(0, 7) : mx), f.appliedDate.slice(0, 7));
    let m = addMonths(lastMonth, 1);
    const endM = horizonISO.slice(0, 7);
    while (m <= endM) {
      base.push({ date: `${m}-${String(day).padStart(2, "0")}`, amount: monthly });
      m = addMonths(m, 1);
    }
  }
  return base;
}

function fixedValueAt(targets, trByAsset, s, asOf) {
  let val = 0;
  for (const f of targets) {
    const rate = parseNum(f.rate);
    for (const t of trByAsset.get(f.id)) {
      if (t.date > asOf) continue;
      const g = trancheGross(f.indexer, rate, t.amount, t.date, s, asOf);
      if (g == null || isNaN(g)) return null;
      val += g;
    }
  }
  return r2(val);
}

// Curva mensal do valor de renda fixa do 1º investimento até hoje (passado
// reconstruído com as séries reais) e, se horizonMonths>0, projetada até o
// horizonte (repetindo as taxas atuais + aportes mensais futuros).
// Retorna { points: [{d, value, future}], firstDate } ou null.
export async function buildFixedCurve(fixed, horizonMonths = 0) {
  const targets = fixed.filter(isEstimable);
  if (!targets.length) return null;
  const today = todayISO();
  const earliest = targets.reduce((m, f) => (f.appliedDate < m ? f.appliedDate : m), today);

  const need = {
    cdi: targets.some((f) => f.indexer === "% CDI"),
    selic: targets.some((f) => f.indexer === "Selic +"),
    ipca: targets.some((f) => f.indexer === "IPCA +"),
  };
  const s = { cdi: [], selic: [], ipca: [] };
  const res = await Promise.allSettled([
    need.cdi ? fetchSeries(SERIES.cdi, earliest) : Promise.resolve([]),
    need.selic ? fetchSeries(SERIES.selic, earliest) : Promise.resolve([]),
    need.ipca ? fetchSeries(SERIES.ipca, earliest) : Promise.resolve([]),
  ]);
  const names = ["cdi", "selic", "ipca"];
  res.forEach((r, i) => {
    if (r.status === "fulfilled") s[names[i]] = [...r.value]; // cópia (extendFuture muta)
    else if (need[names[i]]) throw new Error(`Séries do Banco Central indisponíveis (${names[i].toUpperCase()})`);
  });

  const endM = horizonMonths > 0 ? addMonths(today.slice(0, 7), horizonMonths) : today.slice(0, 7);
  const horizonISO = horizonMonths > 0 ? lastDayOfMonth(endM) : today;
  nowcast(s, today); // alinha o "hoje" com o banco (dias já decorridos)
  if (horizonMonths > 0) extendSeriesTo(s, horizonISO);

  const trByAsset = new Map(targets.map((f) => [f.id, projectedTranches(f, horizonISO)]));

  // checkpoints: 1º investimento, cada fim de mês, hoje e o horizonte
  const checkpoints = new Set([earliest, today]);
  let m = earliest.slice(0, 7);
  while (m <= endM) {
    const ed = lastDayOfMonth(m);
    if (ed >= earliest && ed <= horizonISO) checkpoints.add(ed);
    m = addMonths(m, 1);
  }
  if (horizonMonths > 0) checkpoints.add(horizonISO);

  const points = [];
  for (const d of [...checkpoints].filter((d) => d >= earliest && d <= horizonISO).sort()) {
    const value = fixedValueAt(targets, trByAsset, s, d);
    if (value != null) points.push({ d, value, future: d > today });
  }

  // principal (dinheiro efetivamente aportado) até hoje e até o horizonte,
  // para separar rendimento de novos aportes na projeção
  const principalAt = (asOf) => {
    let p = 0;
    for (const tr of trByAsset.values()) for (const t of tr) if (t.date <= asOf) p += t.amount || 0;
    return r2(p);
  };

  return {
    points,
    firstDate: earliest,
    principalNow: principalAt(today),
    principalHorizon: principalAt(horizonISO),
  };
}
