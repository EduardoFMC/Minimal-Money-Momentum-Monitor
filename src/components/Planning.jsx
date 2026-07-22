import React, { useEffect, useMemo, useState } from "react";
import { fmtBRL, fmtPct, todayISO, addMonths, monthLabel } from "../format";
import { Field, MoneyInput } from "./ui";
import { LineChart } from "./charts";
import { FREQS, freqFactor, avgMonthlySpend, avgMonthlyByCategory, simulatePlan, simulateScenarios, monthsToLabel } from "../plan";
import { currentMarketRates } from "../fixedIncome";
import { parseNum } from "../format";

// taxa ponderada da carteira de renda fixa (% CDI -> cdiAA * pct)
function portfolioRfAA(fixed, cdiAA) {
  if (!cdiAA) return null;
  let wsum = 0, w = 0;
  for (const f of fixed) {
    const applied = f.applied ?? 0;
    if (!(applied > 0)) continue;
    const rate = parseNum(f.rate);
    let aa = null;
    if (f.indexer === "% CDI" && rate > 0) aa = (cdiAA * rate) / 100;
    else if (f.indexer === "Selic +") aa = cdiAA + (isNaN(rate) ? 0 : rate);
    if (aa != null) {
      wsum += aa * applied;
      w += applied;
    }
  }
  return w > 0 ? wsum / w : null;
}

