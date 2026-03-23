from __future__ import annotations


def test_run_lock_acquire_release(tmp_path, monkeypatch):
    from workflow import impact_audit

    monkeypatch.setattr(impact_audit, "AUDIT_DIR", tmp_path / "audit")
    monkeypatch.setattr(impact_audit, "LOCK_PATH", tmp_path / "audit" / ".run_lock")

    acquired = impact_audit.acquire_run_lock("hdpdm01")
    assert acquired["ok"] is True
    assert (tmp_path / "audit" / ".run_lock").exists()

    released = impact_audit.release_run_lock()
    assert released is True
    assert not (tmp_path / "audit" / ".run_lock").exists()


def test_run_lock_stale_is_replaced(tmp_path, monkeypatch):
    from workflow import impact_audit

    monkeypatch.setattr(impact_audit, "AUDIT_DIR", tmp_path / "audit")
    monkeypatch.setattr(impact_audit, "LOCK_PATH", tmp_path / "audit" / ".run_lock")
    impact_audit.ensure_audit_dir()
    impact_audit.LOCK_PATH.write_text('{"scm_id":"old","pid":999999,"started_at":"2026-03-20T00:00:00"}', encoding="utf-8")
    monkeypatch.setattr(impact_audit, "_pid_alive", lambda _pid: False)

    acquired = impact_audit.acquire_run_lock("new")

    assert acquired["ok"] is True
    assert acquired["lock"]["scm_id"] == "new"


def test_write_impact_audit_creates_per_run_file(tmp_path, monkeypatch):
    from workflow import impact_audit

    monkeypatch.setattr(impact_audit, "AUDIT_DIR", tmp_path / "audit")

    out = impact_audit.write_impact_audit({"scm_id": "hdpdm01", "trigger": "local"})

    assert out.exists()
    assert out.name.startswith("impact_")
