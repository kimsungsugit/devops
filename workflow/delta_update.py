# workflow/delta_update.py
"""Delta Update - identify changed functions and regenerate only affected UDS sections.

Uses git/svn diff to find changed files, then cross-references with the call graph
to determine the full impact set of functions that need UDS regeneration.
"""

from __future__ import annotations

import subprocess
import re
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)


def get_changed_files(
    project_root: str,
    *,
    base_ref: str = "HEAD~1",
    scm_type: str = "git",
) -> List[str]:
    """Get list of changed .c/.h files since base_ref."""
    root = Path(project_root)
    changed: List[str] = []

    try:
        if scm_type == "git":
            result = subprocess.run(
                ["git", "diff", "--name-only", base_ref, "--", "*.c", "*.h"],
                cwd=str(root), capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                changed = [f.strip() for f in result.stdout.splitlines() if f.strip()]
        elif scm_type == "svn":
            result = subprocess.run(
                ["svn", "diff", "--summarize", "-r", base_ref],
                cwd=str(root), capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    parts = line.split()
                    if len(parts) >= 2:
                        fpath = parts[-1].strip()
                        if fpath.endswith((".c", ".h")):
                            changed.append(fpath)
    except Exception as e:
        logger.warning("Failed to get changed files via %s: %s", scm_type, e)

    return changed


def get_changed_functions(
    project_root: str,
    changed_files: List[str],
    *,
    base_ref: str = "HEAD~1",
) -> Set[str]:
    """Extract function names that were modified in the diff."""
    root = Path(project_root)
    func_pattern = re.compile(
        r"^[+-]\s*(?:static\s+)?(?:void|int|uint\d+_t|U\d+|S\d+|bool|float|double|char|unsigned|signed)"
        r"\s+(\w+)\s*\(",
        re.MULTILINE,
    )
    hunk_pattern = re.compile(r"^@@.*@@\s*(?:.*\s)?(\w+)\s*\(", re.MULTILINE)

    changed_funcs: Set[str] = set()

    for fpath in changed_files:
        try:
            result = subprocess.run(
                ["git", "diff", base_ref, "--", fpath],
                cwd=str(root), capture_output=True, text=True, timeout=30,
            )
            if result.returncode != 0:
                continue

            diff_text = result.stdout
            for m in func_pattern.finditer(diff_text):
                changed_funcs.add(m.group(1))
            for m in hunk_pattern.finditer(diff_text):
                changed_funcs.add(m.group(1))
        except Exception as e:
            logger.warning("Failed to parse diff for %s: %s", fpath, e)

    return changed_funcs


def compute_impact_set(
    changed_functions: Set[str],
    call_map: Dict[str, List[str]],
    *,
    max_depth: int = 3,
) -> Set[str]:
    """Given changed functions and a call graph, compute the full impact set.

    Traverses callers (reverse call graph) up to max_depth levels to find all
    functions that may be affected by the changes.
    """
    reverse_map: Dict[str, Set[str]] = {}
    for caller, callees in call_map.items():
        for callee in callees:
            reverse_map.setdefault(callee, set()).add(caller)

    impact: Set[str] = set(changed_functions)
    frontier = set(changed_functions)

    for _ in range(max_depth):
        next_frontier: Set[str] = set()
        for func in frontier:
            callers = reverse_map.get(func, set())
            for caller in callers:
                if caller not in impact:
                    impact.add(caller)
                    next_frontier.add(caller)
            callees = call_map.get(func, [])
            for callee in callees:
                if callee not in impact:
                    impact.add(callee)
                    next_frontier.add(callee)
        if not next_frontier:
            break
        frontier = next_frontier

    return impact


def filter_function_details(
    function_details: Dict[str, Dict[str, Any]],
    impact_set: Set[str],
) -> Dict[str, Dict[str, Any]]:
    """Filter function_details to only include functions in the impact set."""
    filtered = {}
    for fid, info in function_details.items():
        if not isinstance(info, dict):
            continue
        name = info.get("name", "")
        if name in impact_set or name.lower() in {f.lower() for f in impact_set}:
            filtered[fid] = info
    return filtered


def compute_delta_summary(
    project_root: str,
    function_details: Dict[str, Dict[str, Any]],
    call_map: Dict[str, List[str]],
    *,
    base_ref: str = "HEAD~1",
    scm_type: str = "git",
) -> Dict[str, Any]:
    """Full delta analysis: changed files -> changed functions -> impact set -> filtered details."""
    changed_files = get_changed_files(project_root, base_ref=base_ref, scm_type=scm_type)
    if not changed_files:
        return {
            "changed_files": [],
            "changed_functions": [],
            "impact_set": [],
            "filtered_count": 0,
            "total_count": len(function_details),
            "skip_ratio": 1.0,
        }

    changed_funcs = get_changed_functions(project_root, changed_files, base_ref=base_ref)
    impact = compute_impact_set(changed_funcs, call_map)
    filtered = filter_function_details(function_details, impact)

    total = len(function_details)
    skip_ratio = 1.0 - (len(filtered) / total) if total > 0 else 0.0

    logger.info(
        "Delta update: %d changed files, %d changed functions, "
        "%d impact set, %d/%d functions to regenerate (skip %.0f%%)",
        len(changed_files), len(changed_funcs), len(impact),
        len(filtered), total, skip_ratio * 100,
    )

    return {
        "changed_files": changed_files,
        "changed_functions": sorted(changed_funcs),
        "impact_set": sorted(impact),
        "filtered_count": len(filtered),
        "total_count": total,
        "skip_ratio": skip_ratio,
        "filtered_details": filtered,
    }
