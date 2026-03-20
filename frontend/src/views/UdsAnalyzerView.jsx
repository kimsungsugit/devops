import { useEffect, useMemo, useState, useCallback } from "react";
import UdsViewerWorkspace from "../components/UdsViewerWorkspace";
import TraceabilityPanel from "../components/TraceabilityPanel";
import StsGeneratorPanel from "../components/StsGeneratorPanel";
import SutsGeneratorPanel from "../components/SutsGeneratorPanel";
import ReportMarkdownPreview from "../components/ReportMarkdownPreview";

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
          <button
            key={item.title}
            type="button"
            className="latest-run-entry"
            onClick={() => typeof onOpen === "function" && onOpen(String(item.title || "").toLowerCase())}
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
          </button>
        ))}
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
  sourceRoot = "",
  setSourceRoot,
  pickDirectory,
  pickFile,
  preferredArtifactType = "",
}) => {
  const [artifactType, setArtifactType] = useState("uds");
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
    if (preferred === "uds" || preferred === "sts" || preferred === "suts") {
      setArtifactType(preferred);
    }
  }, [preferredArtifactType]);

  useEffect(() => {
    const handler = (event) => {
      const preferred = String(event?.detail?.artifact || "").trim().toLowerCase();
      if (preferred === "uds" || preferred === "sts" || preferred === "suts") {
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
        <button type="button" className={`segmented-btn ${artifactType === "uds" ? "active" : ""}`} onClick={() => setArtifactType("uds")}>UDS</button>
        <button type="button" className={`segmented-btn ${artifactType === "sts" ? "active" : ""}`} onClick={() => setArtifactType("sts")}>STS</button>
        <button type="button" className={`segmented-btn ${artifactType === "suts" ? "active" : ""}`} onClick={() => setArtifactType("suts")}>SUTS</button>
      </div>

      {artifactType === "uds" ? (
        <>
          <div className="row">
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
              <option value="local">Local UDS</option>
              <option value="jenkins">Jenkins UDS</option>
            </select>
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
