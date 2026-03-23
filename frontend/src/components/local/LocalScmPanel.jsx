import { useEffect, useMemo, useState } from "react";
import ReportMarkdownPreview from "../ReportMarkdownPreview";

const ACTION_ORDER = ["uds", "suts", "sts", "sds"];

const toneForAction = (info) => {
  const mode = String(info?.mode || "-").toUpperCase();
  const status = String(info?.status || "").toLowerCase();
  if (status === "failed") return "failed";
  if (mode === "AUTO" && status === "completed") return "success";
  if (mode === "AUTO") return "check";
  if (mode === "FLAG") return "warning";
  return "neutral";
};

const summarizeLinkedDocs = (linkedDocs) =>
  ACTION_ORDER.map((key) => {
    const value = String(linkedDocs?.[key] || "").trim();
    if (!value) return null;
    return { key, value };
  }).filter(Boolean);

const basename = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const parts = raw.split(/[\\/]/);
  return parts[parts.length - 1] || raw;
};

const actionReason = (target, info) => {
  const mode = String(info?.mode || "-").toUpperCase();
  if (mode === "AUTO") return `${target.toUpperCase()} 자동 재생성`;
  if (mode === "FLAG") return `${target.toUpperCase()} 검토 필요`;
  return `${target.toUpperCase()} 영향 없음`;
};

