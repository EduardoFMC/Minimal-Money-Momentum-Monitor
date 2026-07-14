import React, { useState } from "react";
import { fmtBRL, fmtPct, fmtDateTime } from "../format";
import { uid, KINDS, API_KINDS } from "../model";
import { Modal, Field, MoneyInput, AttrEditor, AttrChips, DangerButton, Empty, InlinePrice } from "./ui";

const WATCH_KINDS = ["acao", "fii", "cripto", "moeda", "rendafixa", "outro"];

export default function Monitoring({ data, update }) {
  const [modal, setModal] = useState(null);

  const save = (item) => {
    update((d) => ({
      ...d,
      watchlist: item.id && d.watchlist.some((w) => w.id === item.id)
        ? d.watchlist.map((w) => (w.id === item.id ? item : w))
        : [...d.watchlist, { ...item, id: uid() }],
    }));
    setModal(null);
  };

  return (
    <section className="section">
      <div className="section-head">
        <p className="section-hint">Coisas que você acompanha mas ainda não comprou.</p>
        <button
          className="primary-btn"
          onClick={() => setModal({ kind: "acao", ticker: "", name: "", target: null, lastPrice: null, lastChange: null, lastUpdate: null, attrs: [], notes: "" })}
        >
          + Item
        </button>
      </div>

      <div className="card-grid">
        {data.watchlist.length === 0 && <Empty>Nada monitorado ainda. Adicione BTC, uma ação, um CDB de outra corretora…</Empty>}
        {data.watchlist.map((w) => {
          const manual = !API_KINDS.includes(w.kind);
          const hit = w.target != null && w.lastPrice != null && w.lastPrice <= w.target;
          const dist = w.target != null && w.lastPrice != null && w.target > 0
            ? ((w.lastPrice - w.target) / w.target) * 100
            : null;
          return (
            <div className="card asset-card clickable" key={w.id} onClick={() => setModal(w)} title="Editar" role="button" tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setModal(w)}>
              <div className="card-top">
                <span className="asset-name">{w.ticker ? w.ticker.toUpperCase() : w.name || "(sem nome)"}</span>
                <span className="badge">{KINDS[w.kind] || w.kind}</span>
              </div>
              {w.name && w.ticker && <div className="asset-sub">{w.name}</div>}
              <div className="price-row">
                {manual ? (
                  <InlinePrice
                    value={w.lastPrice}
                    onSave={(v) =>
                      update((d) => ({
                        ...d,
                        watchlist: d.watchlist.map((x) =>
                          x.id === w.id ? { ...x, lastPrice: v, lastUpdate: new Date().toISOString() } : x
                        ),
                      }))
                    }
                  />
                ) : (
                  <span className="asset-price big">{fmtBRL(w.lastPrice)}</span>
                )}
                {w.lastChange != null && (
                  <span className={"chg " + (w.lastChange >= 0 ? "pos" : "neg")}>{fmtPct(w.lastChange)}</span>
                )}
              </div>
              {w.target != null && (
                <div className={"target-line" + (hit ? " hit" : "")}>
                  Alvo: {fmtBRL(w.target)}
                  {hit ? <span className="hit-badge">✓ atingido</span> : dist != null && <em> ({fmtPct(dist)})</em>}
                </div>
              )}
              <div className="asset-meta">
                {w.lastUpdate && <span title="Última atualização">{fmtDateTime(w.lastUpdate)}</span>}
              </div>
              <AttrChips attrs={w.attrs} />
              {w.notes && <div className="asset-notes">{w.notes}</div>}
            </div>
          );
        })}
      </div>

      {modal && (
        <WatchModal
          item={modal}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={modal.id ? () => { update((d) => ({ ...d, watchlist: d.watchlist.filter((w) => w.id !== modal.id) })); setModal(null); } : null}
        />
      )}
    </section>
  );
}

function WatchModal({ item, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({ ...item });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const manual = !API_KINDS.includes(form.kind);
  const valid = form.ticker.trim() || form.name.trim();
  return (
    <Modal
      title={item.id ? "Editar item" : "Monitorar novo item"}
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
          <select value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
            {WATCH_KINDS.map((k) => (
              <option key={k} value={k}>{KINDS[k]}</option>
            ))}
          </select>
        </Field>
        <Field label={form.kind === "cripto" ? "ID CoinGecko" : form.kind === "moeda" ? "Par de moedas" : "Ticker / código"}>
          <input
            value={form.ticker}
            placeholder={
              form.kind === "cripto" ? "Ex.: bitcoin"
              : form.kind === "moeda" ? "Ex.: USD-BRL"
              : form.kind === "rendafixa" ? "(opcional)"
              : "Ex.: BOVA11"
            }
            onChange={(e) => set({ ticker: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Nome (opcional)" grow>
          <input value={form.name} placeholder="Ex.: CDB 120% Banco Y" onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Preço-alvo (R$, opcional)">
          <MoneyInput value={form.target} onChange={(v) => set({ target: v })} placeholder="—" />
        </Field>
        {manual && (
          <Field label="Preço/valor atual (R$)">
            <MoneyInput value={form.lastPrice} onChange={(v) => set({ lastPrice: v, lastUpdate: new Date().toISOString() })} placeholder="—" />
          </Field>
        )}
        <Field label="Atributos extras" grow>
          <AttrEditor attrs={form.attrs} onChange={(attrs) => set({ attrs })} />
        </Field>
        <Field label="Observações" grow>
          <textarea rows={2} value={form.notes || ""} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
      {form.kind === "rendafixa" && (
        <p className="hint">Use os atributos extras para taxa, emissor, vencimento etc. (ex.: Taxa → 120% CDI).</p>
      )}
    </Modal>
  );
}
