import React, { useEffect, useMemo, useState } from "react";
import { fmtBRL, fmtPct, fmtDate, fmtDateTime, daysUntil, todayISO } from "../format";
import { uid, KINDS, API_KINDS, INDEXERS, isAutoOption, withContribution } from "../model";
import { Modal, Field, NumInput, MoneyInput, RateInput, AttrEditor, AttrChips, DangerButton, Empty, InlinePrice } from "./ui";
import { LineChart } from "./charts";
import { isIrExempt, buildFixedCurve } from "../fixedIncome";

const HORIZONS = [
  { lbl: "Hoje", mo: 0 },
  { lbl: "1a", mo: 12 },
  { lbl: "3a", mo: 36 },
  { lbl: "5a", mo: 60 },
  { lbl: "10a", mo: 120 },
];
const HORIZON_LABEL = { 12: "1 ano", 36: "3 anos", 60: "5 anos", 120: "10 anos" };

export function rateLabel(indexer, rate) {
  if (!rate) return indexer || "—";
  switch (indexer) {
    case "% CDI": return `${rate}% CDI`;
    case "IPCA +": return `IPCA + ${rate}%`;
    case "Selic +": return `Selic + ${rate}%`;
    case "Prefixado": return `${rate}% a.a.`;
    case "Poupança": return "Poupança";
    default: return rate;
  }
}

