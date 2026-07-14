// Parser de extrato OFX (formato exportado pelo Inter e pela maioria dos
// bancos) + categorização automática por palavras-chave.

export function parseOfx(text) {
  const txs = [];
  const blocks = String(text).split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const body = raw.split(/<\/STMTTRN>/i)[0];
    const get = (tag) => {
      const m = body.match(new RegExp("<" + tag + ">\\s*([^<\\r\\n]*)", "i"));
      return m ? m[1].trim() : "";
    };
    const dt = get("DTPOSTED").slice(0, 8); // AAAAMMDD (ignora hora/fuso)
    const amt = parseFloat(get("TRNAMT").replace(",", "."));
    const desc = get("MEMO") || get("NAME") || "(sem descrição)";
    const fitid = get("FITID");
    if (dt.length !== 8 || isNaN(amt) || amt === 0) continue;
    txs.push({
      date: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
      amount: Math.round(Math.abs(amt) * 100) / 100,
      type: amt < 0 ? "out" : "in",
      desc,
      fitid,
    });
  }
  return txs;
}

const RULES = [
  [/uber|99 ?(app|pop)|taxi|cabify|metr[oô]|onibus|ônibus|\bbrt\b|estacionamento|\bposto\b|combust|gasolina|ipiranga|shell\b|pedagio|pedágio/i, "transporte"],
  [/ifood|rappi|restaurante|lanchonete|pizzaria|pizza|burguer|burger|hamburg|padaria|caf[eé]\b|mcdonald|\bbk\b|subway|churrasc/i, "alimentacao"],
  [/mercado|supermerc|carrefour|assai|assaí|atacad|extra\b|p[aã]o de a[çc][uú]car|hortifruti|sacol[aã]o|hipermercado/i, "mercado"],
  [/netflix|spotify|prime|disney|hbo|\bmax\b|youtube|premium|deezer|icloud|google (one|storage)|ps ?plus|game ?pass|crunchyroll|assinatura/i, "assinaturas"],
  [/farm[aá]cia|drogaria|droga ?(raia|sil)|pacheco|panvel|laborat[oó]rio|cl[ií]nica|hospital|consulta|dentista|psic[oó]log/i, "saude"],
  [/aluguel|condom[ií]nio|energia|\bluz\b|cemig|enel|copel|light\b|sanea|[aá]gua|claro|vivo|tim\b|\boi\b|internet|g[aá]s|iptu/i, "moradia"],
  [/cinema|ingresso|show|steam|epic ?games|nintendo|playstation|xbox|\bbar\b|cerveja|\bpub\b|festa/i, "lazer"],
  [/curso|udemy|alura|faculdade|escola|livraria|livro|mensalidade escolar/i, "educacao"],
  [/sal[aá]rio|remunera[çc][aã]o|pagamento de sal|folha de pagamento/i, "salario"],
];

export function guessCategory(desc, cats) {
  for (const [re, id] of RULES) {
    if (re.test(desc) && cats.some((c) => c.id === id)) return id;
  }
  return cats.some((c) => c.id === "outros") ? "outros" : cats[0]?.id || "";
}
