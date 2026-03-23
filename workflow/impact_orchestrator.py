from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Set

from backend.schemas import ScmLinkedDocs, ScmUpdateRequest
from backend.services.scm_registry import get_registry_entry, update_entry
from workflow.change_trigger import ChangeTrigger
from workflow.delta_update import classify_changed_functions
from workflow.impact_audit import acquire_run_lock, release_run_lock, write_impact_audit


REPO_ROOT = Path(__file__).resolve().parents[1]
AUTO_DOCS = {"uds", "suts"}
FLAG_DOCS = {"sts", "sds"}
ACTION_MATRIX: Dict[str, Dict[str, str]] = {
    "SIGNATURE": {"uds": "AUTO", "suts": "AUTO", "sts": "FLAG", "sds": "FLAG"},
    "BODY": {"uds": "AUTO", "suts": "AUTO", "sts": "FLAG", "sds": "-"},
    "NEW": {"uds": "AUTO", "suts": "AUTO", "sts": "FLAG", "sds": "FLAG"},
    "DELETE": {"uds": "AUTO", "suts": "AUTO", "sts": "FLAG", "sds": "FLAG"},
    "VARIABLE": {"uds": "AUTO", "suts": "AUTO", "sts": "FLAG", "sds": "-"},
    "HEADER": {"uds": "AUTO", "suts": "FLAG", "sts": "FLAG", "sds": "FLAG"},
}


@dataclass
class ImpactOptions:
    max_hop: int = 2
    same_module_only: bool = True
    max_impacted_functions: int = 50


def _ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _resolve_existing(path_text: str) -> str | None:
    path = Path(str(path_text or "").strip()).expanduser()
    return str(path.resolve()) if path.exists() and path.is_file() else None


def _discover_doc(name_token: str, suffixes: Set[str]) -> str | None:
    docs_dir = REPO_ROOT / "docs"
    if not docs_dir.exists():
        return None
    for path in docs_dir.iterdir():
        if path.is_file() and path.suffix.lower() in suffixes and name_token.lower() in path.name.lower():
            return str(path.resolve())
    return None


def _update_linked_doc(entry_id: str, field: str, path_text: str) -> None:
    update_entry(entry_id, ScmUpdateRequest(linked_docs=ScmLinkedDocs(**{field: path_text})))


def _write_review_artifact(
    target: str,
    trigger: ChangeTrigger,
    changed_types: Dict[str, str],
    impact_groups: Dict[str, List[str]],
    linked_doc: str = "",
) -> str:
    review_dir = REPO_ROOT / "reports" / "impact_audit"
    review_dir.mkdir(parents=True, exist_ok=True)
    out_path = review_dir / f"{target}_review_required_{_ts()}.md"
    lines = [
        f"# {target.upper()} Review Required",
        "",
        f"- SCM ID: `{trigger.scm_id}`",
        f"- Trigger: `{trigger.trigger_type}`",
        f"- Source root: `{trigger.source_root}`",
        f"- Base ref: `{trigger.base_ref}`",
        f"- Linked document: `{linked_doc or '-'}`",
        "",
        "## Changed Files",
    ]
    lines.extend([f"- `{item}`" for item in trigger.changed_files] or ["- none"])
    lines.extend(["", "## Changed Functions"])
    if changed_types:
        for func, kind in sorted(changed_types.items()):
            lines.append(f"- `{func}` : `{kind}`")
    else:
        lines.append("- none")
    lines.extend(["", "## Impact"])
    lines.append(f"- direct: `{len(impact_groups.get('direct', []))}`")
    lines.append(f"- indirect_1hop: `{len(impact_groups.get('indirect_1hop', []))}`")
    lines.append(f"- indirect_2hop: `{len(impact_groups.get('indirect_2hop', []))}`")
    lines.extend(["", "## Review Checklist"])
    if target == "sts":
        lines.extend(
            [
                "- Verify impacted requirements and TC coverage.",
                "- Check whether changed function behavior invalidates existing expected results.",
                "- Confirm new/deleted signatures require new or removed test cases.",
            ]
        )
    else:
        lines.extend(
            [
                "- Verify module/interface description still matches header and source changes.",
                "- Check affected components and interface contracts.",
                "- Confirm architecture partition impact is documented if needed.",
            ]
        )
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return str(out_path)


def _run_uds_generation(trigger: ChangeTrigger) -> Dict[str, Any]:
    out_dir = REPO_ROOT / "backend" / "reports" / "uds_local"
    out_dir.mkdir(parents=True, exist_ok=True)
    before = {p.resolve() for p in out_dir.glob("uds_spec_generated_expanded_*.docx")}
    env = os.environ.copy()
    env["UDS_CHANGED_FILES"] = ",".join(trigger.changed_files)
    cmd = [sys.executable, str(REPO_ROOT / "tools" / "generate_uds_local.py")]
    run = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=3600,
        check=False,
    )
    if run.returncode != 0:
        err = ((run.stderr or "") + "\n" + (run.stdout or "")).strip()[-4000:]
        raise RuntimeError(f"UDS regeneration failed: {err}")
    candidates = [p.resolve() for p in out_dir.glob("uds_spec_generated_expanded_*.docx")]
    new_files = [p for p in candidates if p not in before]
    chosen = max(new_files or candidates, key=lambda p: p.stat().st_mtime)
    return {"output_path": str(chosen), "stdout_tail": (run.stdout or "")[-1000:]}