export default function Investments({ data, update }) {
  const [tab, setTab] = useState("resumo");
  const [rfModal, setRfModal] = useState(null);
  const [rvModal, setRvModal] = useState(null);
  const [horizon, setHorizon] = useState(0); // meses de projeção; 0 = passado→hoje
  const [curve, setCurve] = useState(null); // { points, firstDate }

  // reconstrói o passado (séries reais do BCB) e projeta o futuro
  useEffect(() => {
    let alive = true;
    buildFixedCurve(data.fixed, horizon)
      .then((c) => alive && setCurve(c))
      .catch(() => alive && setCurve(null));
    return () => { alive = false; };
  }, [data.fixed, horizon]);

  const rf = useMemo(() => {
    let applied = 0, total = 0, net = 0;
    for (const f of data.fixed) {
      applied += f.applied ?? 0;
      total += f.currentValue ?? f.estValue ?? f.applied ?? 0;
      // líquido: valor manual vale como está; estimativa usa o líquido de IR/IOF
      net += f.currentValue ?? f.estNet ?? f.applied ?? 0;
    }
    return { applied, total, net, rend: total - applied, rendNet: net - applied };
  }, [data.fixed]);
  const rv = useMemo(() => {
    let cost = 0, pos = 0;
    for (const a of data.variable) {
      const c = (a.qty || 0) * (a.avgPrice || 0);
      cost += c;
      pos += (a.qty || 0) * (a.lastPrice ?? a.avgPrice ?? 0);
    }
    return { cost, pos, pl: pos - cost };
  }, [data.variable]);

  const saveRf = (item) => {
    update((d) => ({
      ...d,
      fixed: item.id && d.fixed.some((f) => f.id === item.id)
        ? d.fixed.map((f) => (f.id === item.id ? item : f))
        : [...d.fixed, { ...item, id: uid() }],
    }));
    setRfModal(null);
  };

  // aporte avulso: aplica mais dinheiro agora (salva os campos do form junto),
  // soma ao investido e lança uma saída em Despesas (o dinheiro sai do saldo)
  const aporteNow = (form, amount) => {
    const today = todayISO();
    update((d) => {
      const asset = withContribution({ ...form, id: form.id || uid() }, amount, today);
      const fixed = d.fixed.some((f) => f.id === asset.id)
        ? d.fixed.map((f) => (f.id === asset.id ? asset : f))
        : [...d.fixed, asset];
      const hasInv = d.categories.some((c) => c.id === "investimentos");
      const categories = hasInv ? d.categories : [...d.categories, { id: "investimentos", name: "Investimentos", color: "#22d3ee" }];
      const expense = {
        id: uid(), date: today, desc: `Aporte: ${form.name || "investimento"}`,
        catId: "investimentos", amount, type: "out", recurring: false, auto: false, aporte: true,
      };
      return { ...d, fixed, categories, expenses: [...d.expenses, expense] };
    });
    setRfModal(null);
  };
  const saveRv = (item) => {
    update((d) => ({
      ...d,
      variable: item.id && d.variable.some((f) => f.id === item.id)
        ? d.variable.map((f) => (f.id === item.id ? item : f))
        : [...d.variable, { ...item, id: uid() }],
    }));
    setRvModal(null);
  };

  return (
    <section className="section">
      {/* os cards de resumo acompanham a aba selecionada */}
      {tab === "resumo" && (
        <div className="summary-row">
          <div className="stat">
            <span className="stat-label">Patrimônio total</span>
            <span className="stat-value">{fmtBRL(rf.total + rv.pos)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Renda fixa</span>
            <span className="stat-value">{fmtBRL(rf.total)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Renda variável</span>
            <span className="stat-value">{fmtBRL(rv.pos)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Resultado geral</span>
            <span className={"stat-value " + (rf.rend + rv.pl >= 0 ? "pos" : "neg")}>
              {fmtBRL(rf.rend + rv.pl)}
              {rf.applied + rv.cost > 0 && <small> ({fmtPct(((rf.rend + rv.pl) / (rf.applied + rv.cost)) * 100)})</small>}
            </span>
          </div>
        </div>
      )}
      {tab === "rf" && (
        <div className="summary-row">
          <div className="stat">
            <span className="stat-label">Aplicado</span>
            <span className="stat-value">{fmtBRL(rf.applied)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Valor atual</span>
            <span className="stat-value">{fmtBRL(rf.total)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Resultado</span>
            <span className={"stat-value " + (rf.rend >= 0 ? "pos" : "neg")}>
              {fmtBRL(rf.rend)} {rf.applied > 0 && <small>({fmtPct((rf.rend / rf.applied) * 100)})</small>}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Resultado líq. est.</span>
            <span className={"stat-value " + (rf.rendNet >= 0 ? "pos" : "neg")}>{fmtBRL(rf.rendNet)}</span>
          </div>
        </div>
      )}
      {tab === "rv" && (
        <div className="summary-row">
          <div className="stat">
            <span className="stat-label">Custo</span>
            <span className="stat-value">{fmtBRL(rv.cost)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Posição</span>
            <span className="stat-value">{fmtBRL(rv.pos)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Resultado</span>
            <span className={"stat-value " + (rv.pl >= 0 ? "pos" : "neg")}>
              {fmtBRL(rv.pl)} {rv.cost > 0 && <small>({fmtPct((rv.pl / rv.cost) * 100)})</small>}
            </span>
          </div>
        </div>
      )}

      {tab === "resumo" && (() => {
        const rvNow = rv.pos;
        // curva reconstruída (RF via BCB) + RV mantida no valor atual;
        // fallback para os snapshots gravados se o BCB estiver indisponível
        let points = null, firstLabel = null;
        if (curve && curve.points.length >= 2) {
          points = curve.points.map((p) => ({ label: fmtDate(p.d), value: p.value + rvNow, future: p.future }));
          firstLabel = fmtDate(curve.firstDate);
        } else if (data.history.length >= 2) {
          points = data.history.slice(-120).map((h) => ({ label: fmtDate(h.d), value: h.total, future: false }));
          firstLabel = fmtDate(data.history[0].d);
        }
        if (!points) return null;
        let nowIdx = points.length - 1;
        for (let i = 0; i < points.length; i++) if (points[i].future) { nowIdx = i - 1; break; }
        nowIdx = Math.max(0, nowIdx);
        const nowVal = points[nowIdx].value;
        const lastVal = points[points.length - 1].value;
        // ganho REAL até hoje = valor atual − total investido (não conta aportes como ganho)
        const gainNow = rf.rend + rv.pl;
        // projeção: separa rendimento de novos aportes
        const futureContrib = curve ? Math.max(0, curve.principalHorizon - curve.principalNow) : 0;
        const projReturn = lastVal - nowVal - futureContrib;
        const gainPct = rf.applied + rv.cost > 0 ? (gainNow / (rf.applied + rv.cost)) * 100 : null;
        return (
          <div className="card">
            <div className="chart-head">
              <div className="patrim-head">
                <span className="stat-label">Evolução do patrimônio</span>
                <div className={"patrim-gain " + (gainNow >= 0 ? "pos" : "neg")} title="Valor atual menos tudo o que você investiu (não conta aportes como ganho)">
                  <span className="patrim-gain-arrow">{gainNow >= 0 ? "▲" : "▼"}</span>
                  {gainNow >= 0 ? "+" : ""}{fmtBRL(gainNow)}
                  {gainPct != null && <span className="patrim-gain-pct">({fmtPct(gainPct)})</span>}
                  <span className="patrim-since">ganho desde {firstLabel}</span>
                </div>
              </div>
              <div className="seg mini">
                {HORIZONS.map((hz) => (
                  <button key={hz.mo} className={"seg-btn" + (horizon === hz.mo ? " on" : "")} onClick={() => setHorizon(hz.mo)}>
                    {hz.lbl}
                  </button>
                ))}
              </div>
            </div>
            <LineChart points={points} />
            {horizon > 0 && curve && (
              <div className="proj-summary">
                <span>
                  Em {HORIZON_LABEL[horizon]}: <b>{fmtBRL(lastVal)}</b> — rendimento{" "}
                  <span className={projReturn >= 0 ? "pos" : "neg"}>{projReturn >= 0 ? "+" : ""}{fmtBRL(projReturn)}</span>
                  {futureContrib > 0 && <> · aportes +{fmtBRL(futureContrib)}</>}
                </span>
                <span className="proj-note">
                  estimativa mantendo as taxas atuais{futureContrib > 0 ? " e os aportes mensais" : ""}
                  {rvNow > 0 ? "; renda variável mantida no valor de hoje" : ""}.
                </span>
              </div>
            )}
          </div>
        );
      })()}

      <div className="section-head">
        <div className="seg">
          <button className={"seg-btn" + (tab === "resumo" ? " on" : "")} onClick={() => setTab("resumo")}>Resumo</button>
          <button className={"seg-btn" + (tab === "rf" ? " on" : "")} onClick={() => setTab("rf")}>Renda fixa</button>
          <button className={"seg-btn" + (tab === "rv" ? " on" : "")} onClick={() => setTab("rv")}>Renda variável</button>
        </div>
        {tab === "rf" && (
          <button
            className="primary-btn"
            onClick={() => setRfModal({ name: "", issuer: "", indexer: "% CDI", rate: "", applied: null, appliedDate: todayISO(), maturity: "", liquidity: "No vencimento", currentValue: null, monthly: null, monthlyDay: "", attrs: [], notes: "" })}
          >
            + Aplicação
          </button>
        )}
        {tab === "rv" && (
          <button
            className="primary-btn"
            onClick={() => setRvModal({ kind: "acao", ticker: "", underlying: "", expiration: "", name: "", qty: null, avgPrice: null, lastPrice: null, lastChange: null, lastUpdate: null, attrs: [], notes: "" })}
          >
            + Ativo
          </button>
        )}
      </div>

      {tab !== "rv" && (
        <>
        {tab === "resumo" && <div className="mini-head">Renda fixa</div>}
        <div className="card-grid">
          {data.fixed.length === 0 && <Empty>Nenhuma aplicação de renda fixa ainda.</Empty>}
          {data.fixed.map((f) => {
            const dias = daysUntil(f.maturity);
            // valor manual tem prioridade; senão usa a estimativa via BCB
            const isEst = f.currentValue == null && f.estValue != null;
            const val = f.currentValue ?? f.estValue;
            const grossRend = val != null && f.applied ? val - f.applied : null;
            const netVal = isEst && f.estNet != null ? f.estNet : null;
            const netRend = netVal != null && f.applied ? netVal - f.applied : null;
            const taxed = isEst && f.estNet != null && (f.estIr > 0 || f.estIof > 0);
            const pctOf = (x) => (f.applied > 0 ? fmtPct((x / f.applied) * 100) : "");
            // taxa efetiva anualizada (≈, só com histórico mínimo)
            const days = f.appliedDate ? Math.round((new Date(todayISO()) - new Date(f.appliedDate)) / 86400000) : 0;
            const aa = isEst && days >= 5 && f.estValue > 0 && f.applied > 0 ? (Math.pow(f.estValue / f.applied, 365 / days) - 1) * 100 : null;
            const aaStr = aa != null && isFinite(aa) && aa > 0 ? ` · ≈${aa.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% a.a.` : "";
            return (
              <button className="card asset-card" key={f.id} onClick={() => setRfModal(f)} title="Editar">
                <div className="card-top">
                  <span className="asset-name">{f.name || "(sem nome)"}</span>
                  <span className="badge">{rateLabel(f.indexer, f.rate)}</span>
                </div>
                {f.issuer && <div className="asset-sub">{f.issuer}</div>}
                <div className="asset-value" title={isEst ? "Valor bruto estimado via CDI/Selic/IPCA do Banco Central" : undefined}>
                  {isEst && "≈ "}
                  {fmtBRL(val ?? f.applied)}
                </div>
                {isEst && f.estNet != null ? (
                  taxed ? (
                    <div className="yields">
                      <div className="yield-row">
                        <span className="yield-lbl">Bruto</span>
                        <span className={grossRend >= 0 ? "pos" : "neg"}>{grossRend >= 0 ? "+" : ""}{fmtBRL(grossRend)} <small>({pctOf(grossRend)})</small></span>
                      </div>
                      <div className="yield-row">
                        <span className="yield-lbl">Líquido</span>
                        <span className={netRend >= 0 ? "pos" : "neg"}>{netRend >= 0 ? "+" : ""}{fmtBRL(netRend)} <small>({pctOf(netRend)})</small></span>
                      </div>
                      <div className="asset-tax">
                        se resgatar hoje: −IR {String(f.estIr).replace(".", ",")}%
                        {f.estIof > 0 && ` · −IOF ${String(f.estIof).replace(".", ",")}%`}
                        {aaStr}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={"asset-pl " + (grossRend >= 0 ? "pos" : "neg")}>
                        {grossRend >= 0 ? "+" : ""}{fmtBRL(grossRend)} <small>({pctOf(grossRend)})</small>
                      </div>
                      <div className="asset-tax">líquido = bruto · isento de IR{aaStr}</div>
                    </>
                  )
                ) : (
                  grossRend != null && (
                    <div className={"asset-pl " + (grossRend >= 0 ? "pos" : "neg")}>
                      {isEst && "≈ "}{grossRend >= 0 ? "+" : ""}{fmtBRL(grossRend)} <small>({pctOf(grossRend)})</small>
                    </div>
                  )
                )}
                <div className="asset-meta">
                  {f.maturity && (
                    <span className={dias != null && dias >= 0 && dias <= 30 ? "venc-alert" : undefined}>
                      Venc.: {fmtDate(f.maturity)}
                      {dias != null && dias >= 0 && <em> ({dias}d)</em>}
                    </span>
                  )}
                  {f.liquidity && <span>Liquidez: {f.liquidity}</span>}
                  {f.monthly > 0 && <span title="Aporte mensal automático">↻ aporte {fmtBRL(f.monthly)}/mês</span>}
                </div>
                <AttrChips attrs={f.attrs} />
              </button>
            );
          })}
        </div>
        </>
      )}

      {tab !== "rf" && (
        <>
        {tab === "resumo" && <div className="mini-head">Renda variável</div>}
        <div className="card-grid">
          {data.variable.length === 0 && <Empty>Nenhum ativo de renda variável ainda.</Empty>}
          {data.variable.map((a) => {
            const price = a.lastPrice ?? null;
            const total = (a.qty || 0) * (price ?? a.avgPrice ?? 0);
            const cost = (a.qty || 0) * (a.avgPrice || 0);
            const pl = total - cost;
            const manual = !API_KINDS.includes(a.kind) && !isAutoOption(a);
            return (
              <div className="card asset-card clickable" key={a.id} onClick={() => setRvModal(a)} title="Editar" role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setRvModal(a)}>
                <div className="card-top">
                  <span className="asset-name">{a.ticker ? a.ticker.toUpperCase() : a.name || "(sem nome)"}</span>
                  <span className="badge">{KINDS[a.kind] || a.kind}</span>
                </div>
                {isAutoOption(a) ? (
                  <div className="asset-sub">{a.underlying.toUpperCase()} · venc. {fmtDate(a.expiration)}{a.name ? ` · ${a.name}` : ""}</div>
                ) : (
                  a.name && a.ticker && <div className="asset-sub">{a.name}</div>
                )}
                <div className="price-row">
                  {manual ? (
                    <InlinePrice
                      value={a.lastPrice}
                      onSave={(v) =>
                        update((d) => ({
                          ...d,
                          variable: d.variable.map((x) =>
                            x.id === a.id ? { ...x, lastPrice: v, lastUpdate: new Date().toISOString() } : x
                          ),
                        }))
                      }
                    />
                  ) : (
                    <span className="asset-price">{fmtBRL(price)}</span>
                  )}
                  {a.lastChange != null && (
                    <span className={"chg " + (a.lastChange >= 0 ? "pos" : "neg")}>{fmtPct(a.lastChange)}</span>
                  )}
                </div>
                <div className="asset-value">{fmtBRL(total)}</div>
                {cost > 0 && (
                  <div className={"asset-pl " + (pl >= 0 ? "pos" : "neg")}>
                    {fmtBRL(pl)} <small>({fmtPct((pl / cost) * 100)})</small>
                  </div>
                )}
                <div className="asset-meta">
                  <span>{a.qty ?? 0} × {fmtBRL(a.avgPrice)}</span>
                  {a.lastUpdate && <span title="Última atualização">{fmtDateTime(a.lastUpdate)}</span>}
                </div>
                <AttrChips attrs={a.attrs} />
              </div>
            );
          })}
        </div>
        </>
      )}

      {rfModal && (
        <RfModal
          item={rfModal}
          onClose={() => setRfModal(null)}
          onSave={saveRf}
          onAporte={aporteNow}
          onDelete={rfModal.id ? () => { update((d) => ({ ...d, fixed: d.fixed.filter((f) => f.id !== rfModal.id) })); setRfModal(null); } : null}
        />
      )}
      {rvModal && (
        <RvModal
          item={rvModal}
          onClose={() => setRvModal(null)}
          onSave={saveRv}
          onDelete={rvModal.id ? () => { update((d) => ({ ...d, variable: d.variable.filter((f) => f.id !== rvModal.id) })); setRvModal(null); } : null}
        />
      )}
    </section>
  );
}

function RfModal({ item, onClose, onSave, onAporte, onDelete }) {
  const [form, setForm] = useState({ ...item });
  const [aporteAmt, setAporteAmt] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const valid = form.name.trim() && form.applied > 0;
  return (
    <Modal
      title={item.id ? "Editar aplicação" : "Nova aplicação (renda fixa)"}
      onClose={onClose}
      footer={
        <>
          {onDelete && <DangerButton label="Excluir" confirmLabel="Excluir mesmo?" onConfirm={onDelete} />}
          <div className="spacer" />
          <button className="ghost-btn" onClick={onClose}>Cancelar</button>
          <button className="primary-btn" disabled={!valid} onClick={() => onSave(form)}>Salvar</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Nome" grow>
          <input value={form.name} placeholder="Ex.: CDB Banco X 2027" onChange={(e) => set({ name: e.target.value })} autoFocus />
        </Field>
        <Field label="Emissor">
          <input value={form.issuer} placeholder="Ex.: Banco X" onChange={(e) => set({ issuer: e.target.value })} />
        </Field>
        <Field label="Indexador">
          <select value={form.indexer} onChange={(e) => set({ indexer: e.target.value })}>
            {INDEXERS.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </Field>
        <Field label="Taxa">
          <RateInput
            value={form.rate}
            suffix={form.indexer === "% CDI" ? "% CDI" : form.indexer === "IPCA +" ? "+ IPCA" : form.indexer === "Selic +" ? "+ Selic" : "%"}
            placeholder={form.indexer === "% CDI" ? "Ex.: 105" : form.indexer === "Selic +" ? "Ex.: 0,05" : "Ex.: 6,2"}
            onChange={(v) => set({ rate: v })}
          />
        </Field>
        <Field label="Valor aplicado (R$)">
          <MoneyInput value={form.applied} onChange={(v) => set({ applied: v })} />
        </Field>
        <Field label="Valor atual (R$, opcional)">
          <MoneyInput value={form.currentValue} onChange={(v) => set({ currentValue: v })} placeholder="—" />
        </Field>
        <Field label="Aplicado em">
          <input type="date" value={form.appliedDate || ""} onChange={(e) => set({ appliedDate: e.target.value })} />
        </Field>
        <Field label="Vencimento">
          <input type="date" value={form.maturity || ""} onChange={(e) => set({ maturity: e.target.value })} />
        </Field>
        <Field label="Liquidez">
          <select value={form.liquidity} onChange={(e) => set({ liquidity: e.target.value })}>
            {["No vencimento", "Diária", "D+1", "D+30", "D+90", "Outra"].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Aporte mensal (R$, opcional)">
          <MoneyInput value={form.monthly} onChange={(v) => set({ monthly: v })} placeholder="—" />
        </Field>
        <Field label="Dia do aporte">
          <input
            type="number"
            min="1"
            max="28"
            value={form.monthlyDay || ""}
            placeholder={form.appliedDate ? form.appliedDate.slice(8, 10) : "1"}
            onChange={(e) => set({ monthlyDay: e.target.value })}
          />
        </Field>
        <Field label="Atributos extras" grow>
          <AttrEditor attrs={form.attrs} onChange={(attrs) => set({ attrs })} />
        </Field>
        <Field label="Observações" grow>
          <textarea rows={2} value={form.notes || ""} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
      {form.monthly > 0 && (
        <p className="hint">
          Todo mês (dia {Math.min(Math.max(parseInt(form.monthlyDay, 10) || parseInt((form.appliedDate || "").slice(8, 10), 10) || 1, 1), 28)}) será lançada
          uma saída de {fmtBRL(form.monthly)} em Despesas (categoria Investimentos) e o valor
          será somado ao aplicado — como uma assinatura que sai do seu saldo.
        </p>
      )}
      {isIrExempt(form) ? (
        <p className="hint">IR: isento (LCI/LCA/incentivada detectada pelo nome).</p>
      ) : (
        <p className="hint">IR e IOF são calculados automaticamente pelo prazo — não precisa anotar.</p>
      )}
      {item.id && onAporte && (
        <div className="aporte-now">
          <span className="field-label">Aplicar mais dinheiro agora</span>
          <div className="aporte-now-row">
            <MoneyInput value={aporteAmt} onChange={setAporteAmt} placeholder="R$ 0,00" />
            <button className="primary-btn" disabled={!(aporteAmt > 0)} onClick={() => onAporte(form, aporteAmt)}>
              + Aportar
            </button>
          </div>
          <p className="hint">
            Reinvestimento avulso: soma ao valor investido (parcela de hoje) e lança uma
            saída em Despesas — o dinheiro sai do seu saldo. Salva também as alterações acima.
          </p>
        </div>
      )}
    </Modal>
  );
}

function RvModal({ item, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({ ...item });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const autoOpt = isAutoOption(form);
  const manual = !API_KINDS.includes(form.kind) && !autoOpt;
  // quantidade negativa é permitida (perna vendida de trava/spread)
  const valid = (form.ticker.trim() || form.name.trim()) && form.qty != null && form.qty !== 0;
  // detecta opção cadastrada como Ação (a cotação da ação inflaria o resultado)
  const looksLikeOption =
    API_KINDS.includes(form.kind) && /spread|call|put|trava|op[çc][ãa]o/i.test(`${form.name} ${form.notes || ""}`);
  const setKind = (kind) => set({ kind });
  return (
    <Modal
      title={item.id ? "Editar ativo" : "Novo ativo (renda variável)"}
      onClose={onClose}
      footer={
        <>
          {onDelete && <DangerButton label="Excluir" confirmLabel="Excluir mesmo?" onConfirm={onDelete} />}
          <div className="spacer" />
          <button className="ghost-btn" onClick={onClose}>Cancelar</button>
          <button className="primary-btn" disabled={!valid} onClick={() => onSave(form)}>Salvar</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Tipo">
          <select value={form.kind} onChange={(e) => setKind(e.target.value)}>
            {["acao", "fii", "cripto", "moeda", "opcao", "outro"].map((k) => (
              <option key={k} value={k}>{KINDS[k]}</option>
            ))}
          </select>
        </Field>
        <Field label={form.kind === "cripto" ? "ID CoinGecko" : form.kind === "moeda" ? "Par de moedas" : form.kind === "opcao" ? "Código do contrato" : "Ticker"}>
          <input
            value={form.ticker}
            placeholder={
              form.kind === "cripto" ? "Ex.: bitcoin"
              : form.kind === "moeda" ? "Ex.: USD-BRL"
              : form.kind === "opcao" ? "Ex.: PETRH328W2"
              : "Ex.: PETR4"
            }
            onChange={(e) => set({ ticker: e.target.value })}
            autoFocus
          />
        </Field>
        {form.kind === "opcao" && (
          <>
            <Field label="Ativo-objeto">
              <input value={form.underlying || ""} placeholder="Ex.: PETR4" onChange={(e) => set({ underlying: e.target.value })} />
            </Field>
            <Field label="Vencimento">
              <input type="date" value={form.expiration || ""} onChange={(e) => set({ expiration: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Nome (opcional)" grow>
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Quantidade">
          <NumInput value={form.qty} onChange={(v) => set({ qty: v })} placeholder="0" />
        </Field>
        <Field label="Preço médio (R$)">
          <MoneyInput value={form.avgPrice} onChange={(v) => set({ avgPrice: v })} />
        </Field>
        {manual && (
          <Field label="Preço atual (R$)">
            <MoneyInput value={form.lastPrice} onChange={(v) => set({ lastPrice: v, lastUpdate: new Date().toISOString() })} />
          </Field>
        )}
        <Field label="Atributos extras" grow>
          <AttrEditor attrs={form.attrs} onChange={(attrs) => set({ attrs })} />
        </Field>
        <Field label="Observações" grow>
          <textarea rows={2} value={form.notes || ""} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
      {looksLikeOption && (
        <p className="hint warn">
          Isso parece uma operação com opções. Se for, mude o tipo para “Opção” — como
          Ação, a cotação do papel (ex.: PETR4) seria usada como preço da sua posição.
        </p>
      )}
      {(form.kind === "acao" || form.kind === "fii") && (
        <p className="hint">Cotação automática via brapi.dev — configure o token em Configurações.</p>
      )}
      {form.kind === "moeda" && (
        <p className="hint">Cotação automática via AwesomeAPI — par no formato USD-BRL, EUR-BRL…</p>
      )}
      {form.kind === "cripto" && (
        <p className="hint">Cotação automática via CoinGecko — use o ID da moeda (ex.: bitcoin, ethereum, solana).</p>
      )}
      {form.kind === "opcao" && (
        autoOpt ? (
          <p className="hint">
            Prêmio puxado automaticamente da brapi (cadeia de opções do ativo-objeto no
            vencimento informado). Cada perna da trava é um registro: compre com quantidade
            positiva, venda com quantidade negativa — o resultado das pernas soma a trava.
          </p>
        ) : (
          <p className="hint">
            Preencha <b>código do contrato</b>, <b>ativo-objeto</b> e <b>vencimento</b> para
            cotação automática (funciona para PETR4 no plano grátis da brapi). Sem isso, o
            preço fica manual (campo tracejado no card). Perna vendida = quantidade negativa.
          </p>
        )
      )}
    </Modal>
  );
}
