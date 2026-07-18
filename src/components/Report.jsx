import React, { useMemo } from "react";
import { fmtBRL, fmtPct, monthLabel } from "../format";
import { computeMonthlyReport } from "../report";
import { Modal } from "./ui";

export default function Report({ data, month, onClose }) {
  const r = useMemo(() => computeMonthlyReport(data, month), [data, month]);

  const vsMedia =
    r.mediaAnterior != null && r.mediaAnterior > 0
      ? ((r.saidas - r.mediaAnterior) / r.mediaAnterior) * 100
      : null;

  return (
    <Modal title={`Resumo de ${monthLabel(month)}`} onClose={onClose}>
      {r.count === 0 ? (
        <p className="hint">Nenhuma transação registrada neste mês.</p>
      ) : (
        <div className="report">
          <div className="summary-row">
            <div className="stat">
              <span className="stat-label">Entradas</span>
              <span className="stat-value pos">{fmtBRL(r.entradas)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Saídas</span>
              <span className="stat-value neg">{fmtBRL(r.saidas)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Saldo</span>
              <span className={"stat-value " + (r.saldo >= 0 ? "pos" : "neg")}>{fmtBRL(r.saldo)}</span>
            </div>
          </div>

          {vsMedia != null && (
            <p className={"report-line " + (vsMedia <= 0 ? "pos" : "neg")}>
              {vsMedia <= 0 ? "▼" : "▲"} Você gastou {fmtPct(Math.abs(vsMedia), false)}{" "}
              {vsMedia <= 0 ? "a menos" : "a mais"} que a sua média recente ({fmtBRL(r.mediaAnterior)}/mês).
            </p>
          )}

          {r.topCategorias.length > 0 && (
            <div className="report-block">
              <h4>Maiores categorias</h4>
              {r.topCategorias.map((c) => (
                <div className="report-row" key={c.id}>
                  <span className="dot" style={{ background: c.color }} />
                  <span className="report-name">{c.name}</span>
                  <span className="report-val">{fmtBRL(c.total)}</span>
                </div>
              ))}
            </div>
          )}

          {r.topEstabelecimentos.length > 0 && (
            <div className="report-block">
              <h4>Onde você mais gastou</h4>
              {r.topEstabelecimentos.map((m, i) => (
                <div className="report-row" key={i}>
                  <span className="report-name">{m.name}</span>
                  <span className="report-times">{m.count}×</span>
                  <span className="report-val">{fmtBRL(m.total)}</span>
                </div>
              ))}
            </div>
          )}

          {(r.assinaturas > 0 || r.aportes > 0 || r.patrimonio) && (
            <div className="report-block">
              <h4>Mais do mês</h4>
              {r.assinaturas > 0 && (
                <div className="report-row">
                  <span className="report-name">Assinaturas</span>
                  <span className="report-val">{fmtBRL(r.assinaturas)}</span>
                </div>
              )}
              {r.aportes > 0 && (
                <div className="report-row">
                  <span className="report-name">Aportes em investimentos</span>
                  <span className="report-val">{fmtBRL(r.aportes)}</span>
                </div>
              )}
              {r.patrimonio && (
                <div className="report-row">
                  <span className="report-name">Patrimônio no mês</span>
                  <span className="report-val">
                    {fmtBRL(r.patrimonio.inicio)} → {fmtBRL(r.patrimonio.fim)}{" "}
                    <span className={r.patrimonio.fim - r.patrimonio.inicio >= 0 ? "pos" : "neg"}>
                      ({r.patrimonio.fim - r.patrimonio.inicio >= 0 ? "+" : ""}
                      {fmtBRL(r.patrimonio.fim - r.patrimonio.inicio)})
                    </span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
