import React, { useMemo, useState } from "react";
import { fmtBRL, fmtDate, monthKey, monthLabel, addMonths, todayISO } from "../format";
import { uid } from "../model";
import { Modal, Field, MoneyInput, SearchSelect, DangerButton, Empty } from "./ui";
import { Donut, Bars, BarsDuo } from "./charts";

function mondayOf(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // 0 = segunda
  x.setDate(x.getDate() - day);
  return x;
}

function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Expenses({ data, update }) {
  const [month, setMonth] = useState(monthKey(todayISO()));
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [onlySubs, setOnlySubs] = useState(false);
  const [chartMode, setChartMode] = useState("sem"); // "sem" (semanas) | "mes" (meses)
  const [modal, setModal] = useState(null); // null | tx em edição (com id) | tx novo (sem id salvo)

  const cats = data.categories;
  const catById = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c])), [cats]);

  const monthTxs = useMemo(
    () => data.expenses.filter((t) => monthKey(t.date) === month),
    [data.expenses, month]
  );

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return monthTxs
      .filter((t) => !ql || (t.desc || "").toLowerCase().includes(ql) || (catById[t.catId]?.name || "").toLowerCase().includes(ql))
      .filter((t) => !cat || t.catId === cat)
      .filter((t) => !onlySubs || t.recurring)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [monthTxs, q, cat, onlySubs, catById]);

  const totals = useMemo(() => {
    let inc = 0, out = 0, subs = 0;
    for (const t of monthTxs) {
      if (t.type === "in") inc += t.amount;
      else {
        out += t.amount;
        if (t.recurring) subs += t.amount;
      }
    }
    return { inc, out, subs, saldo: inc - out };
  }, [monthTxs]);

  const donutEntries = useMemo(() => {
    const m = new Map();
    for (const t of monthTxs) {
      if (t.type !== "out") continue;
      m.set(t.catId, (m.get(t.catId) || 0) + t.amount);
    }
    return [...m.entries()]
      .map(([id, value]) => ({ label: catById[id]?.name || "Sem categoria", color: catById[id]?.color || "#888", value }))
      .sort((a, b) => b.value - a.value);
  }, [monthTxs, catById]);

  const weekBars = useMemo(() => {
    const start = mondayOf(new Date());
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const ws = new Date(start);
      ws.setDate(ws.getDate() - i * 7);
      const we = new Date(ws);
      we.setDate(we.getDate() + 7);
      const a = isoOf(ws), b = isoOf(we);
      const value = data.expenses
        .filter((t) => t.type === "out" && t.date >= a && t.date < b)
        .reduce((s, t) => s + t.amount, 0);
      weeks.push({ label: `${String(ws.getDate()).padStart(2, "0")}/${String(ws.getMonth() + 1).padStart(2, "0")}`, value, highlight: i === 0 });
    }
    return weeks;
  }, [data.expenses]);

  const monthBars = useMemo(() => {
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const mk = addMonths(monthKey(todayISO()), -i);
      let a = 0, b = 0;
      for (const t of data.expenses) {
        if (monthKey(t.date) !== mk) continue;
        if (t.type === "in") a += t.amount;
        else b += t.amount;
      }
      const d = new Date(mk + "-01T00:00:00");
      out.push({ label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), a, b });
    }
    return out;
  }, [data.expenses]);

  const groups = useMemo(() => {
    const g = [];
    let last = null;
    for (const t of shown) {
      if (t.date !== last) {
        g.push({ date: t.date, txs: [] });
        last = t.date;
      }
      g[g.length - 1].txs.push(t);
    }
    return g;
  }, [shown]);

  const saveTx = (tx) => {
    update((d) => ({
      ...d,
      expenses: tx.id && d.expenses.some((t) => t.id === tx.id)
        ? d.expenses.map((t) => (t.id === tx.id ? tx : t))
        : [...d.expenses, { ...tx, id: uid() }],
    }));
    setModal(null);
  };

  const deleteTx = (id) => {
    update((d) => ({ ...d, expenses: d.expenses.filter((t) => t.id !== id) }));
    setModal(null);
  };

  return (
    <section className="section">
      <div className="section-head">
        <div className="month-nav">
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
          <span className="month-label">{monthLabel(month)}</span>
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))}>›</button>
        </div>
        <button className="primary-btn" onClick={() => setModal({ type: "out", amount: null, desc: "", catId: cats[0]?.id || "", date: todayISO(), recurring: false })}>
          + Transação
        </button>
      </div>

      <div className="summary-row">
        <div className="stat">
          <span className="stat-label">Entradas</span>
          <span className="stat-value pos">{fmtBRL(totals.inc)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Saídas</span>
          <span className="stat-value neg">{fmtBRL(totals.out)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Saldo</span>
          <span className={"stat-value " + (totals.saldo >= 0 ? "pos" : "neg")}>{fmtBRL(totals.saldo)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Assinaturas</span>
          <span className="stat-value">{fmtBRL(totals.subs)}</span>
        </div>
      </div>

      <div className="charts-row">
        <div className="card chart-card">
          <h4>Por categoria</h4>
          <Donut entries={donutEntries} />
        </div>
        <div className="card chart-card">
          <div className="chart-head">
            <h4>{chartMode === "sem" ? "Saídas por semana" : "Entradas × saídas por mês"}</h4>
            <div className="seg mini">
              <button className={"seg-btn" + (chartMode === "sem" ? " on" : "")} onClick={() => setChartMode("sem")}>Semanas</button>
              <button className={"seg-btn" + (chartMode === "mes" ? " on" : "")} onClick={() => setChartMode("mes")}>Meses</button>
            </div>
          </div>
          {chartMode === "sem" ? <Bars items={weekBars} /> : <BarsDuo items={monthBars} />}
        </div>
      </div>

      <div className="filter-row">
        <input className="search" placeholder="Pesquisar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="filter-cat">
          <SearchSelect options={cats} value={cat} onChange={setCat} emptyLabel="Todas categorias" />
        </div>
        <button className={"toggle-btn" + (onlySubs ? " on" : "")} onClick={() => setOnlySubs(!onlySubs)} title="Somente assinaturas">
          ↻ Assinaturas
        </button>
      </div>

      <div className="tx-list">
        {groups.length === 0 && <Empty>Nenhuma transação. Clique em “+ Transação”.</Empty>}
        {groups.map((g) => (
          <div key={g.date}>
            <div className="tx-date">{fmtDate(g.date)}</div>
            {g.txs.map((t) => {
              const c = catById[t.catId];
              return (
                <button className="tx-row" key={t.id} onClick={() => setModal(t)} title="Editar">
                  <span className="dot" style={{ background: c?.color || "#888" }} />
                  <span className="tx-desc">
                    {t.desc || "(sem descrição)"}
                    {t.recurring && <span className="sub-badge" title="Assinatura / recorrente">↻</span>}
                  </span>
                  <span className="tx-cat">{c?.name || "—"}</span>
                  <span className={"tx-amount " + (t.type === "in" ? "pos" : "neg")}>
                    {t.type === "in" ? "+" : "−"} {fmtBRL(t.amount)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {modal && (
        <TxModal
          tx={modal}
          cats={cats}
          onClose={() => setModal(null)}
          onSave={saveTx}
          onDelete={modal.id ? () => deleteTx(modal.id) : null}
        />
      )}
    </section>
  );
}

function TxModal({ tx, cats, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({ ...tx });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const valid = form.amount > 0 && form.date && form.catId;
  return (
    <Modal
      title={tx.id ? "Editar transação" : "Nova transação"}
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
      <div className="seg">
        <button className={"seg-btn" + (form.type === "out" ? " on neg-on" : "")} onClick={() => set({ type: "out" })}>Saída</button>
        <button className={"seg-btn" + (form.type === "in" ? " on pos-on" : "")} onClick={() => set({ type: "in" })}>Entrada</button>
      </div>
      <div className="form-grid">
        <Field label="Valor (R$)">
          <MoneyInput value={form.amount} onChange={(v) => set({ amount: v })} autoFocus />
        </Field>
        <Field label="Data">
          <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field label="Descrição" grow>
          <input value={form.desc} placeholder="Ex.: Spotify, mercado, uber…" onChange={(e) => set({ desc: e.target.value })} />
        </Field>
        <Field label="Categoria">
          <SearchSelect options={cats} value={form.catId} onChange={(id) => set({ catId: id })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={!!form.recurring} onChange={(e) => set({ recurring: e.target.checked })} />
          Assinatura / recorrente
        </label>
      </div>
    </Modal>
  );
}
