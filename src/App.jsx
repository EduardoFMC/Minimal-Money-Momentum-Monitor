import React, { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { loadData, saveData, isTauri } from "./backend";
import { migrate, launchRecurring, upsertHistory } from "./model";
import { applyTheme } from "./theme";
import { refreshItems, hasApiItems } from "./quotes";
import { estimateFixedAssets, isEstimable } from "./fixedIncome";
import { todayISO } from "./format";
import Expenses from "./components/Expenses";
import Investments from "./components/Investments";
import Monitoring from "./components/Monitoring";
import Settings from "./components/Settings";

const TABS = [
  { id: "despesas", label: "Despesas" },
  { id: "investimentos", label: "Investimentos" },
  { id: "monitoramento", label: "Monitoramento" },
];

function mergePrices(cur, updated) {
  const m = new Map(updated.map((i) => [i.id, i]));
  return cur.map((c) => {
    const u = m.get(c.id);
    return u && u.lastUpdate !== c.lastUpdate
      ? { ...c, lastPrice: u.lastPrice, lastChange: u.lastChange, lastUpdate: u.lastUpdate, name: c.name || u.name || "" }
      : c;
  });
}

function mergeEstimates(cur, updated) {
  const m = new Map(updated.map((f) => [f.id, f]));
  return cur.map((c) => {
    const u = m.get(c.id);
    return u && u.estDate !== c.estDate
      ? { ...c, estValue: u.estValue, estNet: u.estNet, estIr: u.estIr, estDate: u.estDate }
      : c;
  });
}

export default function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState("despesas");
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");
  const dirty = useRef(false);
  const dataRef = useRef(null);
  const autoRefreshed = useRef(false);
  const toastTimer = useRef(null);
  // controle de alterações ainda não gravadas (para descarregar ao fechar)
  const changeSeq = useRef(0);
  const savedSeq = useRef(0);

  dataRef.current = data;

  const update = (fn) => {
    dirty.current = true;
    changeSeq.current++;
    setData((d) => fn(d));
  };

  // carrega dados na inicialização; em caso de falha NÃO cria dados vazios
  // (senão uma falha transitória de leitura pareceria perda total)
  useEffect(() => {
    loadData()
      .then((raw) => setData(migrate(raw)))
      .catch((e) => {
        console.error(e);
        setLoadError(String(e.message || e));
      });
  }, []);

  // salva com debounce a cada alteração
  useEffect(() => {
    if (!data || !dirty.current) return;
    setSaveState("saving");
    const seq = changeSeq.current;
    const t = setTimeout(async () => {
      try {
        await saveData(data);
        savedSeq.current = Math.max(savedSeq.current, seq);
        setSaveState("saved");
      } catch (e) {
        console.error(e);
        setSaveState("error");
        showToast("Erro ao salvar: " + (e.message || e));
      }
    }, 600);
    return () => clearTimeout(t);
  }, [data]);

  // ao fechar a janela, grava o que estiver pendente antes de encerrar
  useEffect(() => {
    if (!isTauri) return;
    let un;
    listen("app-close-requested", async () => {
      try {
        if (changeSeq.current > savedSeq.current && dataRef.current) {
          await saveData(dataRef.current);
          savedSeq.current = changeSeq.current;
        }
      } catch (e) {
        console.error(e);
      } finally {
        invoke("confirm_close");
      }
    }).then((u) => (un = u));
    return () => un && un();
  }, []);

  // aplica o tema
  useEffect(() => {
    if (data) applyTheme(data.settings.theme);
  }, [data?.settings?.theme]);

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6000);
  };

  const lastRefreshAt = useRef(0);
  const lastErrToast = useRef("");
  const refreshingRef = useRef(false); // guard síncrono (o estado React atrasa)

  // silent = atualizações automáticas (timer/foco): sem toast de sucesso e
  // sem repetir o mesmo erro em sequência
  const refreshQuotes = async (silent = false) => {
    const d = dataRef.current;
    if (!d || refreshingRef.current) return;
    const hasQuotes = hasApiItems([...d.variable, ...d.watchlist]);
    const hasFixed = d.fixed.some(isEstimable);
    if (!hasQuotes && !hasFixed) {
      if (!silent) showToast("Nenhum ativo com cotação/estimativa automática.");
      return;
    }
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const token = d.settings.brapiToken;
      const [rv, rw, fx] = await Promise.all([
        hasQuotes ? refreshItems(d.variable, token) : Promise.resolve({ items: d.variable, errors: [] }),
        hasQuotes ? refreshItems(d.watchlist, token) : Promise.resolve({ items: d.watchlist, errors: [] }),
        hasFixed ? estimateFixedAssets(d.fixed) : Promise.resolve({ updates: null, errors: [] }),
      ]);
      update((cur) =>
        upsertHistory(
          {
            ...cur,
            variable: mergePrices(cur.variable, rv.items),
            watchlist: mergePrices(cur.watchlist, rw.items),
            fixed: fx.updates ? mergeEstimates(cur.fixed, fx.updates) : cur.fixed,
          },
          todayISO()
        )
      );
      lastRefreshAt.current = Date.now();
      const errors = [...new Set([...rv.errors, ...rw.errors, ...fx.errors])];
      if (errors.length) {
        const msg = errors.join(" · ");
        if (!silent || msg !== lastErrToast.current) showToast(msg);
        lastErrToast.current = msg;
      } else {
        lastErrToast.current = "";
        if (!silent) showToast("Cotações atualizadas às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      }
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };

  // na inicialização: lança assinaturas do mês, registra o snapshot do
  // patrimônio e dispara a primeira atualização de cotações
  useEffect(() => {
    if (data && !autoRefreshed.current) {
      autoRefreshed.current = true;
      const launched = launchRecurring(data, todayISO());
      if (launched) {
        update(() => launched.data);
        if (launched.count > 0) {
          showToast(
            launched.count === 1
              ? "1 assinatura lançada automaticamente neste mês."
              : `${launched.count} assinaturas lançadas automaticamente neste mês.`
          );
        }
      }
      update((cur) => upsertHistory(cur, todayISO()));
      refreshQuotes(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // F5 (ou Ctrl+R) atualiza cotações em vez de recarregar a página
  const refreshRef = useRef();
  refreshRef.current = refreshQuotes;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        refreshRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // atualização automática em intervalo (configurável em ⚙)
  const autoRefreshMin = data?.settings?.autoRefreshMin ?? 5;
  useEffect(() => {
    if (!autoRefreshMin) return;
    const t = setInterval(() => refreshRef.current(true), autoRefreshMin * 60000);
    return () => clearInterval(t);
  }, [autoRefreshMin]);

  // ao voltar o foco para a janela, atualiza se estiver defasado (>2 min)
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastRefreshAt.current > 120000) refreshRef.current(true);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadError)
    return (
      <div className="loading error-screen">
        <h2>Não consegui ler seus dados</h2>
        <p>
          Seus dados <b>não foram apagados</b> — o app só não conseguiu ler o arquivo agora
          (pode estar bloqueado por antivírus ou backup em andamento). Nesta tela nada é
          gravado por cima do arquivo.
        </p>
        <p className="err-detail">{loadError}</p>
        <button className="primary-btn" onClick={() => window.location.reload()}>
          Tentar novamente
        </button>
      </div>
    );

  if (!data) return <div className="loading">Carregando…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo" title="Minimal Money Momentum Monitor">M⁴</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={"tab" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <button
            className={"icon-btn refresh" + (refreshing ? " spinning" : "")}
            title="Atualizar cotações"
            onClick={refreshQuotes}
            disabled={refreshing}
          >
            ↻
          </button>
          <span
            className={"save-dot " + saveState}
            title={saveState === "saving" ? "Salvando…" : saveState === "error" ? "Erro ao salvar!" : "Dados salvos"}
          />
          <button className={"tab gear" + (tab === "config" ? " on" : "")} title="Configurações" onClick={() => setTab("config")}>
            ⚙
          </button>
        </div>
      </header>

      <main className="content">
        {tab === "despesas" && <Expenses data={data} update={update} />}
        {tab === "investimentos" && <Investments data={data} update={update} />}
        {tab === "monitoramento" && <Monitoring data={data} update={update} />}
        {tab === "config" && <Settings data={data} update={update} />}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
