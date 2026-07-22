import React from "react";
import { fmtBRL } from "../format";

function polar(cx, cy, r, angle) {
  const a = ((angle - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx, cy, r, start, end) {
  const [x1, y1] = polar(cx, cy, r, start);
  const [x2, y2] = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

// Rosca de categorias com legenda.
export function Donut({ entries, size = 120, thickness = 16 }) {
  const total = entries.reduce((s, e) => s + e.value, 0);
  const r = size / 2 - thickness / 2;
  let angle = 0;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        {total > 0 &&
          entries.map((e, i) => {
            const sweep = (e.value / total) * 360;
            // 359.99 para não colapsar um círculo completo
            const path = arcPath(size / 2, size / 2, r, angle, angle + Math.min(sweep, 359.99));
            angle += sweep;
            return (
              <path key={i} d={path} fill="none" stroke={e.color} strokeWidth={thickness} strokeLinecap="butt">
                <title>{`${e.label}: ${fmtBRL(e.value)}`}</title>
              </path>
            );
          })}
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="donut-total">
          {total > 0 ? fmtBRL(total) : "—"}
        </text>
      </svg>
      <div className="donut-legend">
        {entries.slice(0, 7).map((e, i) => (
          <div className="legend-row" key={i}>
            <span className="dot" style={{ background: e.color }} />
            <span className="legend-label">{e.label}</span>
            <span className="legend-value">{fmtBRL(e.value)}</span>
          </div>
        ))}
        {entries.length === 0 && <div className="legend-row muted">Sem saídas no mês</div>}
      </div>
    </div>
  );
}

// Linha/área para séries temporais (ex.: evolução do patrimônio).
// Pontos com `future: true` são desenhados tracejados (projeção).
// refValue (opcional) desenha uma linha horizontal de meta.
export function LineChart({ points, height = 90, refValue = null, refLabel = "meta" }) {
  if (!points.length) return null;
  const w = 600;
  const h = height;
  const pad = 8;
  const vals = points.map((p) => p.value);
  if (refValue != null && isFinite(refValue)) vals.push(refValue);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || Math.max(max, 1) * 0.01;
  const x = (i) => (points.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (points.length - 1));
  const y = (v) => h - pad - ((v - min) / span) * (h - 2 * pad);

  const seg = (from, to) =>
    points.slice(from, to + 1).map((p, k) => `${k ? "L" : "M"} ${x(from + k).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");

  // índice do último ponto "presente" (fronteira antes da projeção)
  let boundary = points.length - 1;
  for (let i = 0; i < points.length; i++) if (points[i].future) { boundary = i - 1; break; }
  const hasFuture = points.some((p) => p.future) && boundary >= 0;

  const solidPath = seg(0, hasFuture ? boundary : points.length - 1);
  const dashedPath = hasFuture ? seg(boundary, points.length - 1) : null;
  const areaEnd = hasFuture ? boundary : points.length - 1;
  const area = `${seg(0, areaEnd)} L ${x(areaEnd).toFixed(1)} ${h - pad} L ${x(0).toFixed(1)} ${h - pad} Z`;

  return (
    <div className="linechart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="linechart" preserveAspectRatio="none">
        <path d={area} fill="color-mix(in srgb, var(--accent) 16%, transparent)" stroke="none" />
        <path d={solidPath} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {dashedPath && (
          <path d={dashedPath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity="0.75" />
        )}
        {hasFuture && (
          <line x1={x(boundary).toFixed(1)} y1={pad} x2={x(boundary).toFixed(1)} y2={h - pad} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
        {refValue != null && isFinite(refValue) && (
          <>
            <line x1={pad} y1={y(refValue).toFixed(1)} x2={w - pad} y2={y(refValue).toFixed(1)} stroke="var(--pos)" strokeWidth="1" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" opacity="0.8">
              <title>{`${refLabel}: ${fmtBRL(refValue)}`}</title>
            </line>
            <text x={w - pad - 2} y={Math.max(10, y(refValue) - 3).toFixed(1)} textAnchor="end" className="chart-ref-label">
              {refLabel}
            </text>
          </>
        )}
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={p.future ? 1.8 : 2.3} fill="var(--accent)" opacity={p.future ? 0.75 : 1}>
            <title>{`${p.label}: ${fmtBRL(p.value)}${p.future ? " (projetado)" : ""}`}</title>
          </circle>
        ))}
      </svg>
      <div className="linechart-x">
        <span>{points[0].label}</span>
        <span>{points[points.length - 1].label}{hasFuture ? " (proj.)" : ""}</span>
      </div>
    </div>
  );
}

// Barras duplas (entradas × saídas por mês).
export function BarsDuo({ items, height = 90 }) {
  const max = Math.max(...items.flatMap((i) => [i.a, i.b]), 1);
  return (
    <div className="bars" style={{ height }}>
      {items.map((it, i) => (
        <div className="bar-col" key={i} title={`${it.label} — Entradas: ${fmtBRL(it.a)} · Saídas: ${fmtBRL(it.b)}`}>
          <div className="bar-space duo">
            <div className="bar" style={{ height: `${Math.round((it.a / max) * 100)}%`, background: "var(--pos)" }} />
            <div className="bar" style={{ height: `${Math.round((it.b / max) * 100)}%`, background: "var(--neg)" }} />
          </div>
          <span className="bar-label">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// Barras verticais simples (ex.: gasto por semana).
export function Bars({ items, height = 90, color = "var(--accent)" }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="bars" style={{ height }}>
      {items.map((it, i) => (
        <div className="bar-col" key={i} title={`${it.label}: ${fmtBRL(it.value)}`}>
          <div className="bar-space">
            <div
              className="bar"
              style={{ height: `${Math.round((it.value / max) * 100)}%`, background: it.highlight ? color : "color-mix(in srgb, " + "var(--accent) 45%, var(--border))" }}
            />
          </div>
          <span className="bar-label">{it.label}</span>
        </div>
      ))}
    </div>
  );
}