def _run_suts_generation(entry: Any) -> Dict[str, Any]:
    from suts_generator import generate_suts

    source_root = str(entry.source_root or "").strip()
    if not source_root:
        raise RuntimeError("SUTS regeneration requires source_root")
    out_dir = REPO_ROOT / "reports" / "suts"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"suts_impact_{_ts()}.xlsm"
    template_path = _resolve_existing(entry.linked_docs.suts) or _discover_doc("suts", {".xlsm", ".xlsx"})
    srs_path = _resolve_existing(entry.linked_docs.srs) or _discover_doc("srs", {".docx"})
    sds_path = _resolve_existing(entry.linked_docs.sds) or _discover_doc("sds", {".docx"})
    uds_path = _resolve_existing(entry.linked_docs.uds)
    hsis_path = _resolve_existing(entry.linked_docs.hsis) or _discover_doc("hsis", {".xlsx", ".xlsm"})

    result = generate_suts(
        source_root=source_root,
        output_path=str(out_path),
        template_path=template_path,
        project_config={
            "project_id": str(entry.id or "PROJECT").upper(),
            "doc_id": f"{str(entry.id or 'PROJECT').upper()}-SUTS",
            "version": "impact",
            "asil_level": "",
        },
        srs_docx_path=srs_path,
        sds_docx_path=sds_path,
        uds_path=uds_path,
        hsis_path=hsis_path,
    )
    return {
        "output_path": str(out_path),
        "test_case_count": result.get("test_case_count", 0),
        "validation_report_path": result.get("validation_report_path", ""),
    }


def _execute_auto_action(target: str, trigger: ChangeTrigger, entry: Any) -> Dict[str, Any]:
    if target == "uds":
        return _run_uds_generation(trigger)
    if target == "suts":
        return _run_suts_generation(entry)
    raise RuntimeError(f"unsupported AUTO target: {target}")


def _module_name(info: Dict[str, Any]) -> str:
    module = str(info.get("module_name") or "").strip()
    if module:
        return module.lower()
    file_path = str(info.get("file") or "").strip()
    if not file_path:
        return ""
    return Path(file_path).parent.name.lower()


def _build_neighbors(
    call_map: Dict[str, List[str]],
    by_name: Dict[str, Dict[str, Any]],
    *,
    same_module_only: bool,
) -> Dict[str, Set[str]]:
    neighbors: Dict[str, Set[str]] = {}
    for caller, raw_callees in (call_map or {}).items():
        caller_key = str(caller or "").strip().lower()
        if not caller_key:
            continue
        caller_info = by_name.get(caller_key) or {}
        caller_module = _module_name(caller_info)
        for callee in raw_callees or []:
            callee_key = str(callee or "").strip().lower()
            if not callee_key:
                continue
            callee_info = by_name.get(callee_key) or {}
            if same_module_only and caller_module and _module_name(callee_info) and caller_module != _module_name(callee_info):
                continue
            neighbors.setdefault(caller_key, set()).add(callee_key)
            neighbors.setdefault(callee_key, set()).add(caller_key)
    return neighbors


def _hop_limited_impact(
    seeds: Set[str],
    neighbors: Dict[str, Set[str]],
    *,
    max_hop: int,
    max_impacted_functions: int,
) -> Dict[str, List[str]]:
    direct = sorted(seeds)
    if not seeds:
        return {"direct": [], "indirect_1hop": [], "indirect_2hop": []}

    visited = set(seeds)
    frontier = set(seeds)
    indirect_1: Set[str] = set()
    indirect_2: Set[str] = set()

    for depth in range(1, max_hop + 1):
        next_frontier: Set[str] = set()
        for func in frontier:
            for neighbor in neighbors.get(func, set()):
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                next_frontier.add(neighbor)
                if depth == 1:
                    indirect_1.add(neighbor)
                elif depth == 2:
                    indirect_2.add(neighbor)
        if len(visited) > max_impacted_functions:
            break
        frontier = next_frontier
        if not frontier:
            break

    return {
        "direct": sorted(direct),
        "indirect_1hop": sorted(indirect_1),
        "indirect_2hop": sorted(indirect_2),
    }


def _selected_targets(targets: Iterable[str] | None) -> List[str]:
    values = [str(x or "").strip().lower() for x in (targets or []) if str(x or "").strip()]
    return sorted(dict.fromkeys(values)) if values else ["sds", "sts", "suts", "uds"]


