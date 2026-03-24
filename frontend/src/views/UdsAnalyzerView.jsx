import { useEffect, useMemo, useState, useCallback } from "react";
import UdsViewerWorkspace from "../components/UdsViewerWorkspace";
import TraceabilityPanel from "../components/TraceabilityPanel";
import StsGeneratorPanel from "../components/StsGeneratorPanel";
import SutsGeneratorPanel from "../components/SutsGeneratorPanel";
import ReportMarkdownPreview from "../components/ReportMarkdownPreview";
import { LocalScmPanel } from "../components/local";

const fetchJson = async (url, options = {}) => {
  const timeoutMs = Number(options?.timeoutMs || 180000);
  const { timeoutMs: _omitTimeout, ...rest } = options || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: rest?.signal || controller.signal });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Request timeout (${Math.round(timeoutMs / 1000)}s)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

const isAbsolutePath = (value) => /^[a-zA-Z]:[\\/]/.test(String(value || "")) || String(value || "").startsWith("/");

const buildQuery = (params) => {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    qs.set(key, String(value));
  });
  return qs.toString();
};

const IMPACT_TARGETS = ["uds", "suts", "sts", "sds"];

const summarizeUdsDiff = (row) => {
  const before = row?.before || {};
  const after = row?.after || {};
  return `calls ${before.calls_count || 0} -> ${after.calls_count || 0}, globals ${before.globals_count || 0} -> ${after.globals_count || 0}, outputs ${before.output_count || 0} -> ${after.output_count || 0}`;
};

const summarizeUds = (data) => {
  const mapping = data?.summary?.mapping || {};
  return {
    title: "UDS",
    filename: data?.filename || "",
    primary: [
      { label: "Total", value: mapping.total ?? 0 },
      { label: "Direct", value: mapping.direct ?? 0 },
      { label: "Fallback", value: mapping.fallback ?? 0 },
    ],
    validation: { valid: mapping.unmapped === 0 },
    generatedAt: data?.summary?.generated_at || "",
    downloadUrl: data?.download_url || "",
    validationReportPath: data?.validation_report_path || "",
    buildLabel: data?.summary?.build_label || data?.build_label || "",
  };
};

const summarizeExcel = (title, data) => {
  const primary = Array.isArray(data?.summary?.primary) ? data.summary.primary.slice(0, 3) : [];
  return {
    title,
    filename: data?.filename || "",
    primary,
    validation: data?.summary?.validation || null,
    generatedAt: data?.summary?.generated_at || "",
    downloadUrl: data?.download_url || "",
    validationReportPath: data?.validation_report_path || "",
    buildLabel: data?.summary?.build_label || data?.build_label || "",
  };
};

const SummaryCard = ({ item, onClick }) => (
  <button
    type="button"
    className="card"
    style={{ padding: 14, textAlign: "left", cursor: "pointer", width: "100%" }}
    onClick={onClick}
  >
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <strong>{item.title}</strong>
      <span className="hint">Latest</span>
    </div>
    <div className="hint" style={{ marginTop: 6 }}>{item.filename || "No file"}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
      {item.primary.map((metric) => (
        <div key={metric.label} className="card" style={{ padding: 10 }}>
          <div className="hint">{metric.label}</div>
          <div style={{ fontWeight: 700 }}>{metric.value}{metric.unit || ""}</div>
        </div>
      ))}
    </div>
  </button>
);

