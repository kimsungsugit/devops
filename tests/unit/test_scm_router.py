from __future__ import annotations


def test_scm_router_crud_and_link_docs(tmp_path, monkeypatch):
    from backend.routers import scm as scm_router
    from backend.schemas import ScmLinkedDocs, ScmRegisterRequest, ScmUpdateRequest
    from backend.services import scm_registry

    reg_path = tmp_path / "config" / "scm_registry.json"
    monkeypatch.setattr(scm_registry, "REGISTRY_PATH", reg_path)

    created = scm_router.scm_register(
        ScmRegisterRequest(
            id="hdpdm01",
            name="HDPDM01",
            scm_type="git",
            scm_url="https://example/repo.git",
            source_root=str(tmp_path),
        )
    )
    assert created["ok"] is True
    assert created["item"]["id"] == "hdpdm01"

    listed = scm_router.scm_list()
    assert listed["count"] == 1

    updated = scm_router.scm_update("hdpdm01", ScmUpdateRequest(branch="main"))
    assert updated["item"]["branch"] == "main"

    linked = scm_router.scm_link_docs(
        "hdpdm01",
        ScmLinkedDocs(uds="backend/reports/uds_local/latest.docx"),
    )
    assert linked["item"]["linked_docs"]["uds"].endswith("latest.docx")

    deleted = scm_router.scm_delete("hdpdm01")
    assert deleted["deleted"] == "hdpdm01"


def test_scm_status_for_missing_registry(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from backend.routers import scm as scm_router
    from backend.services import scm_registry

    reg_path = tmp_path / "config" / "scm_registry.json"
    monkeypatch.setattr(scm_registry, "REGISTRY_PATH", reg_path)
    scm_registry.ensure_registry_file()

    try:
        scm_router.scm_status("missing")
    except HTTPException as exc:
        assert exc.status_code == 404
    else:
        raise AssertionError("expected 404")