export default function Planning({ data, update }) {
  const plan = data.settings.plan || {};
  const [market, setMarket] = useState(null); // { cdiAA, ipca12 }

  useEffect(() => {
    let alive = true;
    currentMarketRates().then((m) => alive && setMarket(m)).catch(() => {});
    return () => { alive = false; };
  }, []);

  const setPlan = (patch) =>
    update((d) => ({ ...d, settings: { ...d.settings, plan: { ...d.settings.plan, ...patch } } }));

  // ===== valores efetivos (config salva ?? pré-preenchimento com dados reais) =====
  const p0rf = useMemo(
    () => data.fixed.reduce((s, f) => s + (f.currentValue ?? f.estValue ?? f.applied ?? 0), 0),
    [data.fixed]
  );
  const p0rv = useMemo(
    () => data.variable.reduce((s, a) => s + (a.qty || 0) * (a.lastPrice ?? a.avgPrice ?? 0), 0),
    [data.variable]
  );
  const custoPrefill = useMemo(() => avgMonthlySpend(data.expenses, todayISO()), [data.expenses]);
  const aportePrefill = useMemo(() => {
    const m = data.fixed.reduce((s, f) => s + (Number(f.monthly) || 0), 0);
    return m > 0 ? m : null;
  }, [data.fixed]);
  const carteiraAA = market ? portfolioRfAA(data.fixed, market.cdiAA) : null;

  const aporte = plan.aporte ?? aportePrefill ?? 0;
  const freq = plan.freq || "mensal";
  const pctRf = plan.pctRf ?? 70;
  const custo = plan.custo ?? custoPrefill ?? 0;
  const retirada = plan.retirada ?? 4;
  const rfAA = plan.rfAA ?? carteiraAA ?? market?.cdiAA ?? 13.5;
  const rvAA = plan.rvAA ?? 10;
  const ipca = plan.ipca ?? market?.ipca12 ?? 4.5;
  const real = plan.real !== false;
  const idade = plan.idade ?? null;

  const aporteMensal = aporte * freqFactor(freq);

  const cfg = {
    p0rf, p0rv, aporteMensal, pctRf,
    rfAA, rvAA, ipcaAA: real ? ipca : 0,
    custoMensal: custo, retiradaPct: retirada,
  };

  const scen = useMemo(() => (custo > 0 ? simulateScenarios(cfg) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p0rf, p0rv, aporteMensal, pctRf, rfAA, rvAA, ipca, real, custo, retirada]);

  // "E se eu gastar menos?" — corte de gasto age dos DOIS lados: reduz o
  // custo de vida (meta menor) e vira aporte extra (chega mais rápido)
  const eco = Math.min(plan.eco ?? 0, Math.max(0, custo - 100));
  const ecoSim = useMemo(
    () => (custo > 0 && eco > 0 ? simulatePlan({ ...cfg, custoMensal: custo - eco, aporteMensal: aporteMensal + eco }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p0rf, p0rv, aporteMensal, pctRf, rfAA, rvAA, ipca, real, custo, retirada, eco]
  );
  const topCats = useMemo(() => avgMonthlyByCategory(data.expenses, todayISO()).slice(0, 3), [data.expenses]);
  const catName = (id) => data.categories.find((c) => c.id === id)?.name || "Sem categoria";
  const catColor = (id) => data.categories.find((c) => c.id === id)?.color || "#888";

  const base = scen?.base;
  const total0 = p0rf + p0rv;
  const progresso = base && isFinite(base.fireNumber) && base.fireNumber > 0 ? Math.min(100, (total0 / base.fireNumber) * 100) : null;
  const passivaHoje = (total0 * retirada) / 100 / 12;

  // pontos do gráfico: até o alcance + 2 anos (ou 40 anos), amostrado
  const chart = useMemo(() => {
    if (!base) return null;
    const horizon = base.reachedMonth != null ? Math.min(base.months.length - 1, base.reachedMonth + 24) : Math.min(480, base.months.length - 1);
    const step = Math.max(1, Math.ceil(horizon / 70));
    const pts = [];
    const startYm = todayISO().slice(0, 7);
    for (let m = 0; m <= horizon; m += step) {
      const e = base.months[m];
      const ym = addMonths(startYm, m);
      pts.push({ label: `${ym.slice(5, 7)}/${ym.slice(0, 4)}`, value: e.total, future: m > 0 });
    }
    return pts;
  }, [base]);

  const reachedDate = base?.reachedMonth != null ? monthLabel(addMonths(todayISO().slice(0, 7), base.reachedMonth)) : null;
  const finalSplit = base?.reachedMonth != null ? base.months[base.reachedMonth] : null;

  const rfChips = [
    market?.cdiAA != null && { label: `CDI hoje (${market.cdiAA.toFixed(1).replace(".", ",")}%)`, v: market.cdiAA },
    carteiraAA != null && { label: `Minha carteira (${carteiraAA.toFixed(1).replace(".", ",")}%)`, v: carteiraAA },
    market?.cdiAA != null && { label: "110% CDI", v: market.cdiAA * 1.1 },
    market?.ipca12 != null && { label: "IPCA+6%", v: market.ipca12 + 6 },
  ].filter(Boolean);

  const num = (v) => (v == null || v === "" ? "" : v);

  return (
    <section className="section">
      <div className="summary-row">
        <div className="stat">
          <span className="stat-label">Patrimônio hoje</span>
          <span className="stat-value">{fmtBRL(total0)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Meta (independência)</span>
          <span className="stat-value">{base && isFinite(base.fireNumber) ? fmtBRL(base.fireNumber) : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Progresso</span>
          <span className="stat-value">{progresso != null ? fmtPct(progresso, false) : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Renda passiva hoje</span>
          <span className="stat-value">{fmtBRL(passivaHoje)}<small>/mês</small></span>
        </div>
      </div>

      {progresso != null && (
        <div className="progress-track" title={`${fmtBRL(total0)} de ${fmtBRL(base.fireNumber)}`}>
          <div className="progress-fill" style={{ width: `${progresso}%` }} />
        </div>
      )}

      {/* ===== O resultado ===== */}
      <div className="card plan-answer">
        {custo <= 0 ? (
          <p className="hint">Preencha seu custo de vida mensal abaixo para calcular.</p>
        ) : base.reachedMonth == null ? (
          <>
            <div className="plan-headline neg">Não alcançado em 80 anos com esse plano</div>
            <p className="hint">Aumente o aporte, o retorno esperado ou reduza o custo de vida.</p>
          </>
        ) : (
          <>
            <div className="plan-headline">
              Independência em <b>{monthsToLabel(base.reachedMonth)}</b>
              <span className="plan-when">
                {" "}({reachedDate}{idade ? `, aos ${Math.round(idade + base.reachedMonth / 12)} anos` : ""})
              </span>
            </div>
            <p className="plan-sub">
              Com {fmtBRL(base.fireNumber)} investidos, a taxa de retirada de {String(retirada).replace(".", ",")}% ao ano
              banca {fmtBRL((base.fireNumber * retirada) / 100 / 12)}/mês sem depender de trabalho
              {real ? " — já em valores de hoje (inflação descontada)" : ""}.
            </p>
            {finalSplit && (
              <p className="plan-sub muted-line">
                Composição na chegada: renda fixa {fmtBRL(finalSplit.rf)} · renda variável {fmtBRL(finalSplit.rv)}
              </p>
            )}
          </>
        )}
        {chart && custo > 0 && <LineChart points={chart} height={110} refValue={isFinite(base.fireNumber) ? base.fireNumber : null} refLabel="meta" />}
        {scen && custo > 0 && (
          <div className="scen-row">
            <span className="scen" title="Renda fixa −1pp e variável −3pp">
              Conservador: <b>{monthsToLabel(scen.conservador.reachedMonth) ?? ">80a"}</b>
            </span>
            <span className="scen on">
              Cenário atual: <b>{monthsToLabel(base.reachedMonth) ?? ">80a"}</b>
            </span>
            <span className="scen" title="Renda fixa +1pp e variável +3pp">
              Otimista: <b>{monthsToLabel(scen.otimista.reachedMonth) ?? ">80a"}</b>
            </span>
          </div>
        )}
      </div>

      {/* ===== O plano ===== */}
      <div className="card">
        <h4>O plano</h4>
        <div className="form-grid">
          <Field label="Aporte (R$)">
            <MoneyInput value={aporte || null} onChange={(v) => setPlan({ aporte: v })} />
          </Field>
          <Field label="Frequência">
            <select value={freq} onChange={(e) => setPlan({ freq: e.target.value })}>
              {FREQS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </Field>
          <Field label={`Divisão: ${pctRf}% fixa · ${100 - pctRf}% variável`} grow>
            <input
              type="range" min="0" max="100" step="5" value={pctRf}
              onChange={(e) => setPlan({ pctRf: Number(e.target.value) })}
            />
          </Field>
          <Field label="Custo de vida (R$/mês)">
            <MoneyInput value={custo || null} onChange={(v) => setPlan({ custo: v })} />
          </Field>
          <Field label="Taxa de retirada (% a.a.)">
            <input
              type="number" min="2" max="10" step="0.5" value={num(retirada)}
              onChange={(e) => setPlan({ retirada: Number(e.target.value) || 4 })}
            />
          </Field>
          <Field label="Sua idade (opcional)">
            <input
              type="number" min="10" max="100" value={num(idade)}
              placeholder="—"
              onChange={(e) => setPlan({ idade: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </Field>
        </div>
        {custoPrefill != null && plan.custo == null && (
          <p className="hint">Custo de vida pré-preenchido com a média das suas despesas reais dos últimos meses ({fmtBRL(custoPrefill)}).</p>
        )}
        <p className="hint">
          Aporte equivalente: <b>{fmtBRL(aporteMensal)}/mês</b> — {fmtBRL(aporteMensal * (pctRf / 100))} em renda fixa,{" "}
          {fmtBRL(aporteMensal * ((100 - pctRf) / 100))} em variável.
        </p>
      </div>

      {/* ===== Ligado às Despesas: e se eu gastar menos? ===== */}
      {custo > 0 && (
        <div className="card">
          <h4>E se eu gastar menos?</h4>
          {topCats.length > 0 && (
            <div className="eco-cats">
              <span className="hint">Seus maiores gastos (média mensal real):</span>
              {topCats.map((c) => (
                <span className="chip" key={c.catId}>
                  <span className="dot" style={{ background: catColor(c.catId) }} /> {catName(c.catId)}{" "}
                  <b>{fmtBRL(c.avg)}</b>
                </span>
              ))}
            </div>
          )}
          <Field label={`Cortar ${fmtBRL(eco)}/mês dos gastos`} grow>
            <input
              type="range"
              min="0"
              max={Math.max(0, Math.floor((custo * 0.6) / 50) * 50)}
              step="50"
              value={eco}
              onChange={(e) => setPlan({ eco: Number(e.target.value) })}
            />
          </Field>
          {eco > 0 && ecoSim ? (
            <p className="plan-sub">
              Cortando {fmtBRL(eco)}/mês (vira aporte e reduz a meta para {fmtBRL(ecoSim.fireNumber)}):
              independência em <b className="pos">{monthsToLabel(ecoSim.reachedMonth) ?? ">80 anos"}</b>
              {base?.reachedMonth != null && ecoSim.reachedMonth != null && ecoSim.reachedMonth < base.reachedMonth && (
                <> — <b className="pos">{monthsToLabel(base.reachedMonth - ecoSim.reachedMonth)} antes</b> do plano atual</>
              )}
              {base?.reachedMonth == null && ecoSim.reachedMonth != null && <> — antes era inalcançável</>}
              .
            </p>
          ) : (
            <p className="hint">
              Arraste para simular: cada real economizado conta em dobro — diminui o
              patrimônio necessário E acelera os aportes.
            </p>
          )}
        </div>
      )}

      {/* ===== Premissas ===== */}
      <div className="card">
        <h4>Premissas de retorno</h4>
        <div className="form-grid">
          <Field label="Renda fixa (% a.a. bruto)">
            <input
              type="number" step="0.1" value={num(Math.round(rfAA * 10) / 10)}
              onChange={(e) => setPlan({ rfAA: Number(e.target.value) })}
            />
          </Field>
          <Field label="Renda variável (% a.a.)">
            <input
              type="number" step="0.5" value={num(rvAA)}
              onChange={(e) => setPlan({ rvAA: Number(e.target.value) })}
            />
          </Field>
          <Field label="Inflação (IPCA % a.a.)">
            <input
              type="number" step="0.1" value={num(Math.round(ipca * 10) / 10)}
              onChange={(e) => setPlan({ ipca: Number(e.target.value) })}
            />
          </Field>
          <label className="check">
            <input type="checkbox" checked={real} onChange={(e) => setPlan({ real: e.target.checked })} />
            Descontar inflação (recomendado — resultado em R$ de hoje)
          </label>
        </div>
        {rfChips.length > 0 && (
          <div className="chip-row">
            {rfChips.map((c, i) => (
              <button key={i} className="ghost-btn chip-btn" onClick={() => setPlan({ rfAA: Math.round(c.v * 10) / 10 })}>
                {c.label}
              </button>
            ))}
          </div>
        )}
        <p className="hint">
          Taxas puxadas do Banco Central agora{market?.cdiAA != null ? ` (CDI ≈ ${market.cdiAA.toFixed(2).replace(".", ",")}% a.a., IPCA 12m ≈ ${market?.ipca12?.toFixed(2).replace(".", ",")}%)` : "…"}.
          Renda fixa simulada líquida de IR (15%); renda variável bruta (IR só na venda).
          Simulação é estimativa, não garantia — o futuro pode ser bem diferente.
        </p>
      </div>
    </section>
  );
}
