// Parser dos CSVs do Banco Inter: extrato da conta corrente (calibrado num
// arquivo real) e fatura do cartão (tolerante, a calibrar com um exemplo).
//
// Formato real do extrato (jul/2026):
//   linha 1-4: preâmbulo ("Extrato Conta Corrente", Conta, Período, Saldo)
//   cabeçalho: "Data Lançamento;Histórico;Descrição;Valor;Saldo"
//   dados:     "16/07/2026;Compra no débito;Taco De Ouro  ...  Bra;-7,50;3.401,11"
// Datas DD/MM/AAAA, valores pt-BR (vírgula decimal, ponto milhar, negativo = saída).

// Lançamentos de INVESTIMENTO no extrato — já são acompanhados na aba
// Investimentos (posições + aportes); importar como despesa dobraria tudo.
const INVESTMENT_RE = /^(aplica[çc][ãa]o|d[ée]bito renda fixa|d?[ée]?bito online td|debito online td|resgate|d[ée]bito bm&?f|registro bmf)/i;

// Pagamento da fatura do cartão: transferência interna — as compras em si
// entram pela importação da fatura (evita dupla contagem).
const FATURA_PAY_RE = /pagamento (de )?fatura/i;

function parseBrMoney(s) {
  if (s == null) return NaN;
  const t = String(s).trim().replace(/R\$\s?/i, "").replace(/\./g, "").replace(",", ".");
  return parseFloat(t);
}

function brDateToISO(s) {
  const m = String(s || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function normalizeDesc(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

export function isOfx(text) {
  const head = String(text).slice(0, 500).toUpperCase();
  return head.includes("OFXHEADER") || head.includes("<OFX");
}

const r2 = (v) => Math.round(v * 100) / 100;

// Extrato da conta corrente do Inter.
// Retorna { txs, skippedInvest, skippedFatura, error? }.
export function parseInterCsv(text) {
  const lines = String(text).split(/\r?\n/);
  let headerIdx = -1;
  let cols = null;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    if (/^\s*data lan/i.test(lines[i])) {
      headerIdx = i;
      cols = lines[i].split(";").map((c) => c.trim().toLowerCase());
      break;
    }
  }
  if (headerIdx === -1) {
    return { txs: [], skippedInvest: 0, skippedFatura: 0, error: "Cabeçalho não encontrado — é um extrato CSV do Inter?" };
  }
  const iData = cols.findIndex((c) => c.startsWith("data"));
  const iHist = cols.findIndex((c) => c.startsWith("hist"));
  const iDesc = cols.findIndex((c) => c.startsWith("desc"));
  const iVal = cols.findIndex((c) => c.startsWith("valor"));
  if (iData === -1 || iVal === -1) {
    return { txs: [], skippedInvest: 0, skippedFatura: 0, error: "Colunas de data/valor não encontradas no CSV." };
  }

  const txs = [];
  let skippedInvest = 0;
  let skippedFatura = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const parts = lines[i].split(";");
    if (parts.length < 3) continue;
    const date = brDateToISO(parts[iData]);
    const amt = parseBrMoney(parts[iVal]);
    if (!date || isNaN(amt) || amt === 0) continue;
    const hist = normalizeDesc(iHist >= 0 ? parts[iHist] : "");
    const desc = normalizeDesc(iDesc >= 0 ? parts[iDesc] : "");
    if (INVESTMENT_RE.test(hist)) {
      skippedInvest++;
      continue;
    }
    if (FATURA_PAY_RE.test(hist + " " + desc)) {
      skippedFatura++;
      continue;
    }
    txs.push({
      date,
      amount: r2(Math.abs(amt)),
      type: amt < 0 ? "out" : "in",
      desc: desc || hist || "(sem descrição)",
      hist,
      fitid: "",
    });
  }
  return { txs, skippedInvest, skippedFatura };
}

// Deduplicação da importação. OFX usa FITID (id único do banco). CSV não tem
// id, então usa CONTAGEM por assinatura data|valor|descrição: se o arquivo
// tem 2 compras idênticas no mesmo dia (ex.: dois lanches de R$ 10,00) e o
// app já tem 0, importa as duas; na reimportação (já tem 2), importa zero.
// Retorna { fresh, newIds, dup }.
export function dedupeTxs(txs, existingExpenses, importedFitids) {
  const seenIds = new Set(importedFitids || []);
  const sigOf = (t) => `${t.date}|${t.amount}|${normalizeDesc(t.desc).toLowerCase()}`;
  const avail = new Map();
  for (const t of existingExpenses) {
    const s = sigOf(t);
    avail.set(s, (avail.get(s) || 0) + 1);
  }
  const fresh = [];
  const newIds = [];
  let dup = 0;
  for (const t of txs) {
    if (t.fitid) {
      if (seenIds.has(t.fitid)) {
        dup++;
        continue;
      }
      seenIds.add(t.fitid);
      newIds.push(t.fitid);
      fresh.push(t);
      continue;
    }
    const s = sigOf(t);
    const c = avail.get(s) || 0;
    if (c > 0) {
      avail.set(s, c - 1);
      dup++;
      continue;
    }
    fresh.push(t);
  }
  return { fresh, newIds, dup };
}

// Fatura do cartão de crédito (tolerante: detecta separador e colunas pelo
// cabeçalho). Compras = saída; pagamentos/estornos são pulados.
// Retorna { txs, skipped, error? }.
export function parseFaturaCsv(text) {
  const lines = String(text).split(/\r?\n/);
  let headerIdx = -1;
  let cols = null;
  let sep = ";";
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const l = lines[i].toLowerCase();
    const s = l.includes(";") ? ";" : ",";
    const parts = l.split(s).map((c) => c.trim());
    if (parts.length >= 2 && parts.some((c) => c.includes("data")) && parts.some((c) => c.includes("valor"))) {
      headerIdx = i;
      cols = parts;
      sep = s;
      break;
    }
  }
  if (headerIdx === -1) {
    return { txs: [], skipped: 0, error: "Cabeçalho da fatura não encontrado (esperava colunas com 'data' e 'valor')." };
  }
  const iData = cols.findIndex((c) => c.includes("data"));
  const iVal = cols.findIndex((c) => c.includes("valor"));
  let iDesc = cols.findIndex((c) => /lan[çc]amento|descri|estabelecimento|movimenta/.test(c));
  if (iDesc === -1) iDesc = cols.findIndex((_, idx) => idx !== iData && idx !== iVal);

  const txs = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const parts = lines[i].split(sep);
    if (parts.length < 2) continue;
    const date = brDateToISO(parts[iData]);
    const amt = parseBrMoney(parts[iVal]);
    if (!date || isNaN(amt) || amt === 0) continue;
    const desc = normalizeDesc(iDesc >= 0 ? parts[iDesc] : "");
    // pagamentos da fatura e estornos não são gasto novo
    if (/pagamento|estorno|cr[ée]dito de/i.test(desc) || amt < 0) {
      skipped++;
      continue;
    }
    txs.push({ date, amount: r2(Math.abs(amt)), type: "out", desc: desc || "(sem descrição)", hist: "", fitid: "" });
  }
  return { txs, skipped };
}
