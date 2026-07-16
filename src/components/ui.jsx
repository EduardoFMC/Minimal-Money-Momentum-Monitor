import React, { useEffect, useRef, useState } from "react";
import { parseNum } from "../format";

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, grow }) {
  return (
    <label className={"field" + (grow ? " grow" : "")}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

// Máscara de dinheiro estilo Pix: só dígitos, preenchendo os centavos da
// direita para a esquerda ("4590" -> 45,90). Vírgula decimal, ponto de milhar.
function centsToText(v) {
  if (v == null || isNaN(v)) return "";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function textToCents(s) {
  const digits = String(s).replace(/\D/g, "").slice(0, 13);
  return digits ? parseInt(digits, 10) / 100 : null;
}

export function MoneyInput({ value, onChange, placeholder = "0,00", ...rest }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={centsToText(value)}
      placeholder={placeholder}
      onChange={(e) => onChange(textToCents(e.target.value))}
      {...rest}
    />
  );
}

// Máscara de taxa/percentual: só dígitos e uma vírgula decimal (aceita ponto
// como vírgula). Guarda a string limpa — "102", "0,07", "13,5". Não usa o
// preenchimento à direita do dinheiro porque taxas são digitadas por extenso.
export function RateInput({ value, onChange, suffix = "%", ...rest }) {
  const [text, setText] = useState(value == null ? "" : String(value).replace(".", ","));
  useEffect(() => {
    setText(value == null || value === "" ? "" : String(value).replace(".", ","));
  }, [value]);
  const handle = (raw) => {
    let t = raw.replace(/\./g, ",").replace(/[^\d,]/g, "");
    const i = t.indexOf(",");
    if (i !== -1) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/,/g, ""); // uma vírgula só
    setText(t);
    onChange(t);
  };
  return (
    <span className="rate-input">
      <input type="text" inputMode="decimal" value={text} onChange={(e) => handle(e.target.value)} {...rest} />
      {suffix && <span className="rate-suffix">{suffix}</span>}
    </span>
  );
}

// Input numérico livre (quantidades, que podem ter várias casas ou ser
// negativas para pernas vendidas). Aceita vírgula ou ponto decimal.
export function NumInput({ value, onChange, placeholder = "0,00", ...rest }) {
  const [text, setText] = useState(value == null || value === "" ? "" : String(value).replace(".", ","));
  useEffect(() => {
    // sincroniza quando o valor externo muda de fora (ex.: abrir modal)
    const cur = parseNum(text);
    if (value == null && text === "") return;
    if (isNaN(cur) || Math.abs(cur - value) > 1e-9) {
      setText(value == null || isNaN(value) ? "" : String(value).replace(".", ","));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseNum(e.target.value);
        onChange(isNaN(n) ? null : n);
      }}
      {...rest}
    />
  );
}

// Editor de atributos livres ("ficha de personagem"): pares chave/valor.
export function AttrEditor({ attrs, onChange }) {
  const list = attrs || [];
  const set = (i, patch) => onChange(list.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="attr-editor">
      {list.map((a, i) => (
        <div className="attr-row" key={i}>
          <input placeholder="Atributo" value={a.k} onChange={(e) => set(i, { k: e.target.value })} />
          <input placeholder="Valor" value={a.v} onChange={(e) => set(i, { v: e.target.value })} />
          <button className="icon-btn" title="Remover" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="ghost-btn" onClick={() => onChange([...list, { k: "", v: "" }])}>+ atributo</button>
    </div>
  );
}

export function AttrChips({ attrs }) {
  // só mostra atributos preenchidos (chave sem valor fica de fora)
  const list = (attrs || []).filter((a) => String(a.v ?? "").trim());
  if (!list.length) return null;
  return (
    <div className="attr-chips">
      {list.map((a, i) => (
        <span className="chip" key={i}>
          <b>{a.k}</b> {a.v}
        </span>
      ))}
    </div>
  );
}

// Botão que pede um segundo clique para confirmar ações destrutivas.
export function DangerButton({ label, confirmLabel = "Confirmar?", onConfirm, className = "" }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className={"danger-btn " + className}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 2500);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

// Preço editável direto no card (para ativos sem cotação automática).
// Mesma máscara Pix; confirma no Enter ou ao sair do campo.
export function InlinePrice({ value, onSave }) {
  const [text, setText] = useState(centsToText(value));
  useEffect(() => {
    setText(centsToText(value));
  }, [value]);
  const commit = () => {
    const n = textToCents(text);
    if (n != null && n !== value) onSave(n);
  };
  return (
    <input
      className="inline-price"
      type="text"
      inputMode="numeric"
      value={text}
      placeholder="preço"
      title="Preço manual — Enter para salvar"
      onChange={(e) => setText(centsToText(textToCents(e.target.value)))}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation(); // não deixa o Enter abrir o modal do card
        if (e.key === "Enter") {
          commit();
          e.target.blur();
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// Seletor pesquisável: campo de busca + lista alfabética rolável (aprox. 10
// itens visíveis). A lista usa position:fixed para NÃO ser cortada por
// ancestrais com overflow (modal, área de conteúdo rolável).
export function SearchSelect({ options, value, onChange, emptyLabel = null, placeholder = "Pesquisar…" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [coords, setCoords] = useState(null);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  const updateCoords = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const up = spaceBelow < 240 && spaceAbove > spaceBelow;
    const maxH = Math.max(120, Math.min(272, (up ? spaceAbove : spaceBelow) - 12));
    setCoords({
      left: r.left,
      width: r.width,
      top: up ? undefined : r.bottom + 2,
      bottom: up ? window.innerHeight - r.top + 2 : undefined,
      maxH,
    });
  };

  useEffect(() => {
    if (!open) return;
    updateCoords();
    const on = () => updateCoords();
    // captura para pegar rolagem de qualquer ancestral (modal, conteúdo)
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // remove acentos para a busca ("saude" encontra "Saúde")
  const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const sorted = [...options].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const shown = q.trim() ? sorted.filter((o) => norm(o.name).includes(norm(q))) : sorted;
  const sel = options.find((o) => o.id === value);

  const pick = (id) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="search-select" ref={boxRef}>
      <input
        ref={inputRef}
        value={open ? q : sel ? sel.name : emptyLabel || ""}
        placeholder={sel ? sel.name : emptyLabel || placeholder}
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown.length > 0) {
            e.preventDefault();
            pick(shown[0].id);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && coords && (
        <div
          className="ss-list"
          style={{ position: "fixed", left: coords.left, width: coords.width, top: coords.top, bottom: coords.bottom, maxHeight: coords.maxH }}
        >
          {emptyLabel != null && !q.trim() && (
            <button type="button" className={"ss-item" + (!value ? " on" : "")} onMouseDown={() => pick("")}>
              {emptyLabel}
            </button>
          )}
          {shown.map((o) => (
            <button type="button" key={o.id} className={"ss-item" + (o.id === value ? " on" : "")} onMouseDown={() => pick(o.id)}>
              {o.color && <span className="dot" style={{ background: o.color }} />}
              {o.name}
            </button>
          ))}
          {shown.length === 0 && <div className="ss-empty">Nada encontrado</div>}
        </div>
      )}
    </div>
  );
}
