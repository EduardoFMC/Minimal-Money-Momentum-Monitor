// Cotações: brapi.dev (ações/FIIs/opções da B3), CoinGecko (cripto) e
// AwesomeAPI (moedas), tudo em BRL.
import { httpGet } from "./backend";
import { API_KINDS, isAutoOption } from "./model";

export async function fetchStockQuotes(tickers, token) {
  if (!tickers.length) return {};
  const url =
    `https://brapi.dev/api/quote/${tickers.map(encodeURIComponent).join(",")}` +
    (token ? `?token=${encodeURIComponent(token)}` : "");
  const json = JSON.parse(await httpGet(url));
  const out = {};
  for (const r of json.results || []) {
    if (r && r.symbol && r.regularMarketPrice != null) {
      out[r.symbol.toUpperCase()] = {
        price: r.regularMarketPrice,
        change: r.regularMarketChangePercent ?? null,
        name: r.shortName || r.longName || null,
      };
    }
  }
  return out;
}

export async function fetchCryptoQuotes(ids) {
  if (!ids.length) return {};
  const url =
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids.map(encodeURIComponent).join(",")}` +
    `&vs_currencies=brl&include_24hr_change=true`;
  const json = JSON.parse(await httpGet(url));
  const out = {};
  for (const [id, v] of Object.entries(json)) {
    if (v && v.brl != null) out[id.toLowerCase()] = { price: v.brl, change: v.brl_24h_change ?? null };
  }
  return out;
}

// Opções da B3 via brapi. A API é indexada por ativo-objeto + vencimento,
// então agrupamos as posições e buscamos cada cadeia (chain) uma vez.
// Retorna { quotes: { CODIGO -> {price, strike, side} }, errors: [] }.
export async function fetchOptionQuotes(items, token) {
  const groups = new Map();
  for (const i of items) {
    if (!isAutoOption(i)) continue;
    const key = `${i.underlying.toUpperCase()}|${i.expiration}`;
    if (!groups.has(key)) groups.set(key, { underlying: i.underlying.toUpperCase(), expiration: i.expiration });
  }
  const list = [...groups.values()];
  const quotes = {};
  const errors = [];
  const results = await Promise.allSettled(
    list.map(async (g) => {
      const url =
        `https://brapi.dev/api/v2/options/chain?underlying=${encodeURIComponent(g.underlying)}` +
        `&expirationDate=${encodeURIComponent(g.expiration)}` +
        (token ? `&token=${encodeURIComponent(token)}` : "");
      const json = JSON.parse(await httpGet(url));
      for (const s of json.series || []) {
        if (s && s.symbol && s.close != null) {
          quotes[s.symbol.toUpperCase()] = { price: s.close, strike: s.strike, side: s.side };
        }
      }
    })
  );
  results.forEach((r, idx) => {
    if (r.status === "rejected") errors.push(`Opções ${list[idx].underlying}: ${r.reason?.message || r.reason}`);
  });
  return { quotes, errors };
}

// Moedas via AwesomeAPI (ex.: USD-BRL, EUR-BRL). Sem token.
export async function fetchCurrencyQuotes(pairs) {
  if (!pairs.length) return {};
  const url = `https://economia.awesomeapi.com.br/json/last/${pairs.map(encodeURIComponent).join(",")}`;
  const json = JSON.parse(await httpGet(url));
  const out = {};
  for (const v of Object.values(json)) {
    if (v && v.bid != null && v.code && v.codein) {
      out[`${v.code}-${v.codein}`.toUpperCase()] = {
        price: parseFloat(v.bid),
        change: v.pctChange != null ? parseFloat(v.pctChange) : null,
        name: v.name || null,
      };
    }
  }
  return out;
}

// Atualiza lastPrice/lastChange/lastUpdate de uma lista de ativos.
// Retorna { items, errors } — items é uma nova lista.
export async function refreshItems(items, brapiToken) {
  const stocks = [...new Set(items.filter((i) => (i.kind === "acao" || i.kind === "fii") && i.ticker).map((i) => i.ticker.toUpperCase()))];
  const cryptos = [...new Set(items.filter((i) => i.kind === "cripto" && i.ticker).map((i) => i.ticker.toLowerCase()))];
  const currencies = [...new Set(items.filter((i) => i.kind === "moeda" && i.ticker).map((i) => i.ticker.toUpperCase()))];

  const options = items.filter(isAutoOption);

  const errors = [];
  let stockQ = {};
  let cryptoQ = {};
  let currencyQ = {};
  let optionQ = {};
  const [rs, rc, rm, ro] = await Promise.allSettled([
    fetchStockQuotes(stocks, brapiToken),
    fetchCryptoQuotes(cryptos),
    fetchCurrencyQuotes(currencies),
    fetchOptionQuotes(options, brapiToken),
  ]);
  if (rs.status === "fulfilled") stockQ = rs.value;
  else if (stocks.length) errors.push("Ações/FIIs: " + rs.reason.message);
  if (rc.status === "fulfilled") cryptoQ = rc.value;
  else if (cryptos.length) errors.push("Cripto: " + rc.reason.message);
  if (rm.status === "fulfilled") currencyQ = rm.value;
  else if (currencies.length) errors.push("Moedas: " + rm.reason.message);
  if (ro.status === "fulfilled") {
    optionQ = ro.value.quotes;
    errors.push(...ro.value.errors);
  } else if (options.length) errors.push("Opções: " + ro.reason.message);

  const now = new Date().toISOString();
  const updated = items.map((i) => {
    if (isAutoOption(i)) {
      const q = optionQ[i.ticker.toUpperCase()];
      if (!q) return i;
      return { ...i, lastPrice: q.price, lastChange: null, lastUpdate: now };
    }
    if (!API_KINDS.includes(i.kind) || !i.ticker) return i;
    const q =
      i.kind === "cripto" ? cryptoQ[i.ticker.toLowerCase()]
      : i.kind === "moeda" ? currencyQ[i.ticker.toUpperCase()]
      : stockQ[i.ticker.toUpperCase()];
    if (!q) return i;
    const next = { ...i, lastPrice: q.price, lastChange: q.change, lastUpdate: now };
    // aproveita a API para preencher o nome do ativo quando estiver vazio
    if (!i.name && q.name) next.name = q.name;
    return next;
  });
  return { items: updated, errors };
}

export function hasApiItems(items) {
  return items.some((i) => (API_KINDS.includes(i.kind) && i.ticker) || isAutoOption(i));
}