def _action_for_target(target: str, changed_types: Dict[str, str], changed_files: List[str]) -> str:
    decision = "-"
    for change_type in changed_types.values():
        action = ACTION_MATRIX.get(change_type, {}).get(target, "-")
        if action == "FLAG":
            decision = "FLAG"
        elif action == "AUTO" and decision == "-":
            decision = "AUTO"
    if target in {"sts", "sds"} and any(str(path).lower().endswith(".h") for path in changed_files):
        decision = "FLAG"
    return decision


def _summarize_actions(
    targets: List[str],
    changed_types: Dict[str, str],
    changed_files: List[str],
    impact_groups: Dict[str, List[str]],
) -> Dict[str, Dict[str, Any]]:
    impacted_all = set(impact_groups.get("direct", [])) | set(impact_groups.get("indirect_1hop", [])) | set(impact_groups.get("indirect_2hop", []))
    changed_direct = set(impact_groups.get("direct", []))
    actions: Dict[str, Dict[str, Any]] = {}
    for target in targets:
        decision = _action_for_target(target, changed_types, changed_files)
        if decision == "AUTO":
            funcs = sorted(impacted_all if target in AUTO_DOCS else changed_direct)
            actions[target] = {
                "mode": "AUTO",
                "status": "planned",
                "function_count": len(funcs),
                "functions": funcs,
            }
        elif decision == "FLAG":
            funcs = sorted(changed_direct or impacted_all)
            actions[target] = {
                "mode": "FLAG",
                "status": "review_required",
                "function_count": len(funcs),
                "functions": funcs,
            }
        else:
            actions[target] = {
                "mode": "-",
                "status": "skipped",
                "function_count": 0,
                "functions": [],
            }
    return actions


def run_impact_update(
    trigger: ChangeTrigger,
    *,
    options: ImpactOptions | None = None,
) -> Dict[str, Any]:
    options = options or ImpactOptions()
    targets = _selected_targets(trigger.targets)
    lock = acquire_run_lock(trigger.scm_id)
    if not lock.get("ok"):
        return {"ok": False, "reason": lock.get("reason"), "lock": lock}

    try:
        entry = get_registry_entry(trigger.scm_id)
        changed_types = classify_changed_functions(
            trigger.source_root,
            trigger.changed_files,
            scm_type=trigger.scm_type,
            base_ref=trigger.base_ref,
        )

        if entry and entry.source_root:
            import report_generator as rg

            sections = rg.generate_uds_source_sections(entry.source_root)
            by_name_raw = sections.get("function_details_by_name", {}) or {}
            by_name = {str(k).strip().lower(): v for k, v in by_name_raw.items() if isinstance(v, dict)}
            neighbors = _build_neighbors(
                sections.get("call_map", {}) or {},
                by_name,
                same_module_only=options.same_module_only,
            )
        else:
            by_name = {}
            neighbors = {}

        impact_groups = _hop_limited_impact(
            set(changed_types),
            neighbors,
            max_hop=options.max_hop,
            max_impacted_functions=options.max_impacted_functions,
        )
        impacted_total = len(set(impact_groups["direct"]) | set(impact_groups["indirect_1hop"]) | set(impact_groups["indirect_2hop"]))
        warnings: List[str] = []
        if impacted_total > options.max_impacted_functions:
            warnings.append(
                f"impacted function count exceeded limit ({impacted_total}>{options.max_impacted_functions}); promote to review"
            )
        actions = _summarize_actions(targets, changed_types, trigger.changed_files, impact_groups)
        if warnings:
            for target, info in actions.items():
                if info.get("mode") == "AUTO":
                    info["mode"] = "FLAG"
                    info["status"] = "review_required"

        result = {
            "ok": True,
            "dry_run": bool(trigger.dry_run),
            "trigger": trigger.to_dict(),
            "changed_function_types": dict(sorted(changed_types.items())),
            "impact": impact_groups,
            "warnings": warnings,
            "actions": actions,
        }
        if not trigger.dry_run:
            linked_docs = entry.linked_docs if entry else ScmLinkedDocs()
            for target, info in actions.items():
                if info.get("mode") == "AUTO":
                    try:
                        exec_result = _execute_auto_action(target, trigger, entry)
                        info["status"] = "completed"
                        info["output_path"] = exec_result.get("output_path", "")
                        info["result"] = exec_result
                        if info["output_path"] and entry:
                            _update_linked_doc(entry.id, target, info["output_path"])
                    except Exception as exc:
                        info["status"] = "failed"
                        info["error"] = str(exc)
                        result["ok"] = False
                elif info.get("mode") == "FLAG":
                    artifact_path = _write_review_artifact(
                        target,
                        trigger,
                        changed_types,
                        impact_groups,
                        getattr(linked_docs, target, ""),
                    )
                    info["artifact_path"] = artifact_path
        write_impact_audit(
            {
                "scm_id": trigger.scm_id,
                "trigger": trigger.trigger_type,
                "changed_files": trigger.changed_files,
                "changed_functions": dict(sorted(changed_types.items())),
                "impacted_functions": impact_groups,
                "targets": targets,
                "dry_run": bool(trigger.dry_run),
                "warnings": warnings,
                "actions": actions,
            }
        )
        return result
    finally:
        release_run_lock()
