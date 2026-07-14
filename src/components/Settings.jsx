import React, { useEffect, useState } from "react";
import { PRESETS, THEME_VARS, themeColors } from "../theme";
import { uid, defaultData } from "../model";
import { exportBackup, importBackup, importOfx, dataFilePath, isTauri } from "../backend";
import { migrate } from "../model";
import { parseOfx, guessCategory } from "../ofx";
import { Field, DangerButton } from "./ui";

export default function Settings({ data, update }) {
  const [path, setPath] = useState("…");
  const [msg, setMsg] = useState("");
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    dataFilePath().then(setPath).catch(() => setPath("?"));
  }, []);

  const theme = data.settings.theme;
  const colors = themeColors(theme);

  const setTheme = (patch) =>
    update((d) => ({ ...d, settings: { ...d.settings, theme: { ...d.settings.theme, ...patch } } }));

  const setColor = (key, value) => setTheme({ colors: { ...(theme.colors || {}), [key]: value } });

  const catUsage = (id) => data.expenses.filter((t) => t.catId === id).length;

  const doExport = async () => {
    try {
      const r = await exportBackup(data);
      setMsg(r ? "Backup exportado: " + r : "Exportação cancelada.");
    } catch (e) {
      setMsg("Erro ao exportar: " + (e.message || e));
    }
  };

  const doImport = async () => {
    try {
      const raw = await importBackup();
      if (!raw) return setMsg("Importação cancelada.");
      update(() => migrate(raw));
      setMsg("Backup importado com sucesso.");
    } catch (e) {
      setMsg("Erro ao importar: " + (e.message || e));
    }
  };

  const doOfx = async () => {
    try {
      const text = await importOfx();
      if (!text) return setMsg("Importação cancelada.");
      const txs = parseOfx(text);
      if (!txs.length) return setMsg("Nenhuma transação encontrada no arquivo.");
      const seenIds = new Set(data.settings.importedFitids || []);
      const seenSig = new Set(data.expenses.map((t) => `${t.date}|${t.amount}|${(t.desc || "").toLowerCase()}`));
      const fresh = [];
      const newIds = [];
      for (const t of txs) {
        const sig = `${t.date}|${t.amount}|${t.desc.toLowerCase()}`;
        if (t.fitid ? seenIds.has(t.fitid) : seenSig.has(sig)) continue;
        if (t.fitid) {
          seenIds.add(t.fitid);
          newIds.push(t.fitid);
        }
        seenSig.add(sig);
        fresh.push({
          id: uid(),
          date: t.date,
          desc: t.desc,
          amount: t.amount,
          type: t.type,
          catId: guessCategory(t.desc, data.categories),
          recurring: false,
          imported: true,
        });
      }
      if (!fresh.length) return setMsg(`Nada novo: as ${txs.length} transações do arquivo já estavam importadas.`);
      update((d) => ({
        ...d,
        expenses: [...d.expenses, ...fresh],
        settings: { ...d.settings, importedFitids: [...(d.settings.importedFitids || []), ...newIds].slice(-5000) },
      }));
      const dup = txs.length - fresh.length;
      setMsg(`${fresh.length} transação(ões) importada(s)` + (dup ? `, ${dup} duplicada(s) ignorada(s)` : "") + ". Revise as categorias sugeridas.");
    } catch (e) {
      setMsg("Erro ao importar OFX: " + (e.message || e));
    }
  };

  return (
    <section className="section settings">
      <div className="card">
        <h4>Paleta de cores</h4>
        <div className="preset-row">
          {Object.entries(PRESETS).map(([key, p]) => (
            <button
              key={key}
              className={"preset-btn" + (theme.preset === key ? " on" : "")}
              style={{ background: p.bg, color: p.text, borderColor: theme.preset === key ? p.accent : p.border }}
              onClick={() => setTheme({ preset: key, colors: {} })}
            >
              <span className="dot" style={{ background: p.accent }} /> {p.label}
            </button>
          ))}
        </div>
        <div className="color-grid">
          {THEME_VARS.map((v) => (
            <label className="color-item" key={v.key}>
              <input type="color" value={colors[v.key]} onChange={(e) => setColor(v.key, e.target.value)} />
              <span>{v.label}</span>
            </label>
          ))}
        </div>
        {Object.keys(theme.colors || {}).length > 0 && (
          <button className="ghost-btn" onClick={() => setTheme({ colors: {} })}>Restaurar cores do tema</button>
        )}
      </div>

      <div className="card">
        <h4>Cotações (APIs)</h4>
        <Field label="Token brapi.dev (ações e FIIs da B3)" grow>
          <div className="token-row">
            <input
              type={showToken ? "text" : "password"}
              value={data.settings.brapiToken || ""}
              placeholder="cole o token aqui"
              onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, brapiToken: e.target.value } }))}
            />
            <button className="ghost-btn" onClick={() => setShowToken(!showToken)}>{showToken ? "ocultar" : "mostrar"}</button>
          </div>
        </Field>
        <p className="hint">
          Crie um token gratuito em brapi.dev/dashboard. Cripto usa CoinGecko, moedas usam a
          AwesomeAPI e a renda fixa é estimada com o CDI/Selic/IPCA do Banco Central — nenhum
          desses precisa de token. O token fica salvo apenas no arquivo de dados local.
        </p>
        <Field label="Atualização automática de cotações">
          <select
            value={data.settings.autoRefreshMin ?? 5}
            onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, autoRefreshMin: Number(e.target.value) } }))}
          >
            <option value={0}>Desligada (só manual / F5)</option>
            <option value={1}>A cada 1 minuto</option>
            <option value={5}>A cada 5 minutos</option>
            <option value={15}>A cada 15 minutos</option>
            <option value={30}>A cada 30 minutos</option>
          </select>
        </Field>
      </div>

      <div className="card">
        <h4>Extrato bancário (OFX)</h4>
        <p className="hint">
          Importe o extrato exportado pelo seu banco — no Inter: Extrato → Compartilhar →
          OFX. As transações entram nas Despesas com categoria sugerida automaticamente
          (Uber → Transporte, iFood → Alimentação…) e duplicadas são ignoradas, então pode
          importar o mesmo período mais de uma vez sem medo.
        </p>
        <button className="primary-btn" onClick={doOfx}>Importar extrato OFX…</button>
      </div>

      <div className="card">
        <h4>Categorias de despesas</h4>
        <div className="cat-list">
          {data.categories.map((c) => {
            const used = catUsage(c.id);
            return (
              <div className="cat-row" key={c.id}>
                <input
                  type="color"
                  value={c.color}
                  onChange={(e) =>
                    update((d) => ({ ...d, categories: d.categories.map((x) => (x.id === c.id ? { ...x, color: e.target.value } : x)) }))
                  }
                />
                <input
                  value={c.name}
                  onChange={(e) =>
                    update((d) => ({ ...d, categories: d.categories.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) }))
                  }
                />
                <button
                  className="icon-btn"
                  title={used ? `Em uso por ${used} transação(ões)` : "Remover"}
                  disabled={used > 0}
                  onClick={() => update((d) => ({ ...d, categories: d.categories.filter((x) => x.id !== c.id) }))}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <button
          className="ghost-btn"
          onClick={() => update((d) => ({ ...d, categories: [...d.categories, { id: uid(), name: "Nova categoria", color: "#8899aa" }] }))}
        >
          + categoria
        </button>
      </div>

      <div className="card">
        <h4>Dados e backup</h4>
        <p className="hint">Arquivo de dados: <code>{path}</code></p>
        <p className="hint">
          Além do backup manual, o app guarda automaticamente: o estado anterior a cada
          gravação (<code>data.bak.json</code>) e um backup por dia dos últimos 14 dias
          (pasta <code>backups\</code>). Se o arquivo principal corromper, o app restaura
          sozinho o backup mais recente.
        </p>
        <div className="btn-row">
          <button className="primary-btn" onClick={doExport}>Exportar backup (.json)</button>
          <button className="ghost-btn" onClick={doImport}>Importar backup…</button>
          <DangerButton
            label="Zerar todos os dados"
            confirmLabel="Apagar TUDO mesmo?"
            onConfirm={() => { update(() => defaultData()); setMsg("Dados zerados."); }}
          />
        </div>
        {msg && <p className="hint">{msg}</p>}
        {!isTauri && <p className="hint warn">Rodando no navegador (modo desenvolvimento): dados no localStorage.</p>}
      </div>

      <p className="about">M⁴ — Minimal Money Momentum Monitor · dados 100% locais · cotações: brapi.dev + CoinGecko</p>
    </section>
  );
}
