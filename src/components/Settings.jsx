import React, { useEffect, useState } from "react";
import { PRESETS, THEME_VARS, themeColors } from "../theme";
import { uid, defaultData } from "../model";
import { exportBackup, importBackup, importOfx, dataFilePath, isEncrypted, setPin, clearPin, isTauri } from "../backend";
import { migrate } from "../model";
import { parseOfx, guessCategory } from "../ofx";
import { parseInterCsv, parseFaturaCsv, dedupeTxs, isOfx } from "../csv";
import { Field, DangerButton } from "./ui";

export default function Settings({ data, update }) {
  const [path, setPath] = useState("…");
  const [msg, setMsg] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [pinA, setPinA] = useState("");
  const [pinB, setPinB] = useState("");
  const [pinOld, setPinOld] = useState("");
  const [pinBusy, setPinBusy] = useState(false);

  useEffect(() => {
    dataFilePath().then(setPath).catch(() => setPath("?"));
    isEncrypted().then(setHasPin).catch(() => {});
  }, []);

  const doSetPin = async () => {
    if (pinA.trim().length < 4) return setMsg("PIN muito curto (mínimo 4 caracteres).");
    if (pinA !== pinB) return setMsg("Os PINs não conferem.");
    setPinBusy(true);
    try {
      await setPin(pinA.trim(), data);
      setHasPin(true);
      setPinA("");
      setPinB("");
      setMsg(hasPin ? "PIN alterado." : "PIN ativado — os dados agora ficam cifrados no disco.");
    } catch (e) {
      setMsg("Erro: " + (e.message || e));
    } finally {
      setPinBusy(false);
    }
  };

  const doClearPin = async () => {
    if (!pinOld.trim()) return setMsg("Digite o PIN atual para remover.");
    setPinBusy(true);
    try {
      await clearPin(pinOld.trim(), data);
      setHasPin(false);
      setPinOld("");
      setMsg("PIN removido — os dados voltaram a texto puro.");
    } catch (e) {
      setMsg("Erro: " + (e.message || e));
    } finally {
      setPinBusy(false);
    }
  };

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

  // Insere transações parseadas (OFX ou CSV). Dedup: FITID para OFX; para CSV,
  // contagem por assinatura — compras idênticas no mesmo dia são preservadas
  // na 1ª importação e ignoradas na reimportação (ver dedupeTxs em csv.js).
  const importTxs = (txs, extraNotes = []) => {
    if (!txs.length) {
      setMsg(["Nenhuma transação para importar.", ...extraNotes].join(" "));
      return;
    }
    const { fresh, newIds, dup } = dedupeTxs(txs, data.expenses, data.settings.importedFitids);
    if (!fresh.length) {
      setMsg([`Nada novo: as ${txs.length} transações do arquivo já estavam importadas.`, ...extraNotes].join(" "));
      return;
    }
    const rows = fresh.map((t) => ({
      id: uid(),
      date: t.date,
      desc: t.desc,
      amount: t.amount,
      type: t.type,
      catId: guessCategory(`${t.hist || ""} ${t.desc}`, data.categories),
      recurring: false,
      imported: true,
    }));
    update((d) => ({
      ...d,
      expenses: [...d.expenses, ...rows],
      settings: { ...d.settings, importedFitids: [...(d.settings.importedFitids || []), ...newIds].slice(-5000) },
    }));
    setMsg(
      [
        `${rows.length} transação(ões) importada(s)` + (dup ? `, ${dup} duplicada(s) ignorada(s)` : "") + ".",
        ...extraNotes,
        "Revise as categorias sugeridas.",
      ].join(" ")
    );
  };

  // Extrato da conta: aceita OFX ou CSV do Inter (detecta pelo conteúdo)
  const doStatement = async () => {
    try {
      const text = await importOfx();
      if (!text) return setMsg("Importação cancelada.");
      if (isOfx(text)) {
        importTxs(parseOfx(text));
        return;
      }
      const r = parseInterCsv(text);
      if (r.error) return setMsg(r.error);
      const notes = [];
      if (r.skippedInvest) notes.push(`${r.skippedInvest} lançamento(s) de investimento ignorado(s) — já acompanhados em Investimentos.`);
      if (r.skippedFatura) notes.push(`${r.skippedFatura} pagamento(s) de fatura ignorado(s) — importe a fatura do cartão para os itens.`);
      importTxs(r.txs, notes);
    } catch (e) {
      setMsg("Erro ao importar extrato: " + (e.message || e));
    }
  };

  const doFatura = async () => {
    try {
      const text = await importOfx();
      if (!text) return setMsg("Importação cancelada.");
      const r = parseFaturaCsv(text);
      if (r.error) return setMsg(r.error);
      const notes = r.skipped ? [`${r.skipped} pagamento(s)/estorno(s) ignorado(s).`] : [];
      importTxs(r.txs, notes);
    } catch (e) {
      setMsg("Erro ao importar fatura: " + (e.message || e));
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
        <h4>Alertas e bandeja</h4>
        <label className="check">
          <input
            type="checkbox"
            checked={data.settings.trayMode === true}
            onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, trayMode: e.target.checked } }))}
          />
          Manter na bandeja ao fechar (X esconde a janela; cotações e alertas seguem rodando)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={data.settings.alertTarget !== false}
            onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, alertTarget: e.target.checked } }))}
          />
          Notificar quando um preço-alvo do monitoramento for atingido
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={data.settings.alertMove !== false}
            onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, alertMove: e.target.checked } }))}
          />
          Notificar variação diária forte de um ativo
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={data.settings.alertMaturity !== false}
            onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, alertMaturity: e.target.checked } }))}
          />
          Notificar vencimento de renda fixa (30, 7 e 1 dia antes)
        </label>
        <Field label="Variação (%) que dispara alerta">
          <input
            type="number"
            min="1"
            max="50"
            value={data.settings.alertMovePct ?? 5}
            onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, alertMovePct: Number(e.target.value) || 5 } }))}
          />
        </Field>
        <p className="hint">
          Notificações nativas do Windows, no máximo uma por ativo/tipo por dia. Elas
          disparam quando as cotações atualizam — com "manter na bandeja" ligado, isso
          acontece mesmo com a janela fechada.
        </p>
      </div>

      <div className="card">
        <h4>Importar do banco</h4>
        <p className="hint">
          <b>Extrato da conta</b> (OFX ou CSV do Inter): as transações entram nas Despesas com
          categoria sugerida automaticamente e duplicadas são ignoradas — pode importar o mesmo
          arquivo de novo sem medo. Lançamentos de <b>investimento</b> (aplicações, resgates,
          BM&F) e <b>pagamentos de fatura</b> são pulados: os primeiros já são acompanhados em
          Investimentos, e os itens do cartão entram pela fatura. Importe cada período por UM
          formato só (CSV ou OFX) para o dedup funcionar.
        </p>
        <div className="btn-row">
          <button className="primary-btn" onClick={doStatement}>Extrato da conta (OFX/CSV)…</button>
          <button className="ghost-btn" onClick={doFatura}>Fatura do cartão (CSV)…</button>
        </div>
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

      {isTauri && (
        <div className="card">
          <h4>Segurança (PIN)</h4>
          {hasPin ? (
            <p className="hint">🔒 PIN ativo — o arquivo de dados está cifrado (AES-256).</p>
          ) : (
            <p className="hint">
              Sem PIN, o arquivo de dados (incluindo o token da brapi) fica em texto puro no disco.
            </p>
          )}
          <div className="form-grid">
            <Field label={hasPin ? "Novo PIN (para alterar)" : "PIN (mín. 4 caracteres)"}>
              <input type="password" value={pinA} onChange={(e) => setPinA(e.target.value)} />
            </Field>
            <Field label="Confirmar PIN">
              <input type="password" value={pinB} onChange={(e) => setPinB(e.target.value)} />
            </Field>
          </div>
          <div className="btn-row">
            <button className="primary-btn" disabled={pinBusy || !pinA || !pinB} onClick={doSetPin}>
              {hasPin ? "Alterar PIN" : "Ativar PIN"}
            </button>
            {hasPin && (
              <>
                <input
                  type="password"
                  className="pin-remove-input"
                  placeholder="PIN atual"
                  value={pinOld}
                  onChange={(e) => setPinOld(e.target.value)}
                />
                <DangerButton label="Remover PIN" confirmLabel="Remover mesmo?" onConfirm={doClearPin} />
              </>
            )}
          </div>
          <p className="hint warn">
            Guarde o PIN: sem ele NÃO há recuperação dos dados. Backups antigos em texto puro
            permanecem no disco até a rotação (14 dias), e o backup exportado manualmente sai
            decifrado.
          </p>
        </div>
      )}

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