const LocalScmPanel = ({
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
  const [registryItems, setRegistryItems] = useState([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [selectedScmId, setSelectedScmId] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusData, setStatusData] = useState(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactResult, setImpactResult] = useState(null);
  const [impactError, setImpactError] = useState("");
  const [manualChangedFiles, setManualChangedFiles] = useState("");
  const [targets, setTargets] = useState(["uds", "suts", "sts", "sds"]);
  const [artifactPreview, setArtifactPreview] = useState({ path: "", text: "", truncated: false });
  const [artifactPreviewLoading, setArtifactPreviewLoading] = useState(false);
  const [panelNotice, setPanelNotice] = useState("");

  const selectedRegistry = useMemo(
    () => registryItems.find((item) => item.id === selectedScmId) || null,
    [registryItems, selectedScmId]
  );
  const changedFiles = useMemo(
    () =>
      String(manualChangedFiles || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [manualChangedFiles]
  );
  const changedFunctionEntries = useMemo(
    () => Object.entries(impactResult?.changed_function_types || {}),
    [impactResult]
  );
  const impactGroups = impactResult?.impact || {};
  const linkedDocItems = useMemo(
    () => summarizeLinkedDocs(selectedRegistry?.linked_docs),
    [selectedRegistry]
  );

  const loadRegistry = async () => {
    setRegistryLoading(true);
    setImpactError("");
    try {
      const res = await fetch("/api/scm/list");
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      setRegistryItems(items);
      setSelectedScmId((prev) => {
        if (prev && items.some((item) => item.id === prev)) return prev;
        return items[0]?.id || "";
      });
    } catch (e) {
      setImpactError(`SCM registry 조회 실패: ${e.message}`);
    } finally {
      setRegistryLoading(false);
    }
  };

  useEffect(() => {
    loadRegistry();
  }, []);

  useEffect(() => {
    if (!selectedRegistry) return;
    setScmMode(selectedRegistry.scm_type || "git");
    setScmWorkdir(selectedRegistry.source_root || ".");
    setScmRepoUrl(selectedRegistry.scm_url || "");
    setScmBranch(selectedRegistry.branch || "");
    setScmRevision(selectedRegistry.base_ref || "");
  }, [
    selectedRegistry,
    setScmMode,
    setScmWorkdir,
    setScmRepoUrl,
    setScmBranch,
    setScmRevision,
  ]);

  useEffect(() => {
    if (!selectedScmId) {
      setStatusData(null);
      return;
    }
    const run = async () => {
      setStatusLoading(true);
      try {
        const res = await fetch(`/api/scm/status/${encodeURIComponent(selectedScmId)}`);
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        setStatusData(await res.json());
      } catch (e) {
        setStatusData({ ok: false, error: e.message });
      } finally {
        setStatusLoading(false);
      }
    };
    run();
  }, [selectedScmId]);

  const refreshStatus = async () => {
    if (!selectedScmId) return;
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/scm/status/${encodeURIComponent(selectedScmId)}`);
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      setStatusData(await res.json());
    } catch (e) {
      setPanelNotice(`상태 확인 실패: ${e.message}`);
    } finally {
      setStatusLoading(false);
    }
  };

  const openFile = async (path) => {
    if (!path) return;
    try {
      const res = await fetch("/api/local/open-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    } catch (e) {
      setPanelNotice(`파일 열기 실패: ${e.message}`);
    }
  };

  const openFolder = async (path) => {
    if (!path) return;
    try {
      const res = await fetch("/api/local/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    } catch (e) {
      setPanelNotice(`폴더 열기 실패: ${e.message}`);
    }
  };

  const previewArtifact = async (path) => {
    if (!path) return;
    setArtifactPreviewLoading(true);
    try {
      const res = await fetch("/api/local/preview-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, max_chars: 16000 }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      setArtifactPreview({
        path: data?.path || path,
        text: data?.text || "",
        truncated: !!data?.truncated,
      });
    } catch (e) {
      setPanelNotice(`리뷰 미리보기 실패: ${e.message}`);
    } finally {
      setArtifactPreviewLoading(false);
    }
  };

  const triggerImpact = async (dryRun) => {
    if (!selectedScmId) {
      setImpactError("SCM registry 항목을 먼저 선택하세요.");
      return;
    }
    setImpactLoading(true);
    setImpactError("");
    setPanelNotice("");
    setArtifactPreview({ path: "", text: "", truncated: false });
    try {
      const payload = {
        scm_id: selectedScmId,
        base_ref: selectedRegistry?.base_ref || "",
        dry_run: !!dryRun,
        targets,
        manual_changed_files: changedFiles,
      };
      const res = await fetch("/api/local/impact/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      setImpactResult(data);
      setPanelNotice(dryRun ? "Dry run 완료" : "Impact 실행 완료");
      if (!dryRun) {
        await loadRegistry();
      }
    } catch (e) {
      setImpactError(e.message);
      setImpactResult(null);
    } finally {
      setImpactLoading(false);
    }
  };

  const toggleTarget = (target) => {
    setTargets((prev) =>
      prev.includes(target) ? prev.filter((item) => item !== target) : [...prev, target]
    );
  };

  return (
    <div className="scm-impact-page">
      <div className="scm-impact-hero">
        <div>
          <h3>SCM Impact Console</h3>
          <p className="hint">
            변경 파일, 영향 함수, 자동 재생성 결과와 검토 필요 문서를 한 화면에서 확인합니다.
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn-outline" onClick={loadRegistry} disabled={registryLoading}>
            {registryLoading ? "Registry..." : "Registry 새로고침"}
          </button>
          <button type="button" className="btn-outline" onClick={refreshStatus} disabled={!selectedScmId || statusLoading}>
            {statusLoading ? "상태 확인..." : "연결 상태 확인"}
          </button>
        </div>
      </div>

      <div className="scm-impact-grid">
        <section className="panel scm-impact-card">
          <div className="scm-impact-card-header">
            <h4>Registry / SCM 상태</h4>
            <span className={`status-chip tone-${statusData?.status?.ok ? "success" : "info"}`}>
              {statusData?.status?.ok ? "Connected" : "Pending"}
            </span>
          </div>
          <div className="form-grid-2 compact">
            <label>등록 항목</label>
            <select value={selectedScmId} onChange={(e) => setSelectedScmId(e.target.value)}>
              <option value="">선택하세요</option>
              {registryItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.scm_type})
                </option>
              ))}
            </select>
            <label>SCM</label>
            <input value={selectedRegistry?.scm_type || scmMode || "-"} readOnly />
            <label>Source Root</label>
            <input value={selectedRegistry?.source_root || scmWorkdir || ""} readOnly />
            <label>Repo URL</label>
            <input value={selectedRegistry?.scm_url || scmRepoUrl || ""} readOnly />
            <label>Base Ref</label>
            <input value={selectedRegistry?.base_ref || scmRevision || ""} readOnly />
          </div>
          {statusData?.status && (
            <div className="scm-kpi-grid">
              <div className="scm-kpi-card">
                <div className="scm-kpi-label">Tool</div>
                <div className="scm-kpi-value">{statusData.status.tool_available ? "Available" : "Missing"}</div>
              </div>
              <div className="scm-kpi-card">
                <div className="scm-kpi-label">Working Copy</div>
                <div className="scm-kpi-value">{statusData.status.repo_detected ? "Detected" : "Not Detected"}</div>
              </div>
              <div className="scm-kpi-card">
                <div className="scm-kpi-label">Source Root</div>
                <div className="scm-kpi-value">{statusData.status.source_root_exists ? "Exists" : "Missing"}</div>
              </div>
              <div className="scm-kpi-card">
                <div className="scm-kpi-label">Password Env</div>
                <div className="scm-kpi-value">
                  {statusData.status.password_env_present ? "Present" : "Optional/Empty"}
                </div>
              </div>
            </div>
          )}
          {linkedDocItems.length > 0 && (
            <div className="scm-linked-list">
              <div className="detail-label">Linked Docs</div>
              {linkedDocItems.map((item) => (
                <div key={item.key} className="scm-linked-row">
                  <span className="status-chip tone-info">{item.key.toUpperCase()}</span>
                  <span className="list-text text-ellipsis">{basename(item.value)}</span>
                  <button type="button" className="btn-link" onClick={() => openFile(item.value)}>
                    열기
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel scm-impact-card">
          <div className="scm-impact-card-header">
            <h4>Impact Trigger</h4>
            {impactLoading && <span className="status-chip tone-check">Running</span>}
          </div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            {ACTION_ORDER.map((target) => (
              <label key={target} className="row-inline">
                <input
                  type="checkbox"
                  checked={targets.includes(target)}
                  onChange={() => toggleTarget(target)}
                />
                {target.toUpperCase()}
              </label>
            ))}
          </div>
          <label className="detail-label">수동 changed files</label>
          <textarea
            className="scm-impact-textarea"
            rows={7}
            value={manualChangedFiles}
            onChange={(e) => setManualChangedFiles(e.target.value)}
            placeholder={"Sources/APP/Ap_BuzzerCtrl_PDS.c\nSources/APP/Ap_BuzzerCtrl_it_PDS.h"}
          />
          <div className="hint">
            SVN working copy가 깨끗하면 여기서 검증용 changed files를 직접 넣을 수 있습니다.
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn-outline" disabled={impactLoading} onClick={() => triggerImpact(true)}>
              {impactLoading ? "분석 중..." : "Dry Run"}
            </button>
            <button type="button" disabled={impactLoading} onClick={() => triggerImpact(false)}>
              {impactLoading ? "실행 중..." : "실행"}
            </button>
          </div>
          {panelNotice && <div className="hint" style={{ marginTop: 10 }}>{panelNotice}</div>}
          {impactError && <div className="scm-impact-error">{impactError}</div>}
        </section>
      </div>

      <section className="panel scm-impact-card">
        <div className="scm-impact-card-header">
          <h4>Dry Run / 실행 결과</h4>
          <span className={`status-chip tone-${impactResult?.dry_run ? "info" : "success"}`}>
            {impactResult ? (impactResult.dry_run ? "Dry Run" : "Real Run") : "Idle"}
          </span>
        </div>
        <div className="scm-kpi-grid">
          <div className="scm-kpi-card">
            <div className="scm-kpi-label">Changed Files</div>
            <div className="scm-kpi-value">{impactResult?.trigger?.changed_files?.length || changedFiles.length || 0}</div>
          </div>
          <div className="scm-kpi-card">
            <div className="scm-kpi-label">Changed Functions</div>
            <div className="scm-kpi-value">{changedFunctionEntries.length}</div>
          </div>
          <div className="scm-kpi-card">
            <div className="scm-kpi-label">Direct Impact</div>
            <div className="scm-kpi-value">{impactGroups.direct?.length || 0}</div>
          </div>
          <div className="scm-kpi-card">
            <div className="scm-kpi-label">Indirect</div>
            <div className="scm-kpi-value">
              {(impactGroups.indirect_1hop?.length || 0) + (impactGroups.indirect_2hop?.length || 0)}
            </div>
          </div>
        </div>

        {Array.isArray(impactResult?.warnings) && impactResult.warnings.length > 0 && (
          <div className="scm-warning-box">
            {impactResult.warnings.map((warning, idx) => (
              <div key={`${warning}-${idx}`}>- {warning}</div>
            ))}
          </div>
        )}

        <div className="scm-action-grid">
          {ACTION_ORDER.map((target) => {
            const info = impactResult?.actions?.[target] || { mode: "-", status: "skipped", function_count: 0 };
            const outputPath = info.output_path || info.result?.output_path || "";
            const artifactPath = info.artifact_path || "";
            return (
              <div key={target} className={`scm-action-card tone-${toneForAction(info)}`}>
                <div className="scm-action-head">
                  <strong>{target.toUpperCase()}</strong>
                  <span className={`status-chip tone-${toneForAction(info)}`}>
                    {String(info.mode || "-").toUpperCase()} / {String(info.status || "skipped")}
                  </span>
                </div>
                <div className="hint">{actionReason(target, info)}</div>
                <div className="detail-value">대상 함수: {info.function_count || 0}</div>
                {outputPath ? (
                  <div className="scm-path-row">
                    <span className="list-text text-ellipsis">{basename(outputPath)}</span>
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn-link" onClick={() => openFile(outputPath)}>열기</button>
                      <button type="button" className="btn-link" onClick={() => openFolder(outputPath.replace(/[\\/][^\\/]+$/, ""))}>폴더</button>
                    </div>
                  </div>
                ) : null}
                {artifactPath ? (
                  <div className="scm-path-row">
                    <span className="list-text text-ellipsis">{basename(artifactPath)}</span>
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn-link" onClick={() => previewArtifact(artifactPath)}>미리보기</button>
                      <button type="button" className="btn-link" onClick={() => openFile(artifactPath)}>열기</button>
                    </div>
                  </div>
                ) : null}
                {info.error && <div className="scm-impact-error">{info.error}</div>}
              </div>
            );
          })}
        </div>

        <div className="scm-impact-grid scm-impact-results-grid">
          <div className="scm-impact-subcard">
            <h5>Changed Functions</h5>
            <div className="list compact">
              {changedFunctionEntries.length > 0 ? (
                changedFunctionEntries.map(([func, kind]) => (
                  <div key={func} className="list-item">
                    <span className={`status-chip tone-${kind === "HEADER" ? "warning" : "info"}`}>{kind}</span>
                    <span className="list-text text-ellipsis">{func}</span>
                  </div>
                ))
              ) : (
                <div className="empty">변경 함수 정보 없음</div>
              )}
            </div>
          </div>
          <div className="scm-impact-subcard">
            <h5>Impact Groups</h5>
            <div className="list compact">
              {["direct", "indirect_1hop", "indirect_2hop"].map((key) => (
                <div key={key} className="list-item">
                  <span className="status-chip tone-info">{key}</span>
                  <span className="list-text">{impactGroups[key]?.length || 0} functions</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="panel scm-impact-card">
        <div className="scm-impact-card-header">
          <h4>Review Artifact Preview</h4>
          {artifactPreview.path ? <span className="hint">{basename(artifactPreview.path)}</span> : null}
        </div>
        {artifactPreviewLoading ? (
          <div className="empty">리뷰 문서 불러오는 중...</div>
        ) : artifactPreview.text ? (
          <>
            <ReportMarkdownPreview text={artifactPreview.text} />
            {artifactPreview.truncated && <div className="hint">미리보기는 일부만 표시됩니다.</div>}
          </>
        ) : (
          <div className="empty">STS/SDS review artifact가 생성되면 여기서 바로 확인할 수 있습니다.</div>
        )}
      </section>

      <details className="panel scm-impact-card" open={false}>
        <summary>Legacy SCM Commands</summary>
        <div className="form-grid-2 compact" style={{ marginTop: 12 }}>
          <label>SCM</label>
          <select value={scmMode} onChange={(e) => setScmMode(e.target.value)}>
            <option value="git">Git</option>
            <option value="svn">SVN</option>
          </select>
          <label>작업 디렉터리</label>
          <input value={scmWorkdir} onChange={(e) => setScmWorkdir(e.target.value)} placeholder="작업 디렉터리" />
          <label>Repo URL</label>
          <input value={scmRepoUrl} onChange={(e) => setScmRepoUrl(e.target.value)} />
          {scmMode === "git" ? (
            <>
              <label>Branch</label>
              <input value={scmBranch} onChange={(e) => setScmBranch(e.target.value)} />
              <label>Depth</label>
              <input type="number" min={0} value={scmDepth} onChange={(e) => setScmDepth(Number(e.target.value))} />
            </>
          ) : (
            <>
              <label>Revision</label>
              <input value={scmRevision} onChange={(e) => setScmRevision(e.target.value)} />
              <span />
              <span />
            </>
          )}
        </div>
        <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
          {scmMode === "git" && (
            <>
              <button onClick={() => runScm("clone")}>Clone</button>
              <button onClick={() => runScm("fetch")}>Fetch</button>
              <button onClick={() => runScm("pull")}>Pull</button>
              <button onClick={() => runScm("checkout")}>Checkout</button>
            </>
          )}
          {scmMode === "svn" && (
            <>
              <button onClick={() => runScm("checkout")}>Checkout</button>
              <button onClick={() => runScm("update")}>Update</button>
              <button onClick={() => runScm("info")}>Info</button>
            </>
          )}
        </div>
        <pre className="json">{scmOutput || ""}</pre>
      </details>
    </div>
  );
};

export default LocalScmPanel;
