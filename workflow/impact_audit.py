from __future__ import annotations

import os
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict


REPO_ROOT = Path(__file__).resolve().parents[1]
AUDIT_DIR = REPO_ROOT / "reports" / "impact_audit"
LOCK_PATH = AUDIT_DIR / ".run_lock"


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(int(pid), 0)
    except Exception:
        return False
    return True


def _load_json(path: Path, default: Dict[str, Any]) -> Dict[str, Any]:
    if not path.exists():
        return default
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default
    return raw if isinstance(raw, dict) else default


def _save_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def ensure_audit_dir() -> Path:
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    return AUDIT_DIR


def acquire_run_lock(scm_id: str) -> Dict[str, Any]:
    ensure_audit_dir()
    if LOCK_PATH.exists():
        existing = _load_json(LOCK_PATH, default={}) or {}
        pid = int(existing.get("pid") or 0)
        if pid and _pid_alive(pid):
            return {"ok": False, "reason": "active_lock", "lock_path": str(LOCK_PATH), "lock": existing}
        try:
            LOCK_PATH.unlink()
        except OSError:
            pass
    payload = {
        "scm_id": str(scm_id or "").strip(),
        "started_at": _now_iso(),
        "pid": os.getpid(),
    }
    _save_json(LOCK_PATH, payload)
    return {"ok": True, "lock_path": str(LOCK_PATH), "lock": payload}


def release_run_lock() -> bool:
    if not LOCK_PATH.exists():
        return False
    try:
        LOCK_PATH.unlink()
        return True
    except OSError:
        return False


def write_impact_audit(payload: Dict[str, Any]) -> Path:
    ensure_audit_dir()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = AUDIT_DIR / f"impact_{ts}.json"
    _save_json(out, payload)
    return out