const LatestRunCard = ({ items, onOpen, onPreviewReport, groupLabel }) => {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length === 0) return null;
  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong>Latest Run</strong>
        <span className="hint">{groupLabel ? `${groupLabel} · ` : ""}{rows.length} artifacts</span>
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {rows.map((item) => (
          <div
            key={item.title}
            className="latest-run-entry"
            role="button"
            tabIndex={0}
            onClick={() => typeof onOpen === "function" && onOpen(String(item.title || "").toLowerCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (typeof onOpen === "function") onOpen(String(item.title || "").toLowerCase());
              }
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{item.title}</div>
              <div className="hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.filename || "No file"}
              </div>
              {item.generatedAt ? <div className="hint">{item.generatedAt}</div> : null}
              {item.buildLabel ? <div className="hint">{item.buildLabel}</div> : null}
            </div>
            <div className="row" style={{ gap: 8, flexShrink: 0 }}>
              {item.downloadUrl ? (
                <a
                  href={item.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-outline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Download
                </a>
              ) : null}
              {item.validationReportPath ? (
                <button
                  type="button"
                  className="btn-outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof onPreviewReport === "function") onPreviewReport(item.validationReportPath, `${item.title} Validation`);
                  }}
                >
                  Validation
                </button>
              ) : null}
              <span className="badge">{item?.validation?.valid ? "PASS" : "CHECK"}</span>
              <span className="hint">{item.primary.map((metric) => `${metric.label}: ${metric.value}${metric.unit || ""}`).join(" | ")}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ImpactResultCard = ({ result }) => {
  const changedFiles = Array.isArray(result?.changed_files) ? result.changed_files : [];
  const changedFunctions = result?.changed_functions && typeof result.changed_functions === "object"
    ? Object.entries(result.changed_functions)
    : [];
  const direct = Array.isArray(result?.impacted_functions?.direct) ? result.impacted_functions.direct.length : 0;
  const indirect1 = Array.isArray(result?.impacted_functions?.indirect_1hop) ? result.impacted_functions.indirect_1hop.length : 0;
  const indirect2 = Array.isArray(result?.impacted_functions?.indirect_2hop) ? result.impacted_functions.indirect_2hop.length : 0;
  const actions = result?.actions && typeof result.actions === "object" ? Object.entries(result.actions) : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  return (
    <div className="card" style={{ padding: 14, marginTop: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong>Impact Summary</strong>
        <span className="badge">files {changedFiles.length} / funcs {changedFunctions.length}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 10 }}>
        <div className="card" style={{ padding: 10 }}>
          <div className="hint">Direct</div>
          <div style={{ fontWeight: 700 }}>{direct}</div>
        </div>
        <div className="card" style={{ padding: 10 }}>
          <div className="hint">Indirect 1-hop</div>
          <div style={{ fontWeight: 700 }}>{indirect1}</div>
        </div>
        <div className="card" style={{ padding: 10 }}>
          <div className="hint">Indirect 2-hop</div>
          <div style={{ fontWeight: 700 }}>{indirect2}</div>
        </div>
      </div>
      {actions.length > 0 ? (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {actions.map(([key, value]) => (
            <div key={key} className="row" style={{ justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontWeight: 600, textTransform: "uppercase" }}>{key}</span>
              <span className="hint">
                {String(value?.mode || "-").toUpperCase()} / {String(value?.status || "-")}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {changedFunctions.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Changed Functions</div>
          <div className="card" style={{ padding: 10, maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {changedFunctions.map(([name, change]) => `${name} : ${change}`).join("\n")}
          </div>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Warnings</div>
          <div className="card" style={{ padding: 10, maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {warnings.join("\n")}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const JenkinsImpactPanel = ({
  jenkinsJobUrl = "",
  setJenkinsJobUrl,
  jenkinsCacheRoot = "",
  setJenkinsCacheRoot,
  jenkinsBuildSelector = "",
  setJenkinsBuildSelector,
}) => {
  const [registryItems, setRegistryItems] = useState([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState("");
  const [scmId, setScmId] = useState("");
  const [buildNumber, setBuildNumber] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [targets, setTargets] = useState(["uds", "suts", "sts", "sds"]);
  const [jobState, setJobState] = useState(null);
  const [impactResult, setImpactResult] = useState(null);
  const [impactError, setImpactError] = useState("");
  const [auditItems, setAuditItems] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadRegistries = useCallback(async () => {
    setRegistryLoading(true);
    setRegistryError("");
    try {
      const data = await fetchJson("/api/scm/list", { timeoutMs: 30000 });
      const rows = Array.isArray(data?.items) ? data.items : [];
      setRegistryItems(rows);
      setScmId((prev) => prev || String(rows[0]?.id || ""));
    } catch (err) {
      setRegistryItems([]);
      setRegistryError(err?.message || String(err));
    } finally {
      setRegistryLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async (entryId) => {
    if (!String(entryId || "").trim()) {
      setAuditItems([]);
      return;
    }
    setAuditLoading(true);
    try {
      const data = await fetchJson(`/api/scm/audit/${encodeURIComponent(entryId)}?limit=10`, { timeoutMs: 30000 });
      setAuditItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setAuditItems([]);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRegistries();
  }, [loadRegistries]);

  useEffect(() => {
    loadAudit(scmId);
  }, [loadAudit, scmId]);

  const toggleTarget = (target) => {
    setTargets((prev) => (prev.includes(target) ? prev.filter((item) => item !== target) : [...prev, target]));
  };

  const startImpact = useCallback(async (dryRun) => {
    if (!String(scmId || "").trim()) {
      setImpactError("SCM registry selection is required.");
      return;
    }
    if (!String(jenkinsJobUrl || "").trim()) {
      setImpactError("Jenkins job URL is required.");
      return;
    }
    setImpactError("");
    setImpactResult(null);
    setJobState({ status: "queued", stage: "prepare", message: "Starting impact job..." });
    try {
      const launch = await fetchJson("/api/jenkins/impact/trigger-async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scm_id: scmId,
          build_number: Number(buildNumber || 0),
          job_url: jenkinsJobUrl,
          base_ref: baseRef,
          dry_run: Boolean(dryRun),
          targets,
        }),
        timeoutMs: 30000,
      });
      const jobId = String(launch?.job_id || "").trim();
      if (!jobId) throw new Error("impact job id missing");
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const statusData = await fetchJson(`/api/scm/impact-job/${encodeURIComponent(jobId)}`, { timeoutMs: 30000 });
        const job = statusData?.job || {};
        setJobState(job);
        if (job?.status === "completed") {
          const resultData = await fetchJson(`/api/scm/impact-job/${encodeURIComponent(jobId)}/result`, { timeoutMs: 30000 });
          setImpactResult(resultData?.result || {});
          await loadAudit(scmId);
          break;
        }
        if (job?.status === "failed") {
          const title = String(job?.error?.title || job?.error?.code || "Impact job failed");
          const detail = String(job?.error?.detail || "");
          throw new Error([title, detail].filter(Boolean).join(": "));
        }
      }
    } catch (err) {
      setImpactError(err?.message || String(err));
    }
  }, [baseRef, buildNumber, jenkinsJobUrl, loadAudit, scmId, targets]);

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong>Analyzer Impact (Jenkins)</strong>
        <button type="button" className="btn-outline" onClick={loadRegistries} disabled={registryLoading}>
          {registryLoading ? "Loading..." : "Refresh Registry"}
        </button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        Jenkins build context를 기준으로 변경 영향 분석과 문서 갱신을 실행합니다. UDS/STS/SUTS 탭은 같은 Jenkins 컨텍스트를 그대로 재사용합니다.
      </div>
      <div className="form-grid-2 compact" style={{ marginTop: 12 }}>
        <label>SCM Registry</label>
        <select value={scmId} onChange={(e) => setScmId(e.target.value)}>
          <option value="">Select registry</option>
          {registryItems.map((item) => (
            <option key={item.id} value={item.id}>{item.name || item.id}</option>
          ))}
        </select>
        <label>Jenkins Job URL</label>
        <input value={jenkinsJobUrl || ""} onChange={(e) => typeof setJenkinsJobUrl === "function" && setJenkinsJobUrl(e.target.value)} />
        <label>Cache Root</label>
        <input value={jenkinsCacheRoot || ""} onChange={(e) => typeof setJenkinsCacheRoot === "function" && setJenkinsCacheRoot(e.target.value)} />
        <label>Build Selector</label>
        <input value={jenkinsBuildSelector || ""} onChange={(e) => typeof setJenkinsBuildSelector === "function" && setJenkinsBuildSelector(e.target.value)} />
        <label>Build Number</label>
        <input value={buildNumber} onChange={(e) => setBuildNumber(e.target.value)} placeholder="0 = latest context" />
        <label>Base Ref</label>
        <input value={baseRef} onChange={(e) => setBaseRef(e.target.value)} placeholder="optional" />
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {IMPACT_TARGETS.map((target) => (
          <label key={target} className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={targets.includes(target)} onChange={() => toggleTarget(target)} />
            {target.toUpperCase()}
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="button" onClick={() => startImpact(true)}>Dry Run</button>
        <button type="button" onClick={() => startImpact(false)}>Run Impact</button>
      </div>
      {registryError ? <div className="error" style={{ marginTop: 8 }}>{registryError}</div> : null}
      {impactError ? <div className="error" style={{ marginTop: 8 }}>{impactError}</div> : null}
      {jobState ? (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>Job Status</strong>
            <span className="badge">{String(jobState?.status || "unknown").toUpperCase()}</span>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>{jobState?.stage || "-"} {jobState?.message ? `| ${jobState.message}` : ""}</div>
          {jobState?.progress ? (
            <pre className="json" style={{ marginTop: 10 }}>{JSON.stringify(jobState.progress, null, 2)}</pre>
          ) : null}
        </div>
      ) : null}
      {impactResult ? <ImpactResultCard result={impactResult} /> : null}
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <strong>Recent Jenkins Impact Runs</strong>
          <span className="hint">{auditLoading ? "Loading..." : `${auditItems.length} items`}</span>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {auditItems.map((item, index) => (
            <div key={`${item?.timestamp || index}`} className="card" style={{ padding: 10 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                <strong>{item?.timestamp || "-"}</strong>
                <span className="hint">{String(item?.trigger || "").toUpperCase()}</span>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                files {Array.isArray(item?.changed_files) ? item.changed_files.length : 0} / direct {Array.isArray(item?.impacted_functions?.direct) ? item.impacted_functions.direct.length : 0}
              </div>
            </div>
          ))}
          {!auditLoading && auditItems.length === 0 ? <div className="hint">No Jenkins impact runs found.</div> : null}
        </div>
      </div>
    </div>
  );
};

const UdsAnalyzerView = ({
  mode = "local",
  reportDir = "",
  jenkinsJobUrl = "",
  setJenkinsJobUrl,
  jenkinsCacheRoot = "",
  setJenkinsCacheRoot,
  jenkinsBuildSelector = "lastSuccessfulBuild",
  setJenkinsBuildSelector,
  sourceRoot = "",
  setSourceRoot,
  pickDirectory,
  pickFile,
  preferredArtifactType = "",
  scmMode,
  setScmMode,
  scmWorkdir,
  setScmWorkdir,
  scmRepoUrl,
  setScmRepoUrl,
  scmBranch,
  setScmBranch,
  scmDepth,
  setScmDepth,
  scmRevision,
  setScmRevision,
  runScm,
  scmOutput,
}) => {
  const [artifactType, setArtifactType] = useState("impact");
  const [udsDocMode, setUdsDocMode] = useState("current");
  const [stsDocMode, setStsDocMode] = useState("current");
  const [sutsDocMode, setSutsDocMode] = useState("current");
  const [docRegistryItems, setDocRegistryItems] = useState([]);
  const [docScmId, setDocScmId] = useState("");
  const [udsChangeHistoryItems, setUdsChangeHistoryItems] = useState([]);
  const [udsChangeHistoryLoading, setUdsChangeHistoryLoading] = useState(false);
  const [udsSelectedRunId, setUdsSelectedRunId] = useState("");
  const [udsSelectedChangeDetail, setUdsSelectedChangeDetail] = useState(null);
  const [stsChangeHistoryItems, setStsChangeHistoryItems] = useState([]);
  const [stsChangeHistoryLoading, setStsChangeHistoryLoading] = useState(false);
  const [stsSelectedRunId, setStsSelectedRunId] = useState("");
  const [stsSelectedChangeDetail, setStsSelectedChangeDetail] = useState(null);
  const [sutsChangeHistoryItems, setSutsChangeHistoryItems] = useState([]);
  const [sutsChangeHistoryLoading, setSutsChangeHistoryLoading] = useState(false);
  const [sutsSelectedRunId, setSutsSelectedRunId] = useState("");
  const [sutsSelectedChangeDetail, setSutsSelectedChangeDetail] = useState(null);
  const [sourceType, setSourceType] = useState(mode === "jenkins" ? "jenkins" : "local");
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState("");
  const [selectedFilename, setSelectedFilename] = useState("");
  const [selectedDocxPath, setSelectedDocxPath] = useState("");
  const [viewData, setViewData] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState("");
  const [genSrsDoc, setGenSrsDoc] = useState(null);
  const [genSdsDoc, setGenSdsDoc] = useState(null);
  const [genRefUdsDoc, setGenRefUdsDoc] = useState(null);
  const [genTemplateDoc, setGenTemplateDoc] = useState(null);
  const [genTestMode, setGenTestMode] = useState(false);
  const [genShowMappingEvidence, setGenShowMappingEvidence] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genNotice, setGenNotice] = useState("");
  const [genQualityGate, setGenQualityGate] = useState(null);
  const [opProgress, setOpProgress] = useState(0);
  const [opStep, setOpStep] = useState("Idle");
  const [opLogs, setOpLogs] = useState([]);
  const [summaryCards, setSummaryCards] = useState([]);
  const [reportPreview, setReportPreview] = useState({ title: "", path: "", text: "", loading: false, error: "" });

  // STS lifted state
  const [stsSourceRoot, setStsSourceRoot] = useState(sourceRoot || "");
  const [stsSrsPath, setStsSrsPath] = useState("");
  const [stsSdsPath, setStsSdsPath] = useState("");
  const [stsUdsPath, setStsUdsPath] = useState("");
  const [stsStpPath, setStsStpPath] = useState("");
  const [stsTemplatePath, setStsTemplatePath] = useState("");
  const [stsProjectId, setStsProjectId] = useState("HDPDM01");
  const [stsVersion, setStsVersion] = useState("v1.00");
  const [stsAsilLevel, setStsAsilLevel] = useState("ASIL-B");
  const [stsMaxTc, setStsMaxTc] = useState(5);
  const [stsLoading, setStsLoading] = useState(false);
  const [stsNotice, setStsNotice] = useState("");
  const [stsProgressPct, setStsProgressPct] = useState(0);
  const [stsProgressMsg, setStsProgressMsg] = useState("");
  const [stsFiles, setStsFiles] = useState([]);
  const [stsFilesLoading, setStsFilesLoading] = useState(false);
  const [stsViewData, setStsViewData] = useState(null);
  const [stsPreviewData, setStsPreviewData] = useState(null);
  const [stsPreviewLoading, setStsPreviewLoading] = useState(false);
  const [stsPreviewSheet, setStsPreviewSheet] = useState(0);

  // SUTS lifted state
  const [sutsSourceRoot, setSutsSourceRoot] = useState(sourceRoot || "");
  const [sutsTemplatePath, setSutsTemplatePath] = useState("");
  const [sutsProjectId, setSutsProjectId] = useState("HDPDM01");
  const [sutsVersion, setSutsVersion] = useState("v1.00");
  const [sutsAsilLevel, setSutsAsilLevel] = useState("ASIL-B");
  const [sutsMaxSeq, setSutsMaxSeq] = useState(6);
  const [sutsLoading, setSutsLoading] = useState(false);
  const [sutsNotice, setSutsNotice] = useState("");
  const [sutsProgressPct, setSutsProgressPct] = useState(0);
  const [sutsProgressMsg, setSutsProgressMsg] = useState("");
  const [sutsFiles, setSutsFiles] = useState([]);
  const [sutsFilesLoading, setSutsFilesLoading] = useState(false);
  const [sutsViewData, setSutsViewData] = useState(null);
  const [sutsPreviewData, setSutsPreviewData] = useState(null);
  const [sutsPreviewLoading, setSutsPreviewLoading] = useState(false);
  const [sutsPreviewSheet, setSutsPreviewSheet] = useState(0);

  const previewAbsReport = useCallback(async (path, title = "Validation Report") => {
    if (!path) return;
    setReportPreview({ title, path, text: "", loading: true, error: "" });
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
      setReportPreview({
        title,
        path,
        text: String(data?.text || ""),
        loading: false,
        error: data?.truncated ? "Report truncated for preview." : "",
      });
    } catch (err) {
      setReportPreview({
        title,
        path,
        text: "",
        loading: false,
        error: err?.message || String(err),
      });
    }
  }, []);

  const pushOpLog = (text) => {
    const line = `[${new Date().toLocaleTimeString()}] ${String(text || "")}`;
    setOpLogs((prev) => [line, ...prev].slice(0, 10));
  };

  const isLocal = sourceType === "local";
  const currentSourceRoot = String(sourceRoot || "").trim();

  const loadFiles = async () => {
    setOpProgress(10);
    setOpStep("Loading file list");
    setFilesLoading(true);
    setFilesError("");
    try {
      if (isLocal) {
        const qs = new URLSearchParams();
        if (String(reportDir || "").trim()) qs.set("report_dir", String(reportDir).trim());
        const query = qs.toString() ? `?${qs.toString()}` : "";
        const data = await fetchJson(`/api/local/uds/files${query}`, { timeoutMs: 120000 });
        const rows = Array.isArray(data) ? data : [];
        setFiles(rows);
        setSelectedFilename((prev) => (prev ? prev : String(rows[0]?.filename || "")));
      } else {
        const qs = buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot });
        const data = await fetchJson(`/api/jenkins/uds/list?${qs}`, { timeoutMs: 120000 });
        const rows = Array.isArray(data?.items) ? data.items : [];
        setFiles(rows);
        setSelectedFilename((prev) => (prev ? prev : String(rows[0]?.filename || "")));
      }
      setOpProgress(100);
      setOpStep("File list loaded");
    } catch (e) {
      setFiles([]);
      setFilesError(e?.message || String(e));
      setOpProgress(100);
      setOpStep(`File list failed: ${e?.message || String(e)}`);
    } finally {
      setFilesLoading(false);
    }
  };

  const loadView = async (filename, params = {}) => {
    const picked = String(filename || "").trim();
    if (!picked) return;
    setSelectedFilename(picked);
    setViewLoading(true);
    setViewError("");
    try {
      if (isLocal) {
        const rows = Array.isArray(files) ? files : [];
        const hit = rows.find((row) => String(row?.filename || row?.file || "").trim() === picked);
        const docxPath = String(hit?.path || "").trim() || String(selectedDocxPath || "").trim();
        const usePathMode = isAbsolutePath(docxPath);
        const qs = new URLSearchParams();
        Object.entries(params || {}).forEach(([k, v]) => {
          if (v === null || v === undefined || v === "") return;
          qs.set(k, String(v));
        });
        let data = null;
        if (usePathMode) {
          qs.set("docx_path", docxPath);
          data = await fetchJson(`/api/local/uds/view-by-path?${qs.toString()}`, { timeoutMs: 180000 });
          setSelectedDocxPath(docxPath);
        } else {
          if (String(reportDir || "").trim()) qs.set("report_dir", String(reportDir).trim());
          const query = qs.toString() ? `?${qs.toString()}` : "";
          data = await fetchJson(`/api/local/uds/view/${encodeURIComponent(picked)}${query}`, { timeoutMs: 180000 });
          setSelectedDocxPath("");
        }
        setViewData(data || null);
      } else {
        const qs = buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot, filename: picked, ...params });
        const data = await fetchJson(`/api/jenkins/uds/view?${qs}`, { timeoutMs: 180000 });
        setViewData(data || null);
      }
      setOpProgress(100);
      setOpStep("Detail loaded");
    } catch (e) {
      setViewData(null);
      setViewError(e?.message || String(e));
    } finally {
      setViewLoading(false);
    }
  };

  useEffect(() => {
    setSourceType(mode === "jenkins" ? "jenkins" : "local");
  }, [mode]);

  useEffect(() => {
    const val = String(sourceRoot || "").trim();
    if (val) {
      setStsSourceRoot(val);
      setSutsSourceRoot(val);
    }
  }, [sourceRoot]);

  const isJenkins = mode === "jenkins";
  const stsApiBase = isJenkins ? "/api/jenkins/sts" : "/api/local/sts";
  const sutsApiBase = isJenkins ? "/api/jenkins/suts" : "/api/local/suts";

  const loadStsFiles = useCallback(async () => {
    setStsFilesLoading(true);
    try {
      let data;
      if (isJenkins) {
        const qs = buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot });
        data = await fetchJson(`${stsApiBase}/list?${qs}`);
        setStsFiles(Array.isArray(data?.items) ? data.items : []);
      } else {
        data = await fetchJson(`${stsApiBase}/files`);
        setStsFiles(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      setStsNotice(e.message || String(e));
      setStsFiles([]);
    } finally {
      setStsFilesLoading(false);
    }
  }, [isJenkins, jenkinsCacheRoot, jenkinsJobUrl, stsApiBase]);

  const loadStsView = useCallback(async (filename) => {
    if (!filename) return;
    try {
      let data;
      if (isJenkins) {
        const qs = buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot, filename });
        data = await fetchJson(`${stsApiBase}/view?${qs}`);
      } else {
        data = await fetchJson(`${stsApiBase}/view/${encodeURIComponent(filename)}`);
      }
      setStsViewData(data || null);
    } catch (e) {
      setStsNotice(e.message || String(e));
    }
  }, [isJenkins, jenkinsCacheRoot, jenkinsJobUrl, stsApiBase]);

  const loadStsPreview = useCallback(async (filename) => {
    if (!filename) return;
    setStsPreviewLoading(true);
    setStsPreviewData(null);
    setStsPreviewSheet(0);
    try {
      let data;
      if (isJenkins) {
        const qs = buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot, filename, max_rows: 30 });
        data = await fetchJson(`${stsApiBase}/preview?${qs}`);
      } else {
        data = await fetchJson(`${stsApiBase}/preview/${encodeURIComponent(filename)}?max_rows=30`);
      }
      setStsPreviewData(data || null);
    } catch (e) {
      setStsNotice(e.message || String(e));
    } finally {
      setStsPreviewLoading(false);
    }
  }, [isJenkins, jenkinsCacheRoot, jenkinsJobUrl, stsApiBase]);

  const handleStsGenerate = useCallback(async () => {
    if (!String(stsSourceRoot || "").trim()) { setStsNotice("source root is required"); return; }
    if (!String(stsSrsPath || "").trim()) { setStsNotice("SRS path is required"); return; }
    setStsLoading(true);
    setStsNotice("");
    setStsProgressPct(0);
    setStsProgressMsg("Preparing...");
    try {
      const form = new FormData();
      form.append("source_root", stsSourceRoot.trim());
      form.append("srs_path", stsSrsPath.trim());
      if (stsSdsPath.trim()) form.append("sds_path", stsSdsPath.trim());
      if (stsUdsPath.trim()) form.append("uds_path", stsUdsPath.trim());
      if (stsStpPath.trim()) form.append("stp_path", stsStpPath.trim());
      if (stsTemplatePath.trim()) form.append("template_path", stsTemplatePath.trim());
      form.append("project_id", stsProjectId);
      form.append("version", stsVersion);
      form.append("asil_level", stsAsilLevel);
      form.append("max_tc_per_req", String(stsMaxTc));
      if (isJenkins) {
        form.append("job_url", jenkinsJobUrl);
        form.append("cache_root", jenkinsCacheRoot);
        form.append("build_selector", jenkinsBuildSelector);
      }
      const launch = await fetchJson(`${stsApiBase}/generate-async`, { method: "POST", body: form });
      const jobId = launch?.job_id;
      if (!jobId) throw new Error("job id missing");
      while (true) {
        await new Promise((r) => setTimeout(r, 3000));
        const qs = isJenkins
          ? buildQuery({ job_url: jenkinsJobUrl, build_selector: jenkinsBuildSelector, job_id: jobId })
          : buildQuery({ job_id: jobId });
        const pr = await fetchJson(`${stsApiBase}/progress?${qs}`);
        const progress = pr?.progress || {};
        setStsProgressPct(progress.percent || 0);
        setStsProgressMsg(progress.message || "");
        if (progress.error) throw new Error(progress.error);
        if (progress.done) {
          const result = progress.result || null;
          setStsViewData(result);
          await loadStsFiles();
          if (result?.filename) await loadStsPreview(result.filename);
          break;
        }
      }
      setStsNotice("STS generation completed");
    } catch (e) {
      setStsNotice(e.message || String(e));
    } finally {
      setStsLoading(false);
      setStsProgressPct(0);
      setStsProgressMsg("");
    }
  }, [isJenkins, jenkinsBuildSelector, jenkinsCacheRoot, jenkinsJobUrl, loadStsFiles, loadStsPreview, stsApiBase, stsAsilLevel, stsMaxTc, stsProjectId, stsSourceRoot, stsSrsPath, stsSdsPath, stsUdsPath, stsStpPath, stsTemplatePath, stsVersion]);

  const loadSutsFiles = useCallback(async () => {
    setSutsFilesLoading(true);
    try {
      let data;
      if (isJenkins) {
        const qs = buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot });
        data = await fetchJson(`${sutsApiBase}/list?${qs}`);
        setSutsFiles(Array.isArray(data?.items) ? data.items : []);
      } else {
        data = await fetchJson(`${sutsApiBase}/files`);
        setSutsFiles(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      setSutsNotice(e.message || String(e));
      setSutsFiles([]);
    } finally {
      setSutsFilesLoading(false);
    }
  }, [isJenkins, jenkinsCacheRoot, jenkinsJobUrl, sutsApiBase]);

  const loadSutsView = useCallback(async (filename) => {
    if (!filename) return;
    try {
      let data;
      if (isJenkins) {
        const qs = buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot, filename });
        data = await fetchJson(`${sutsApiBase}/view?${qs}`);
      } else {
        data = await fetchJson(`${sutsApiBase}/view/${encodeURIComponent(filename)}`);
      }
      setSutsViewData(data || null);
    } catch (e) {
      setSutsNotice(e.message || String(e));
    }
  }, [isJenkins, jenkinsCacheRoot, jenkinsJobUrl, sutsApiBase]);

  const loadSutsPreview = useCallback(async (filename) => {
    if (!filename) return;
    setSutsPreviewLoading(true);
    setSutsPreviewData(null);
    setSutsPreviewSheet(0);
    try {
      let data;
      if (isJenkins) {
        const qs = buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot, filename, max_rows: 30 });
        data = await fetchJson(`${sutsApiBase}/preview?${qs}`);
      } else {
        data = await fetchJson(`${sutsApiBase}/preview/${encodeURIComponent(filename)}?max_rows=30`);
      }
      setSutsPreviewData(data || null);
    } catch (e) {
      setSutsNotice(e.message || String(e));
    } finally {
      setSutsPreviewLoading(false);
    }
  }, [isJenkins, jenkinsCacheRoot, jenkinsJobUrl, sutsApiBase]);

  const handleSutsGenerate = useCallback(async () => {
    if (!String(sutsSourceRoot || "").trim()) { setSutsNotice("source root is required"); return; }
    setSutsLoading(true);
    setSutsNotice("");
    setSutsProgressPct(0);
    setSutsProgressMsg("Preparing...");
    try {
      const form = new FormData();
      form.append("source_root", sutsSourceRoot.trim());
      if (sutsTemplatePath.trim()) form.append("template_path", sutsTemplatePath.trim());
      form.append("project_id", sutsProjectId);
      form.append("version", sutsVersion);
      form.append("asil_level", sutsAsilLevel);
      form.append("max_sequences", String(sutsMaxSeq));
      if (isJenkins) {
        form.append("job_url", jenkinsJobUrl);
        form.append("cache_root", jenkinsCacheRoot);
        form.append("build_selector", jenkinsBuildSelector);
      }
      const launch = await fetchJson(`${sutsApiBase}/generate-async`, { method: "POST", body: form });
      const jobId = launch?.job_id;
      if (!jobId) throw new Error("job id missing");
      while (true) {
        await new Promise((r) => setTimeout(r, 3000));
        const qs = isJenkins
          ? buildQuery({ job_url: jenkinsJobUrl, build_selector: jenkinsBuildSelector, job_id: jobId })
          : buildQuery({ job_id: jobId });
        const pr = await fetchJson(`${sutsApiBase}/progress?${qs}`);
        const progress = pr?.progress || {};
        setSutsProgressPct(progress.percent || 0);
        setSutsProgressMsg(progress.message || "");
        if (progress.error) throw new Error(progress.error);
        if (progress.done) {
          const result = progress.result || null;
          setSutsViewData(result);
          await loadSutsFiles();
          if (result?.filename) await loadSutsPreview(result.filename);
          break;
        }
      }
      setSutsNotice("SUTS generation completed");
    } catch (e) {
      setSutsNotice(e.message || String(e));
    } finally {
      setSutsLoading(false);
      setSutsProgressPct(0);
      setSutsProgressMsg("");
    }
  }, [isJenkins, jenkinsBuildSelector, jenkinsCacheRoot, jenkinsJobUrl, loadSutsFiles, loadSutsPreview, sutsApiBase, sutsAsilLevel, sutsMaxSeq, sutsProjectId, sutsSourceRoot, sutsTemplatePath, sutsVersion]);

  useEffect(() => {
    const preferred = String(preferredArtifactType || "").trim().toLowerCase();
    if (preferred === "impact" || preferred === "uds" || preferred === "sts" || preferred === "suts") {
      setArtifactType(preferred);
    }
  }, [preferredArtifactType]);

  useEffect(() => {
    const handler = (event) => {
      const preferred = String(event?.detail?.artifact || "").trim().toLowerCase();
      if (preferred === "impact" || preferred === "uds" || preferred === "sts" || preferred === "suts") {
        setArtifactType(preferred);
      }
    };
    window.addEventListener("analyzer:preferred-artifact", handler);
    return () => window.removeEventListener("analyzer:preferred-artifact", handler);
  }, []);

  useEffect(() => {
    if (artifactType !== "uds") return;
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactType, sourceType, reportDir, jenkinsJobUrl, jenkinsCacheRoot]);

  useEffect(() => {
    if (artifactType !== "sts") return;
    loadStsFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactType, mode, jenkinsJobUrl, jenkinsCacheRoot]);

  useEffect(() => {
    if (artifactType !== "suts") return;
    loadSutsFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactType, mode, jenkinsJobUrl, jenkinsCacheRoot]);

  const loadRecentSummaries = useCallback(async () => {
    const cards = [];
    try {
      if (mode === "local") {
        const udsFiles = await fetchJson(`/api/local/uds/files${reportDir ? `?report_dir=${encodeURIComponent(reportDir)}` : ""}`);
        const latestUds = Array.isArray(udsFiles) ? udsFiles[0] : null;
        if (latestUds?.filename) {
          const udsView = await fetchJson(`/api/local/uds/view/${encodeURIComponent(latestUds.filename)}${reportDir ? `?report_dir=${encodeURIComponent(reportDir)}` : ""}`);
          cards.push(summarizeUds(udsView));
        }
        const stsFiles = await fetchJson(`/api/local/sts/files`);
        if (Array.isArray(stsFiles) && stsFiles[0]?.filename) {
          const stsView = await fetchJson(`/api/local/sts/view/${encodeURIComponent(stsFiles[0].filename)}`);
          cards.push(summarizeExcel("STS", stsView));
        }
        const sutsFiles = await fetchJson(`/api/local/suts/files`);
        if (Array.isArray(sutsFiles) && sutsFiles[0]?.filename) {
          const sutsView = await fetchJson(`/api/local/suts/view/${encodeURIComponent(sutsFiles[0].filename)}`);
          cards.push(summarizeExcel("SUTS", sutsView));
        }
      } else {
        if (!String(jenkinsJobUrl || "").trim() || !String(jenkinsCacheRoot || "").trim()) {
          setSummaryCards([]);
          return;
        }
        const base = buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot });
        const udsFiles = await fetchJson(`/api/jenkins/uds/list?${base}`);
        const latestUds = Array.isArray(udsFiles?.items) ? udsFiles.items[0] : null;
        if (latestUds?.filename) {
          const udsView = await fetchJson(`/api/jenkins/uds/view?${buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot, filename: latestUds.filename })}`);
          cards.push(summarizeUds(udsView));
        }
        const stsFiles = await fetchJson(`/api/jenkins/sts/list?${base}`);
        const latestSts = Array.isArray(stsFiles?.items) ? stsFiles.items[0] : null;
        if (latestSts?.filename) {
          const stsView = await fetchJson(`/api/jenkins/sts/view?${buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot, filename: latestSts.filename })}`);
          cards.push(summarizeExcel("STS", stsView));
        }
        const sutsFiles = await fetchJson(`/api/jenkins/suts/list?${base}`);
        const latestSuts = Array.isArray(sutsFiles?.items) ? sutsFiles.items[0] : null;
        if (latestSuts?.filename) {
          const sutsView = await fetchJson(`/api/jenkins/suts/view?${buildQuery({ job_url: jenkinsJobUrl, cache_root: jenkinsCacheRoot, filename: latestSuts.filename })}`);
          cards.push(summarizeExcel("SUTS", sutsView));
        }
      }
    } catch (_) {
      // keep partial cards only
    }
    setSummaryCards(cards);
  }, [jenkinsCacheRoot, jenkinsJobUrl, mode, reportDir]);

  const qaChecks = useMemo(() => {
    const byTitle = Object.fromEntries((summaryCards || []).map((item) => [item.title, item]));
    const hasAllArtifacts = ["UDS", "STS", "SUTS"].every((title) => byTitle[title]);
    const hasValidationLinks = (summaryCards || []).every((item) => !!item.validationReportPath);
    const latestMetricsReady = (summaryCards || []).every((item) => Array.isArray(item.primary) && item.primary.length > 0);
    const validationOk = (summaryCards || []).every((item) => item?.validation?.valid === true);
    return [
      { label: "Latest Run card shows UDS, STS, and SUTS artifacts.", ok: hasAllArtifacts },
      { label: "Latest Run rows can switch to the matching artifact tab.", ok: hasAllArtifacts },
      { label: "Latest Run rows have validation actions.", ok: hasValidationLinks },
      { label: "Latest Run rows expose summary metrics.", ok: latestMetricsReady },
      { label: "Current latest artifacts pass validation.", ok: validationOk },
      { label: "Preview panel is ready for report/preview review.", ok: true },
    ];
  }, [summaryCards]);

  const runGroupLabel = useMemo(() => {
    if (mode === "jenkins") return `Build ${jenkinsBuildSelector || "lastSuccessfulBuild"}`;
    return "Local latest";
  }, [jenkinsBuildSelector, mode]);

  useEffect(() => {
    loadRecentSummaries();
  }, [loadRecentSummaries]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const data = await fetchJson("/api/scm/list", { timeoutMs: 30000 });
        if (cancelled) return;
        const rows = Array.isArray(data?.items) ? data.items : [];
        setDocRegistryItems(rows);
        setDocScmId((prev) => prev || String(rows[0]?.id || ""));
      } catch {
        if (!cancelled) {
          setDocRegistryItems([]);
          setDocScmId("");
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (artifactType !== "uds" || udsDocMode !== "applied" || !String(docScmId || "").trim()) {
      if (udsDocMode !== "applied") {
        setUdsChangeHistoryItems([]);
        setUdsSelectedRunId("");
        setUdsSelectedChangeDetail(null);
      }
      return;
    }
    let cancelled = false;
    const run = async () => {
      setUdsChangeHistoryLoading(true);
      try {
        const data = await fetchJson(`/api/scm/change-history/${encodeURIComponent(docScmId)}?limit=20`, { timeoutMs: 30000 });
        if (cancelled) return;
        const rows = Array.isArray(data?.items) ? data.items : [];
        setUdsChangeHistoryItems(rows);
        setUdsSelectedRunId((prev) => prev || String(rows[0]?.run_id || ""));
      } catch {
        if (!cancelled) {
          setUdsChangeHistoryItems([]);
          setUdsSelectedRunId("");
        }
      } finally {
        if (!cancelled) setUdsChangeHistoryLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [artifactType, udsDocMode, docScmId]);

  useEffect(() => {
    if (artifactType !== "uds" || udsDocMode !== "applied" || !String(udsSelectedRunId || "").trim()) {
      if (udsDocMode !== "applied") setUdsSelectedChangeDetail(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const data = await fetchJson(`/api/scm/change-history/detail/${encodeURIComponent(udsSelectedRunId)}`, { timeoutMs: 30000 });
        if (!cancelled) setUdsSelectedChangeDetail(data?.item || null);
      } catch {
        if (!cancelled) setUdsSelectedChangeDetail(null);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [artifactType, udsDocMode, udsSelectedRunId]);

  useEffect(() => {
    if (artifactType !== "sts" || stsDocMode !== "applied" || !String(docScmId || "").trim()) {
      if (stsDocMode !== "applied") {
        setStsChangeHistoryItems([]);
        setStsSelectedRunId("");
        setStsSelectedChangeDetail(null);
      }
      return;
    }
    let cancelled = false;
    const run = async () => {
      setStsChangeHistoryLoading(true);
      try {
        const data = await fetchJson(`/api/scm/change-history/${encodeURIComponent(docScmId)}?limit=20`, { timeoutMs: 30000 });
        if (cancelled) return;
        const rows = Array.isArray(data?.items) ? data.items : [];
        setStsChangeHistoryItems(rows);
        setStsSelectedRunId((prev) => prev || String(rows[0]?.run_id || ""));
      } catch {
        if (!cancelled) {
          setStsChangeHistoryItems([]);
          setStsSelectedRunId("");
        }
      } finally {
        if (!cancelled) setStsChangeHistoryLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [artifactType, stsDocMode, docScmId]);

  useEffect(() => {
    if (artifactType !== "sts" || stsDocMode !== "applied" || !String(stsSelectedRunId || "").trim()) {
      if (stsDocMode !== "applied") setStsSelectedChangeDetail(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const data = await fetchJson(`/api/scm/change-history/detail/${encodeURIComponent(stsSelectedRunId)}`, { timeoutMs: 30000 });
        if (!cancelled) setStsSelectedChangeDetail(data?.item || null);
      } catch {
        if (!cancelled) setStsSelectedChangeDetail(null);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [artifactType, stsDocMode, stsSelectedRunId]);

  useEffect(() => {
    if (artifactType !== "suts" || sutsDocMode !== "applied" || !String(docScmId || "").trim()) {
      if (sutsDocMode !== "applied") {
        setSutsChangeHistoryItems([]);
        setSutsSelectedRunId("");
        setSutsSelectedChangeDetail(null);
      }
      return;
    }
    let cancelled = false;
    const run = async () => {
      setSutsChangeHistoryLoading(true);
      try {
        const data = await fetchJson(`/api/scm/change-history/${encodeURIComponent(docScmId)}?limit=20`, { timeoutMs: 30000 });
        if (cancelled) return;
        const rows = Array.isArray(data?.items) ? data.items : [];
        setSutsChangeHistoryItems(rows);
        setSutsSelectedRunId((prev) => prev || String(rows[0]?.run_id || ""));
      } catch {
        if (!cancelled) {
          setSutsChangeHistoryItems([]);
          setSutsSelectedRunId("");
        }
      } finally {
        if (!cancelled) setSutsChangeHistoryLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [artifactType, sutsDocMode, docScmId]);

  useEffect(() => {
    if (artifactType !== "suts" || sutsDocMode !== "applied" || !String(sutsSelectedRunId || "").trim()) {
      if (sutsDocMode !== "applied") setSutsSelectedChangeDetail(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const data = await fetchJson(`/api/scm/change-history/detail/${encodeURIComponent(sutsSelectedRunId)}`, { timeoutMs: 30000 });
        if (!cancelled) setSutsSelectedChangeDetail(data?.item || null);
      } catch {
        if (!cancelled) setSutsSelectedChangeDetail(null);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [artifactType, sutsDocMode, sutsSelectedRunId]);

  const analyzerTitle = useMemo(() => (isLocal ? "Analyzer (Local UDS)" : "Analyzer (Jenkins UDS)"), [isLocal]);
  const analyzerStatus = useMemo(() => {
    if (String(viewError || "").trim()) return { tone: "error", text: `Detail error: ${viewError}` };
    if (String(filesError || "").trim()) return { tone: "error", text: `File list error: ${filesError}` };
    if (filesLoading) return { tone: "loading", text: "Loading file list..." };
    if (viewLoading) return { tone: "loading", text: "Loading detail..." };
    if (String(genNotice || "").trim()) return { tone: "info", text: genNotice };
    return { tone: "idle", text: "Ready" };
  }, [filesError, filesLoading, genNotice, viewError, viewLoading]);

  const pickUdsFile = async () => {
    if (typeof pickFile !== "function") return;
    const picked = await pickFile("Select UDS file");
    if (!picked) return;
    const filename = String(picked).split(/[\\/]/).pop() || "";
    setFiles((prev) => ([{ filename, path: String(picked) }, ...(Array.isArray(prev) ? prev : [])]));
    setSelectedDocxPath(String(picked));
    await loadView(filename);
  };

  const runGenerateLocal = async () => {
    if (!isLocal) return;
    const src = String(sourceRoot || "").trim();
    if (!src) {
      setGenNotice("Code source root is required.");
      return;
    }
    if (!genSrsDoc && !genSdsDoc) {
      setGenNotice("Select at least one requirement document: SRS or SDS.");
      return;
    }
    setGenLoading(true);
    setGenNotice("UDS generation request in progress...");
    try {
      const reqId = `uds-gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const form = new FormData();
      form.append("source_root", src);
      if (genSrsDoc) form.append("req_files", genSrsDoc);
      if (genSdsDoc) form.append("req_files", genSdsDoc);
      if (genRefUdsDoc) form.append("req_files", genRefUdsDoc);
      if (genTemplateDoc) form.append("template_file", genTemplateDoc);
      form.append("ai_enable", "true");
      form.append("expand", "true");
      form.append("ai_detailed", "true");
      form.append("call_relation_mode", "code");
      form.append("rag_top_k", "12");
      form.append("globals_format_with_labels", "true");
      form.append("show_mapping_evidence", genShowMappingEvidence ? "true" : "false");
      form.append("test_mode", genTestMode ? "true" : "false");
      form.append("doc_only", genTestMode ? "false" : "true");
      if (String(reportDir || "").trim()) form.append("report_dir", String(reportDir).trim());
      const asyncRes = await fetchJson("/api/local/uds/generate-async", { method: "POST", body: form, headers: { "X-Req-Id": reqId }, timeoutMs: 30000 });
      const jobId = asyncRes?.job_id;
      if (!jobId) throw new Error("Async generation job id was not returned.");
      let data = null;
      const maxPollMs = genTestMode ? 3600000 : 600000;
      const pollStart = Date.now();
      while (Date.now() - pollStart < maxPollMs) {
        await new Promise((r) => setTimeout(r, 3000));
        const prog = await fetchJson(`/api/local/uds/progress?job_id=${jobId}`);
        const p = prog?.progress || {};
        const pct = Number(p?.percent || 0);
        if (pct > 0) {
          setOpProgress(Math.min(90, 30 + Math.round(pct * 0.6)));
          setOpStep(String(p?.message || `Progress ${pct}%`));
        }
        if (p?.done) {
          if (p?.error) throw new Error(p.error);
          data = p?.result || {};
          break;
        }
      }
      if (!data) throw new Error("UDS generation timed out.");
      const filename = String(data?.filename || "").trim();
      if (!filename) throw new Error("Generated filename is missing.");
      setGenQualityGate(data?.quick_quality_gate || null);
      setGenNotice(`Generated: ${filename}`);
      await loadFiles();
      await loadView(filename);
      await loadRecentSummaries();
    } catch (e) {
      setGenNotice(`Generation failed: ${e?.message || String(e)}`);
    } finally {
      setGenLoading(false);
      setOpProgress(100);
      setOpStep("UDS generation complete");
    }
  };

  return (
    <div className="panel">
      <h3>Analyzer</h3>
      <div className="hint">Analyzer now covers UDS, STS, and SUTS generation plus result views for Local and Jenkins modes.</div>

      <LatestRunCard
        items={summaryCards}
        onOpen={(artifact) => setArtifactType(artifact)}
        onPreviewReport={previewAbsReport}
        groupLabel={runGroupLabel}
      />

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <strong>QA Checklist</strong>
          <span className="hint">{qaChecks.filter((item) => item.ok).length}/{qaChecks.length} checks</span>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {qaChecks.map((item) => (
            <div key={item.label} className="row" style={{ justifyContent: "space-between", gap: 12 }}>
              <span className="hint">{item.label}</span>
              <span className={`badge ${item.ok ? "qa-pass" : "qa-check"}`}>{item.ok ? "PASS" : "CHECK"}</span>
            </div>
          ))}
        </div>
      </div>

      {reportPreview.path ? (
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>{reportPreview.title}</strong>
            <span className="hint">{reportPreview.path.split(/[\\/]/).pop()}</span>
          </div>
          {reportPreview.loading ? <div className="hint" style={{ marginTop: 8 }}>Loading report...</div> : null}
          {reportPreview.error ? <div className="hint" style={{ marginTop: 8 }}>{reportPreview.error}</div> : null}
          {reportPreview.text ? (
            <ReportMarkdownPreview text={reportPreview.text} style={{ marginTop: 10, maxHeight: 300, overflow: "auto" }} />
          ) : null}
        </div>
      ) : null}

      {summaryCards.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, margin: "12px 0" }}>
          {summaryCards.map((item) => (
            <SummaryCard
              key={item.title}
              item={item}
              onClick={() => setArtifactType(String(item.title || "").toLowerCase())}
            />
          ))}
        </div>
      ) : null}

      <div className="segmented" style={{ marginBottom: 12 }}>
        <button type="button" className={`segmented-btn ${artifactType === "impact" ? "active" : ""}`} onClick={() => setArtifactType("impact")}>Impact</button>
        <button type="button" className={`segmented-btn ${artifactType === "uds" ? "active" : ""}`} onClick={() => setArtifactType("uds")}>UDS</button>
        <button type="button" className={`segmented-btn ${artifactType === "sts" ? "active" : ""}`} onClick={() => setArtifactType("sts")}>STS</button>
        <button type="button" className={`segmented-btn ${artifactType === "suts" ? "active" : ""}`} onClick={() => setArtifactType("suts")}>SUTS</button>
      </div>

      {artifactType === "impact" ? (
        <>
          <div className="card" style={{ padding: 14, marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong>{mode === "jenkins" ? "Analyzer Mode: Jenkins Impact" : "Analyzer Mode: Local Impact"}</strong>
              <span className="badge">{mode === "jenkins" ? "JENKINS" : "LOCAL"}</span>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              Analyzer 안에서 변경 감지, 영향 분석, AUTO/FLAG 결과 확인, 생성 이후 결과 추적까지 한 흐름으로 처리합니다.
            </div>
          </div>
          {mode === "jenkins" ? (
            <JenkinsImpactPanel
              jenkinsJobUrl={jenkinsJobUrl}
              setJenkinsJobUrl={setJenkinsJobUrl}
              jenkinsCacheRoot={jenkinsCacheRoot}
              setJenkinsCacheRoot={setJenkinsCacheRoot}
              jenkinsBuildSelector={jenkinsBuildSelector}
              setJenkinsBuildSelector={setJenkinsBuildSelector}
            />
          ) : (
            <LocalScmPanel
              scmMode={scmMode}
              setScmMode={setScmMode}
              scmWorkdir={scmWorkdir}
              setScmWorkdir={setScmWorkdir}
              scmRepoUrl={scmRepoUrl}
              setScmRepoUrl={setScmRepoUrl}
              scmBranch={scmBranch}
              setScmBranch={setScmBranch}
              scmDepth={scmDepth}
              setScmDepth={setScmDepth}
              scmRevision={scmRevision}
              setScmRevision={setScmRevision}
              runScm={runScm}
              scmOutput={scmOutput}
            />
          )}
        </>
      ) : null}

      {artifactType === "uds" ? (
        <>
          <div className="row">
            <div className="segmented-group">
              <button type="button" className={`segmented-btn ${udsDocMode === "current" ? "active" : ""}`} onClick={() => setUdsDocMode("current")}>
                Current
              </button>
              <button type="button" className={`segmented-btn ${udsDocMode === "applied" ? "active" : ""}`} onClick={() => setUdsDocMode("applied")}>
                Applied
              </button>
            </div>
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
              <option value="local">Local UDS</option>
              <option value="jenkins">Jenkins UDS</option>
            </select>
            {udsDocMode === "applied" ? (
              <select value={docScmId} onChange={(e) => setDocScmId(e.target.value)}>
                <option value="">SCM Registry</option>
                {docRegistryItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.name || item.id}</option>
                ))}
              </select>
            ) : null}
            {!isLocal ? (
              <>
                <input placeholder="Jenkins Job URL" value={jenkinsJobUrl} onChange={(e) => (typeof setJenkinsJobUrl === "function" ? setJenkinsJobUrl(e.target.value) : null)} />
                <input placeholder="Jenkins Cache Root" value={jenkinsCacheRoot} onChange={(e) => (typeof setJenkinsCacheRoot === "function" ? setJenkinsCacheRoot(e.target.value) : null)} />
              </>
            ) : null}
            <input placeholder="Code Source Root" value={sourceRoot} onChange={(e) => (typeof setSourceRoot === "function" ? setSourceRoot(e.target.value) : null)} />
            {typeof pickDirectory === "function" ? (
              <button type="button" className="btn-outline" onClick={async () => {
                const picked = await pickDirectory("Select source root");
                if (picked && typeof setSourceRoot === "function") setSourceRoot(picked);
              }}>Browse</button>
            ) : null}
          </div>
          {udsDocMode === "applied" ? (
            <div className="card" style={{ padding: 14, marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <strong>UDS Applied Change History</strong>
                <span className="hint">{udsChangeHistoryLoading ? "loading..." : `${udsChangeHistoryItems.length} runs`}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 12, marginTop: 12 }}>
                <div className="card" style={{ padding: 10, maxHeight: 380, overflow: "auto" }}>
                  {udsChangeHistoryItems.length > 0 ? (
                    udsChangeHistoryItems.map((item) => (
                      <button
                        key={item.run_id}
                        type="button"
                        className={`latest-run-entry ${udsSelectedRunId === item.run_id ? "is-selected" : ""}`}
                        onClick={() => setUdsSelectedRunId(item.run_id)}
                        style={{ width: "100%", textAlign: "left", marginBottom: 8 }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{item.run_id}</div>
                          <div className="hint">{item.timestamp || "-"}</div>
                          <div className="hint">UDS {item.summary?.uds_changed_functions || 0} / SUTS {item.summary?.suts_changed_cases || 0}</div>
                        </div>
                        <span className="badge">{item.dry_run ? "DRY" : "RUN"}</span>
                      </button>
                    ))
                  ) : (
                    <div className="empty">No applied UDS change history.</div>
                  )}
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <strong>Applied Diff</strong>
                    <span className="hint">{udsSelectedChangeDetail?.run_id || "select run"}</span>
                  </div>
                  {udsSelectedChangeDetail ? (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
                        <div className="card" style={{ padding: 10 }}>
                          <div className="hint">Changed Files</div>
                          <div style={{ fontWeight: 700 }}>{Array.isArray(udsSelectedChangeDetail.changed_files) ? udsSelectedChangeDetail.changed_files.length : 0}</div>
                        </div>
                        <div className="card" style={{ padding: 10 }}>
                          <div className="hint">UDS Functions</div>
                          <div style={{ fontWeight: 700 }}>{udsSelectedChangeDetail.summary?.uds_changed_functions || 0}</div>
                        </div>
                        <div className="card" style={{ padding: 10 }}>
                          <div className="hint">STS Flagged</div>
                          <div style={{ fontWeight: 700 }}>{udsSelectedChangeDetail.summary?.sts_flagged || 0}</div>
                        </div>
                        <div className="card" style={{ padding: 10 }}>
                          <div className="hint">SDS Flagged</div>
                          <div style={{ fontWeight: 700 }}>{udsSelectedChangeDetail.summary?.sds_flagged || 0}</div>
                        </div>
                      </div>
                      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                        {Array.isArray(udsSelectedChangeDetail?.documents?.uds?.changed_functions) &&
                        udsSelectedChangeDetail.documents.uds.changed_functions.length > 0 ? (
                          udsSelectedChangeDetail.documents.uds.changed_functions.map((row) => (
                            <div key={row.name} className="latest-run-entry">
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 600 }}>{row.name}</div>
                                <div className="hint">{Array.isArray(row.fields_changed) ? row.fields_changed.join(", ") : "-"}</div>
                                <div className="hint">{summarizeUdsDiff(row)}</div>
                              </div>
                              <span className="badge">{Array.isArray(row.fields_changed) ? row.fields_changed.length : 0} fields</span>
                            </div>
                          ))
                        ) : (
                          <div className="empty">No UDS diff rows for the selected run.</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="empty" style={{ marginTop: 12 }}>Select a run to inspect applied UDS changes.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
          <div className={`analyzer-status-panel tone-${analyzerStatus.tone}`}>{analyzerStatus.text}</div>
          <div className="uds-op-panel">
            <div className="uds-op-row"><span className="detail-label">Operation</span><span className="detail-value">{opStep}</span></div>
            <div className="uds-op-progress"><div className="uds-op-progress-bar" style={{ width: `${Math.max(0, Math.min(100, opProgress))}%` }} /></div>
            <div className="uds-op-log">{opLogs.length > 0 ? opLogs.join("\n") : "Operation logs will appear here."}</div>
          </div>
          {isLocal ? (
            <div className="panel">
              <h4>UDS Generate</h4>
              <label>SRS document</label>
              <input type="file" accept=".docx,.pdf,.xlsx,.xls,.txt,.md" onChange={(e) => setGenSrsDoc(e.target.files?.[0] || null)} />
              <label>SDS document</label>
              <input type="file" accept=".docx,.pdf,.xlsx,.xls,.txt,.md" onChange={(e) => setGenSdsDoc(e.target.files?.[0] || null)} />
              <label>Reference UDS</label>
              <input type="file" accept=".docx,.pdf,.txt,.md" onChange={(e) => setGenRefUdsDoc(e.target.files?.[0] || null)} />
              <label>UDS template</label>
              <input type="file" accept=".docx" onChange={(e) => setGenTemplateDoc(e.target.files?.[0] || null)} />
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={genTestMode} onChange={(e) => setGenTestMode(Boolean(e.target.checked))} />Test mode</label>
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={genShowMappingEvidence} onChange={(e) => setGenShowMappingEvidence(Boolean(e.target.checked))} />Show mapping evidence</label>
              <div className="row"><button type="button" onClick={runGenerateLocal} disabled={genLoading}>{genLoading ? "Generating..." : "Generate UDS"}</button></div>
            </div>
          ) : null}
          <UdsViewerWorkspace
            title={analyzerTitle}
            files={files}
            selectedFilename={selectedFilename}
            onSelectedFilenameChange={setSelectedFilename}
            onRefreshFiles={loadFiles}
            onPickFile={pickUdsFile}
            filesLoading={filesLoading}
            filesError={filesError}
            onLoadView={loadView}
            viewData={viewData}
            viewLoading={viewLoading}
            viewError={viewError}
            urlStateKey={`analyzer_${sourceType}`}
            sourceRoot={currentSourceRoot}
          />
          <TraceabilityPanel
            sourceRoot={currentSourceRoot}
            pickDirectory={typeof pickDirectory === "function" ? async () => ({ path: await pickDirectory("Select path") }) : undefined}
            pickFile={typeof pickFile === "function" ? async (label) => pickFile(label || "Select requirement document") : undefined}
          />
        </>
      ) : null}

      <div style={{ display: artifactType === "sts" ? "" : "none" }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="segmented-group">
            <button type="button" className={`segmented-btn ${stsDocMode === "current" ? "active" : ""}`} onClick={() => setStsDocMode("current")}>
              Current
            </button>
            <button type="button" className={`segmented-btn ${stsDocMode === "applied" ? "active" : ""}`} onClick={() => setStsDocMode("applied")}>
              Applied
            </button>
          </div>
          {stsDocMode === "applied" ? (
            <select value={docScmId} onChange={(e) => setDocScmId(e.target.value)}>
              <option value="">SCM Registry</option>
              {docRegistryItems.map((item) => (
                <option key={item.id} value={item.id}>{item.name || item.id}</option>
              ))}
            </select>
          ) : null}
        </div>
        {stsDocMode === "applied" ? (
          <div className="card" style={{ padding: 14, marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong>STS Applied Change History</strong>
              <span className="hint">{stsChangeHistoryLoading ? "loading..." : `${stsChangeHistoryItems.length} runs`}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 12, marginTop: 12 }}>
              <div className="card" style={{ padding: 10, maxHeight: 360, overflow: "auto" }}>
                {stsChangeHistoryItems.length > 0 ? (
                  stsChangeHistoryItems.map((item) => (
                    <button
                      key={item.run_id}
                      type="button"
                      className={`latest-run-entry ${stsSelectedRunId === item.run_id ? "is-selected" : ""}`}
                      onClick={() => setStsSelectedRunId(item.run_id)}
                      style={{ width: "100%", textAlign: "left", marginBottom: 8 }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{item.run_id}</div>
                        <div className="hint">{item.timestamp || "-"}</div>
                        <div className="hint">STS {item.summary?.sts_flagged || 0} / SDS {item.summary?.sds_flagged || 0}</div>
                      </div>
                      <span className="badge">{item.dry_run ? "DRY" : "RUN"}</span>
                    </button>
                  ))
                ) : (
                  <div className="empty">No applied STS change history.</div>
                )}
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Applied Review</strong>
                  <span className="hint">{stsSelectedChangeDetail?.run_id || "select run"}</span>
                </div>
                {stsSelectedChangeDetail ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
                      <div className="card" style={{ padding: 10 }}>
                        <div className="hint">Changed Files</div>
                        <div style={{ fontWeight: 700 }}>{Array.isArray(stsSelectedChangeDetail.changed_files) ? stsSelectedChangeDetail.changed_files.length : 0}</div>
                      </div>
                      <div className="card" style={{ padding: 10 }}>
                        <div className="hint">STS Flagged</div>
                        <div style={{ fontWeight: 700 }}>{stsSelectedChangeDetail.summary?.sts_flagged || 0}</div>
                      </div>
                      <div className="card" style={{ padding: 10 }}>
                        <div className="hint">SDS Flagged</div>
                        <div style={{ fontWeight: 700 }}>{stsSelectedChangeDetail.summary?.sds_flagged || 0}</div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                      {Array.isArray(stsSelectedChangeDetail?.documents?.sts?.flagged_functions) &&
                      stsSelectedChangeDetail.documents.sts.flagged_functions.length > 0 ? (
                        stsSelectedChangeDetail.documents.sts.flagged_functions.map((name, idx) => (
                          <div key={`${name}-${idx}`} className="latest-run-entry">
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600 }}>{name}</div>
                              <div className="hint">review required</div>
                            </div>
                            <span className="badge">STS</span>
                          </div>
                        ))
                      ) : (
                        <div className="empty">No STS flagged functions for the selected run.</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="empty" style={{ marginTop: 12 }}>Select a run to inspect applied STS changes.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
        <StsGeneratorPanel
          pickDirectory={pickDirectory}
          pickFile={pickFile}
          isJenkins={isJenkins}
          sourceRoot={stsSourceRoot}
          onSourceRootChange={setStsSourceRoot}
          srsPath={stsSrsPath}
          onSrsPathChange={setStsSrsPath}
          sdsPath={stsSdsPath}
          onSdsPathChange={setStsSdsPath}
          udsPath={stsUdsPath}
          onUdsPathChange={setStsUdsPath}
          stpPath={stsStpPath}
          onStpPathChange={setStsStpPath}
          templatePath={stsTemplatePath}
          onTemplatePathChange={setStsTemplatePath}
          projectId={stsProjectId}
          onProjectIdChange={setStsProjectId}
          version={stsVersion}
          onVersionChange={setStsVersion}
          asilLevel={stsAsilLevel}
          onAsilLevelChange={setStsAsilLevel}
          maxTc={stsMaxTc}
          onMaxTcChange={setStsMaxTc}
          loading={stsLoading}
          notice={stsNotice}
          progressPct={stsProgressPct}
          progressMsg={stsProgressMsg}
          files={stsFiles}
          filesLoading={stsFilesLoading}
          viewData={stsViewData}
          previewData={stsPreviewData}
          previewLoading={stsPreviewLoading}
          previewSheet={stsPreviewSheet}
          onPreviewSheetChange={setStsPreviewSheet}
          onGenerate={handleStsGenerate}
          onRefreshFiles={loadStsFiles}
          onOpenFile={loadStsView}
          onLoadPreview={loadStsPreview}
        />
      </div>

      <div style={{ display: artifactType === "suts" ? "" : "none" }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="segmented-group">
            <button type="button" className={`segmented-btn ${sutsDocMode === "current" ? "active" : ""}`} onClick={() => setSutsDocMode("current")}>
              Current
            </button>
            <button type="button" className={`segmented-btn ${sutsDocMode === "applied" ? "active" : ""}`} onClick={() => setSutsDocMode("applied")}>
              Applied
            </button>
          </div>
          {sutsDocMode === "applied" ? (
            <select value={docScmId} onChange={(e) => setDocScmId(e.target.value)}>
              <option value="">SCM Registry</option>
              {docRegistryItems.map((item) => (
                <option key={item.id} value={item.id}>{item.name || item.id}</option>
              ))}
            </select>
          ) : null}
        </div>
        {sutsDocMode === "applied" ? (
          <div className="card" style={{ padding: 14, marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong>SUTS Applied Change History</strong>
              <span className="hint">{sutsChangeHistoryLoading ? "loading..." : `${sutsChangeHistoryItems.length} runs`}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 12, marginTop: 12 }}>
              <div className="card" style={{ padding: 10, maxHeight: 360, overflow: "auto" }}>
                {sutsChangeHistoryItems.length > 0 ? (
                  sutsChangeHistoryItems.map((item) => (
                    <button
                      key={item.run_id}
                      type="button"
                      className={`latest-run-entry ${sutsSelectedRunId === item.run_id ? "is-selected" : ""}`}
                      onClick={() => setSutsSelectedRunId(item.run_id)}
                      style={{ width: "100%", textAlign: "left", marginBottom: 8 }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{item.run_id}</div>
                        <div className="hint">{item.timestamp || "-"}</div>
                        <div className="hint">SUTS {item.summary?.suts_changed_cases || 0} / Seq {item.summary?.suts_changed_sequences || 0}</div>
                      </div>
                      <span className="badge">{item.dry_run ? "DRY" : "RUN"}</span>
                    </button>
                  ))
                ) : (
                  <div className="empty">No applied SUTS change history.</div>
                )}
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Applied Diff</strong>
                  <span className="hint">{sutsSelectedChangeDetail?.run_id || "select run"}</span>
                </div>
                {sutsSelectedChangeDetail ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
                      <div className="card" style={{ padding: 10 }}>
                        <div className="hint">Changed Files</div>
                        <div style={{ fontWeight: 700 }}>{Array.isArray(sutsSelectedChangeDetail.changed_files) ? sutsSelectedChangeDetail.changed_files.length : 0}</div>
                      </div>
                      <div className="card" style={{ padding: 10 }}>
                        <div className="hint">Changed Cases</div>
                        <div style={{ fontWeight: 700 }}>{sutsSelectedChangeDetail.summary?.suts_changed_cases || 0}</div>
                      </div>
                      <div className="card" style={{ padding: 10 }}>
                        <div className="hint">Sequences</div>
                        <div style={{ fontWeight: 700 }}>{sutsSelectedChangeDetail.summary?.suts_changed_sequences || 0}</div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                      {Array.isArray(sutsSelectedChangeDetail?.documents?.suts?.changed_cases) &&
                      sutsSelectedChangeDetail.documents.suts.changed_cases.length > 0 ? (
                        sutsSelectedChangeDetail.documents.suts.changed_cases.map((row, idx) => (
                          <div key={`${row.function || "fn"}-${idx}`} className="latest-run-entry">
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600 }}>{row.function || "-"}</div>
                              <div className="hint">{row.change_type || "regenerated"}</div>
                            </div>
                            <span className="badge">SUTS</span>
                          </div>
                        ))
                      ) : (
                        <div className="empty">No SUTS diff rows for the selected run.</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="empty" style={{ marginTop: 12 }}>Select a run to inspect applied SUTS changes.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
        <SutsGeneratorPanel
          pickDirectory={pickDirectory}
          pickFile={pickFile}
          isJenkins={isJenkins}
          sourceRoot={sutsSourceRoot}
          onSourceRootChange={setSutsSourceRoot}
          templatePath={sutsTemplatePath}
          onTemplatePathChange={setSutsTemplatePath}
          projectId={sutsProjectId}
          onProjectIdChange={setSutsProjectId}
          version={sutsVersion}
          onVersionChange={setSutsVersion}
          asilLevel={sutsAsilLevel}
          onAsilLevelChange={setSutsAsilLevel}
          maxSeq={sutsMaxSeq}
          onMaxSeqChange={setSutsMaxSeq}
          loading={sutsLoading}
          notice={sutsNotice}
          progressPct={sutsProgressPct}
          progressMsg={sutsProgressMsg}
          files={sutsFiles}
          filesLoading={sutsFilesLoading}
          viewData={sutsViewData}
          previewData={sutsPreviewData}
          previewLoading={sutsPreviewLoading}
          previewSheet={sutsPreviewSheet}
          onPreviewSheetChange={setSutsPreviewSheet}
          onGenerate={handleSutsGenerate}
          onRefreshFiles={loadSutsFiles}
          onOpenFile={loadSutsView}
          onLoadPreview={loadSutsPreview}
        />
      </div>
    </div>
  );
};

export default UdsAnalyzerView;
