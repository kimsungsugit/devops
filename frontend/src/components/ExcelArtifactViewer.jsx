import { useMemo, useCallback, useState } from "react";
import ReportMarkdownPreview from "./ReportMarkdownPreview";

const formatValue = (item) => {
  if (!item) return "-";
  const value = item.value;
  if (typeof value === "number") {
    const fixed = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return `${fixed}${item.unit || ""}`;
  }
  return `${value ?? "-"}${item.unit || ""}`;
};

export default function ExcelArtifactViewer({
  artifactType,
  title,
  viewData,
  previewData,
  previewLoading,
  previewSheet,
  onPreviewSheetChange,
  onLoadPreview,
  files,
  filesLoading,
  onRefreshFiles,
  onOpenFile,
}) {
  const [reportState, setReportState] = useState({ title: "", path: "", text: "", loading: false, error: "" });
  const openLocalPath = useCallback(async (path) => {
    if (!path) return;
    try {
      const res = await fetch("/api/local/open-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
    } catch (_) {
      // ignore open errors in viewer
    }
  }, []);
  const loadReport = useCallback(async (path, title) => {
    if (!path) return;
    setReportState({ title, path, text: "", loading: true, error: "" });
    try {
      const res = await fetch("/api/local/editor/read-abs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, max_bytes: 200000 }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReportState({
        title,
        path,
        text: String(data?.text || ""),
        loading: false,
        error: data?.truncated ? "Report truncated for preview." : "",
      });
    } catch (err) {
      setReportState({ title, path, text: "", loading: false, error: err?.message || String(err) });
    }
  }, []);
  const summary = viewData?.summary || {};
  const primary = Array.isArray(summary?.primary) ? summary.primary : [];
  const secondary = Array.isArray(summary?.secondary) ? summary.secondary : [];
  const validation = viewData?.validation || {};
  const fileRows = Array.isArray(files) ? files : [];
  const activeSheet = useMemo(() => {
    const sheets = Array.isArray(previewData?.sheets) ? previewData.sheets : [];
    return sheets[previewSheet] || null;
  }, [previewData, previewSheet]);

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ margin: 0 }}>{title}</h4>
        <button type="button" className="btn-outline" onClick={onRefreshFiles} disabled={filesLoading}>
          {filesLoading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {viewData ? (
        <>
          <div className="hint" style={{ marginTop: 6 }}>
            {String(viewData.filename || "").trim() || `${artifactType} result`}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginTop: 12 }}>
            {primary.map((item) => (
              <div key={item.key} className="card" style={{ padding: 12 }}>
                <div className="hint">{item.label}</div>
                <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>{formatValue(item)}</div>
              </div>
            ))}
          </div>
          {secondary.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 10 }}>
              {secondary.map((item) => (
                <div key={item.key} className="card" style={{ padding: 10 }}>
                  <div className="hint">{item.label}</div>
                  <div>{formatValue(item)}</div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="card" style={{ padding: 12, marginTop: 10 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>Validation</strong>
              <span>{validation?.valid ? "PASS" : "CHECK"}</span>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              issues {Array.isArray(validation?.issues) ? validation.issues.length : 0} / warnings {Array.isArray(validation?.warnings) ? validation.warnings.length : 0}
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            {viewData.download_url ? (
              <a href={viewData.download_url} target="_blank" rel="noreferrer" className="btn-outline">
                Download
              </a>
            ) : null}
            {typeof onLoadPreview === "function" && viewData.filename ? (
              <button type="button" className="btn-outline" onClick={() => onLoadPreview(viewData.filename)} disabled={previewLoading}>
                {previewLoading ? "Loading preview..." : "Preview"}
              </button>
            ) : null}
            {viewData.validation_report_path ? (
              <button type="button" className="btn-outline" onClick={() => loadReport(viewData.validation_report_path, "Validation Report")}>
                View Validation
              </button>
            ) : null}
            {viewData.residual_report_path ? (
              <button type="button" className="btn-outline" onClick={() => loadReport(viewData.residual_report_path, "Residual Report")}>
                View Residual
              </button>
            ) : null}
            {viewData.validation_report_path ? (
              <button type="button" className="btn-outline" onClick={() => openLocalPath(viewData.validation_report_path)}>
                Open Validation
              </button>
            ) : null}
            {viewData.residual_report_path ? (
              <button type="button" className="btn-outline" onClick={() => openLocalPath(viewData.residual_report_path)}>
                Open Residual
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="empty" style={{ marginTop: 12 }}>No result loaded.</div>
      )}

      {previewData ? (
        <div style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h5 style={{ margin: 0 }}>Preview</h5>
            <span className="hint">{previewData.filename}</span>
          </div>
          {Array.isArray(previewData.sheet_names) && previewData.sheet_names.length > 1 ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
              {previewData.sheet_names.map((name, idx) => (
                <button
                  key={name}
                  type="button"
                  className={previewSheet === idx ? "" : "btn-outline"}
                  onClick={() => onPreviewSheetChange(idx)}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}
          {activeSheet ? (
            <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto", border: "1px solid var(--border, #444)", borderRadius: 6 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                <thead>
                  <tr style={{ position: "sticky", top: 0, background: "var(--bg-alt, #1e1e2e)" }}>
                    <th style={{ padding: "6px 8px", textAlign: "left" }}>#</th>
                    {activeSheet.headers.map((header, idx) => (
                      <th key={idx} style={{ padding: "6px 8px", textAlign: "left" }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeSheet.rows.map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      <td style={{ padding: "4px 8px" }}>{rowIdx + 1}</td>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} style={{ padding: "4px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{String(cell ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {reportState.path ? (
        <div className="card" style={{ padding: 12, marginTop: 14 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>{reportState.title || "Report"}</strong>
            <span className="hint">{reportState.path.split(/[\\/]/).pop()}</span>
          </div>
          {reportState.loading ? <div className="hint" style={{ marginTop: 8 }}>Loading report...</div> : null}
          {reportState.error ? <div className="hint" style={{ marginTop: 8 }}>{reportState.error}</div> : null}
          {reportState.text ? (
            <ReportMarkdownPreview text={reportState.text} style={{ marginTop: 10, maxHeight: 360, overflow: "auto" }} />
          ) : null}
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h5 style={{ margin: 0 }}>History</h5>
          <span className="hint">{fileRows.length} files</span>
        </div>
        {fileRows.length === 0 ? (
          <div className="empty">No generated files.</div>
        ) : (
          <div className="list">
            {fileRows.map((row) => {
              const rowSummary = row?.summary || {};
              const rowPrimary = Array.isArray(rowSummary?.primary) ? rowSummary.primary.slice(0, 2) : [];
              return (
                <div key={row.filename} className="list-item" style={{ display: "grid", gap: 6 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{row.filename}</strong>
                    <div className="row" style={{ gap: 8 }}>
                      <button type="button" className="btn-outline" onClick={() => onOpenFile(row.filename)}>View</button>
                      <button type="button" className="btn-outline" onClick={() => onLoadPreview(row.filename)} disabled={previewLoading}>Preview</button>
                      {row.validation_report_path ? (
                        <button type="button" className="btn-outline" onClick={() => loadReport(row.validation_report_path, `Validation: ${row.filename}`)}>
                          Validation
                        </button>
                      ) : null}
                      {row.residual_report_path ? (
                        <button type="button" className="btn-outline" onClick={() => loadReport(row.residual_report_path, `Residual: ${row.filename}`)}>
                          Residual
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {rowPrimary.length > 0 ? (
                    <div className="hint">{rowPrimary.map((item) => `${item.label}: ${formatValue(item)}`).join(" | ")}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {viewData ? (
        <details className="detail-raw" style={{ marginTop: 12 }}>
          <summary>Raw payload</summary>
          <pre className="json">{JSON.stringify(viewData, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}
