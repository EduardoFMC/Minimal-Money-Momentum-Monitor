import React, { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { loadData, saveData, notify, unlockPin, isTauri } from "./backend";
import { checkAlerts } from "./alerts";
import { migrate, launchRecurring, applyMonthlyContributions, upsertHistory } from "./model";
import { applyTheme } from "./theme";
import { refreshItems, hasApiItems } from "./quotes";
import { estimateFixedAssets, isEstimable } from "./fixedIncome";
import { todayISO, addMonths } from "./format";
import Expenses from "./components/Expenses";
import Investments from "./components/Investments";
import Monitoring from "./components/Monitoring";
import Settings from "./components/Settings";
import Report from "./components/Report";
import Planning from "./components/Planning";

const TABS = [
  { id: "despesas", label: "Despesas" },
  { id: "investimentos", label: "Investimentos" },
  { id: "monitoramento", label: "Monitoramento" },
  { id: "planejamento", label: "Planejamento" },
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
    // aplica quando a data OU o valor OU a versão da lógica mudou
    return u && (u.estDate !== c.estDate || u.estValue !== c.estValue || u.estVer !== c.estVer)
      ? { ...c, estValue: u.estValue, estNet: u.estNet, estIr: u.estIr, estIof: u.estIof, estDate: u.estDate, estVer: u.estVer }
      : c;
  });
}

export default function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [locked, setLocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [tab, setTab] = useState("despesas");
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null); // última atualização de cotações
  const [reportMonth, setReportMonth] = useState(null); // "YYYY-MM" com o relatório aberto
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
      .then((raw) => {
        if (raw && raw.m4Encrypted) setLocked(true);
        else setData(migrate(raw));
      })
      .catch((e) => {
        console.error(e);
        setLoadError(String(e.message || e));
      });
  }, []);

  const doUnlock = async () => {
    const pin = pinInput.trim();
    if (!pin || unlocking) return;
    setUnlocking(true);
    setPinError("");
    try {
      const raw = await unlockPin(pin);
      setData(migrate(raw));
      setLocked(false);
      setPinInput("");
    } catch (e) {
      setPinError(String(e.message || e));
    } finally {
      setUnlocking(false);
    }
  };

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
    const uns = [];
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
    }).then((u) => uns.push(u));
    // menu da bandeja: "Atualizar cotações"
    listen("refresh-request", () => refreshRef.current()).then((u) => uns.push(u));
    // tick de 60s do Rust (funciona com a janela escondida na bandeja)
    listen("refresh-tick", () => {
      const min = dataRef.current?.settings?.autoRefreshMin ?? 5;
      if (min > 0 && Date.now() - lastRefreshAt.current >= min * 60000) {
        refreshRef.current(true);
      }
    }).then((u) => uns.push(u));
    return () => uns.forEach((u) => u && u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // informa o Rust sobre o comportamento do X (bandeja × fechar)
  const trayMode = data?.settings?.trayMode === true;
  useEffect(() => {
    if (!isTauri || data == null) return;
    invoke("set_tray_mode", { enabled: trayMode }).catch(() => {});
  }, [trayMode, data == null]);

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
      setUpdatedAt(new Date());
      // alertas nativos sobre os dados recém-atualizados (1x/dia/item)
      const merged = {
        ...d,
        variable: mergePrices(d.variable, rv.items),
        watchlist: mergePrices(d.watchlist, rw.items),
        fixed: fx.updates ? mergeEstimates(d.fixed, fx.updates) : d.fixed,
      };
      const al = checkAlerts(merged, d.settings, todayISO());
      if (al.notifications.length) {
        al.notifications.forEach((n) => notify(n.title, n.body));
        update((cur) => ({
          ...cur,
          settings: { ...cur.settings, notifiedAlerts: [...(cur.settings.notifiedAlerts || []), ...al.keys].slice(-300) },
        }));
      }
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
      let working = data;
      const notes = [];
      const launched = launchRecurring(working, todayISO());
      if (launched) {
        working = launched.data;
        if (launched.count > 0) notes.push(launched.count === 1 ? "1 assinatura lançada" : `${launched.count} assinaturas lançadas`);
      }
      const invested = applyMonthlyContributions(working, todayISO());
      if (invested) {
        working = invested.data;
        if (invested.count > 0) notes.push(invested.count === 1 ? "1 aporte mensal lançado" : `${invested.count} aportes mensais lançados`);
      }
      working = upsertHistory(working, todayISO());
      // relatório do mês que fechou (uma vez por virada de mês)
      const prevMonth = addMonths(todayISO().slice(0, 7), -1);
      if ((working.settings.lastReportMonth || "") < prevMonth && working.expenses.some((t) => t.date.slice(0, 7) === prevMonth)) {
        setReportMonth(prevMonth);
        working = { ...working, settings: { ...working.settings, lastReportMonth: prevMonth } };
      }
      if (working !== data) {
        dataRef.current = working; // para o refresh já usar o estado novo
        update(() => working);
      }
      if (notes.length) showToast(notes.join(" · ") + " neste mês.");
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

  if (locked)
    return (
      <div className="loading lock-screen">
        <span className="logo big">M⁴</span>
        <h2>Dados protegidos por PIN</h2>
        <input
          type="password"
          className="pin-input"
          placeholder="PIN"
          value={pinInput}
          autoFocus
          onChange={(e) => setPinInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doUnlock()}
        />
        {pinError && <p className="pin-error">{pinError}</p>}
        <button className="primary-btn" disabled={unlocking || !pinInput.trim()} onClick={doUnlock}>
          {unlocking ? "Verificando…" : "Desbloquear"}
        </button>
      </div>
    );

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
          {updatedAt && (
            <span className="upd-time" title="Última atualização das cotações">
              {updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            className={"icon-btn refresh" + (refreshing ? " spinning" : "")}
            title="Atualizar cotações"
            onClick={() => refreshQuotes()}
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
        {tab === "despesas" && <Expenses data={data} update={update} onReport={setReportMonth} />}
        {tab === "investimentos" && <Investments data={data} update={update} />}
        {tab === "monitoramento" && <Monitoring data={data} update={update} />}
        {tab === "planejamento" && <Planning data={data} update={update} />}
        {tab === "config" && <Settings data={data} update={update} />}
      </main>

      {reportMonth && <Report data={data} month={reportMonth} onClose={() => setReportMonth(null)} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
