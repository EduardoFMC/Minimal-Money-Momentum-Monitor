import React, { useMemo, useState } from "react";
import { fmtBRL, fmtPct, fmtDate, fmtDateTime, daysUntil, todayISO } from "../format";
import { uid, KINDS, API_KINDS, INDEXERS } from "../model";
import { Modal, Field, NumInput, MoneyInput, AttrEditor, AttrChips, DangerButton, Empty, InlinePrice } from "./ui";
import { LineChart } from "./charts";

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

const OPTION_ATTR_SUGGESTIONS = [
  { k: "Ativo-objeto", v: "" },
  { k: "Strike", v: "" },
  { k: "Vencimento", v: "" },
  { k: "Estratégia", v: "" },
];

export default function Investments({ data, update }) {
  const [tab, setTab] = useState("rf");
  const [rfModal, setRfModal] = useState(null);
  const [rvModal, setRvModal] = useState(null);

  const rfTotal = useMemo(
    () => data.fixed.reduce((s, f) => s + (f.currentValue ?? f.estValue ?? f.applied ?? 0), 0),
    [data.fixed]
  );
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
      <div className="summary-row">
        <div className="stat">
          <span className="stat-label">Renda fixa</span>
          <span className="stat-value">{fmtBRL(rfTotal)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Renda variável</span>
          <span className="stat-value">{fmtBRL(rv.pos)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Resultado RV</span>
          <span className={"stat-value " + (rv.pl >= 0 ? "pos" : "neg")}>
            {fmtBRL(rv.pl)} {rv.cost > 0 && <small>({fmtPct((rv.pl / rv.cost) * 100)})</small>}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Total</span>
          <span className="stat-value">{fmtBRL(rfTotal + rv.pos)}</span>
        </div>
      </div>

      {data.history.length >= 2 && (
        <div className="card">
          <h4>
            Patrimônio
            {(() => {
              const first = data.history[0];
              const last = data.history[data.history.length - 1];
              const delta = last.total - first.total;
              return (
                <span className={"h4-extra " + (delta >= 0 ? "pos" : "neg")}>
                  {fmtBRL(delta)} desde {fmtDate(first.d)}
                </span>
              );
            })()}
          </h4>
          <LineChart points={data.history.slice(-120).map((h) => ({ label: fmtDate(h.d), value: h.total }))} />
        </div>
      )}

      <div className="section-head">
        <div className="seg">
          <button className={"seg-btn" + (tab === "rf" ? " on" : "")} onClick={() => setTab("rf")}>Renda fixa</button>
          <button className={"seg-btn" + (tab === "rv" ? " on" : "")} onClick={() => setTab("rv")}>Renda variável</button>
        </div>
        {tab === "rf" ? (
          <button
            className="primary-btn"
            onClick={() => setRfModal({ name: "", issuer: "", indexer: "% CDI", rate: "", applied: null, appliedDate: todayISO(), maturity: "", liquidity: "No vencimento", currentValue: null, attrs: [], notes: "" })}
          >
            + Aplicação
          </button>
        ) : (
          <button
            className="primary-btn"
            onClick={() => setRvModal({ kind: "acao", ticker: "", name: "", qty: null, avgPrice: null, lastPrice: null, lastChange: null, lastUpdate: null, attrs: [], notes: "" })}
          >
            + Ativo
          </button>
        )}
      </div>

      {tab === "rf" ? (
        <div className="card-grid">
          {data.fixed.length === 0 && <Empty>Nenhuma aplicação de renda fixa ainda.</Empty>}
          {data.fixed.map((f) => {
            const dias = daysUntil(f.maturity);
            // valor manual tem prioridade; senão usa a estimativa via BCB
            const isEst = f.currentValue == null && f.estValue != null;
            const val = f.currentValue ?? f.estValue;
            const rend = val != null && f.applied ? val - f.applied : null;
            return (
              <button className="card asset-card" key={f.id} onClick={() => setRfModal(f)} title="Editar">
                <div className="card-top">
                  <span className="asset-name">{f.name || "(sem nome)"}</span>
                  <span className="badge">{rateLabel(f.indexer, f.rate)}</span>
                </div>
                {f.issuer && <div className="asset-sub">{f.issuer}</div>}
                <div className="asset-value" title={isEst ? "Estimativa bruta via CDI/Selic/IPCA do Banco Central" : undefined}>
                  {isEst && "≈ "}
                  {fmtBRL(val ?? f.applied)}
                </div>
                {rend != null && (
                  <div className={"asset-pl " + (rend >= 0 ? "pos" : "neg")}>
                    {isEst && "≈ "}
                    {fmtBRL(rend)} {f.applied > 0 && <small>({fmtPct((rend / f.applied) * 100)})</small>}
                  </div>
                )}
                {isEst && f.estNet != null && (
                  <div className="asset-net">
                    líq. ≈ {fmtBRL(f.estNet)}
                    {f.estIr > 0 ? ` · IR ${String(f.estIr).replace(".", ",")}%` : " · isento de IR"}
                  </div>
                )}
                <div className="asset-meta">
                  {f.maturity && (
                    <span>
                      Venc.: {fmtDate(f.maturity)}
                      {dias != null && dias >= 0 && <em> ({dias}d)</em>}
                    </span>
                  )}
                  {f.liquidity && <span>Liquidez: {f.liquidity}</span>}
                </div>
                <AttrChips attrs={f.attrs} />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="card-grid">
          {data.variable.length === 0 && <Empty>Nenhum ativo de renda variável ainda.</Empty>}
          {data.variable.map((a) => {
            const price = a.lastPrice ?? null;
            const total = (a.qty || 0) * (price ?? a.avgPrice ?? 0);
            const cost = (a.qty || 0) * (a.avgPrice || 0);
            const pl = total - cost;
            const manual = !API_KINDS.includes(a.kind);
            return (
              <div className="card asset-card clickable" key={a.id} onClick={() => setRvModal(a)} title="Editar" role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setRvModal(a)}>
                <div className="card-top">
                  <span className="asset-name">{a.ticker ? a.ticker.toUpperCase() : a.name || "(sem nome)"}</span>
                  <span className="badge">{KINDS[a.kind] || a.kind}</span>
                </div>
                {a.name && a.ticker && <div className="asset-sub">{a.name}</div>}
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
      )}

      {rfModal && (
        <RfModal
          item={rfModal}
          onClose={() => setRfModal(null)}
          onSave={saveRf}
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

function RfModal({ item, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({ ...item });
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
          <input
            value={form.rate}
            placeholder={form.indexer === "% CDI" ? "Ex.: 105" : form.indexer === "Selic +" ? "Ex.: 0,05" : "Ex.: 6,2"}
            onChange={(e) => set({ rate: e.target.value })}
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
        <Field label="Atributos extras" grow>
          <AttrEditor attrs={form.attrs} onChange={(attrs) => set({ attrs })} />
        </Field>
        <Field label="Observações" grow>
          <textarea rows={2} value={form.notes || ""} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function RvModal({ item, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({ ...item });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const manual = !API_KINDS.includes(form.kind);
  // quantidade negativa é permitida (perna vendida de trava/spread)
  const valid = (form.ticker.trim() || form.name.trim()) && form.qty != null && form.qty !== 0;
  // detecta opção cadastrada como Ação (a cotação da ação inflaria o resultado)
  const looksLikeOption =
    !manual && /spread|call|put|trava|op[çc][ãa]o/i.test(`${form.name} ${form.notes || ""}`);
  const setKind = (kind) => {
    const patch = { kind };
    if (kind === "opcao" && (!form.attrs || form.attrs.length === 0)) patch.attrs = OPTION_ATTR_SUGGESTIONS;
    set(patch);
  };
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
        <Field label={form.kind === "cripto" ? "ID CoinGecko" : form.kind === "moeda" ? "Par de moedas" : "Ticker"}>
          <input
            value={form.ticker}
            placeholder={
              form.kind === "cripto" ? "Ex.: bitcoin"
              : form.kind === "moeda" ? "Ex.: USD-BRL"
              : form.kind === "opcao" ? "Ex.: PETRE285"
              : "Ex.: PETR4"
            }
            onChange={(e) => set({ ticker: e.target.value })}
            autoFocus
          />
        </Field>
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
      {!manual && form.kind !== "cripto" && (
        <p className="hint">Cotação automática via brapi.dev — configure o token em Configurações.</p>
      )}
      {form.kind === "opcao" && (
        <p className="hint">
          Opções não têm cotação automática: atualize o preço direto no card.
          Quantidade negativa = perna vendida (ex.: numa trava, compre 200 e venda −200).
          Um spread também pode ser um único registro com o prêmio líquido como preço médio.
        </p>
      )}
      {form.kind === "cripto" && (
        <p className="hint">Cotação automática via CoinGecko — use o ID da moeda (ex.: bitcoin, ethereum, solana).</p>
      )}
    </Modal>
  );
}
