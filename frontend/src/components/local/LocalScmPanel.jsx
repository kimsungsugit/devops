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
  return (
    <div>
      <h3>SCM</h3>
      <div className="form-grid-2 compact">
        <label>SCM</label>
        <select
          value={scmMode}
          onChange={(e) => setScmMode(e.target.value)}
        >
          <option value="git">Git</option>
          <option value="svn">SVN</option>
        </select>
        <label>작업 디렉터리</label>
        <input
          value={scmWorkdir}
          onChange={(e) => setScmWorkdir(e.target.value)}
          placeholder="작업 디렉터리"
        />
        <label>Repo URL</label>
        <input
          value={scmRepoUrl}
          onChange={(e) => setScmRepoUrl(e.target.value)}
        />
        {scmMode === "git" ? (
          <>
            <label>Branch</label>
            <input
              value={scmBranch}
              onChange={(e) => setScmBranch(e.target.value)}
            />
            <label>Depth</label>
            <input
              type="number"
              min={0}
              value={scmDepth}
              onChange={(e) => setScmDepth(Number(e.target.value))}
            />
          </>
        ) : (
          <>
            <label>Revision</label>
            <input
              value={scmRevision}
              onChange={(e) => setScmRevision(e.target.value)}
            />
            <span />
            <span />
          </>
        )}
      </div>
      <div className="row">
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
    </div>
  );
};

export default LocalScmPanel;
