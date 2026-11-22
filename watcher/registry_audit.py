#!/usr/bin/env python3
"""Phase 1 — registry audit (PRD Section 9).

Every registry entry must have a render component on file, a proof
clip on file, and a Critic PASS for that clip. Any entry missing one
is reported and, with --prune, moved to style_backlog.json with
status "implemented-unproven" until it qualifies.

Usage:
  python3 watcher/registry_audit.py [--prune]
Exit 0 when every entry qualifies, 1 otherwise.
Prints one JSON report to stdout.
"""

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REGISTRY_PATH = REPO / "watcher" / "style_registry.json"
BACKLOG_PATH = REPO / "watcher" / "style_backlog.json"

# component string -> source file(s) that must exist. The component
# field names a file under src/; a " / " separates the Vertical and
# Harness hosts (either suffices as proof the code exists).
KNOWN_COMPONENT_FILES = {
    "src/Vertical.tsx": True,
    "src/Harness.tsx": True,
    "src/harness/primitives.tsx": True,
    "src/harness/motionRegistry.tsx": True,
    "src/CanvasStyles.tsx": True,
    "src/Explainer.tsx": True,
    "src/TikTokFormats.tsx": True,
    "src/EverestPanels.tsx": True,
    "src/Chart.tsx": True,
    "src/D3Chart.tsx": True,
    "src/AdTemplate.tsx": True,
    "src/ProductDemo.tsx": True,
    "src/LowerThird.tsx": True,
    "src/BRoll.tsx": True,
    "src/WhatIf.tsx": True,
}


def component_exists(component):
    """True when at least one named src/ file exists."""
    import re
    files = re.findall(r"src/[A-Za-z0-9_./-]+\.(?:tsx|ts)", component or "")
    if not files:
        return False
    return any((REPO / f).exists() for f in files)


def audit():
    registry = json.loads(REGISTRY_PATH.read_text())
    report = {"entries": len(registry.get("entries", [])),
              "pass": [], "fail": []}
    for entry in registry.get("entries", []):
        problems = []
        if not component_exists(entry.get("component")):
            problems.append("component file missing")
        clip = entry.get("proof_clip") or ""
        clip_path = REPO / clip
        if not clip or not clip_path.exists():
            problems.append(f"proof clip missing: {clip}")
        critic_path = clip_path.with_suffix("").with_suffix(".critic.json") \
            if clip_path.suffix == ".mp4" else None
        # out/proof-x.mp4 -> out/proof-x.critic.json
        if clip_path.suffix == ".mp4":
            critic_path = Path(str(clip_path)[:-4] + ".critic.json")
        critic_pass = False
        if critic_path is not None and critic_path.exists():
            try:
                critic_pass = (json.loads(critic_path.read_text())
                               .get("overall") == "PASS")
            except (OSError, ValueError):
                critic_pass = False
        if not critic_pass:
            problems.append(f"critic PASS missing for {clip}")
        if entry.get("critic_pass") is not True:
            problems.append("entry critic_pass flag not true")
        if not entry.get("id") or not entry.get("family"):
            problems.append("missing id/family")
        if problems:
            report["fail"].append({"id": entry.get("id"),
                                   "problems": problems})
        else:
            report["pass"].append(entry.get("id"))
    report["overall"] = "PASS" if not report["fail"] else "FAIL"
    return report, registry


def prune(report, registry):
    """Move failing entries to the backlog as implemented-unproven."""
    failing_ids = {f["id"] for f in report["fail"]}
    backlog = json.loads(BACKLOG_PATH.read_text()) if BACKLOG_PATH.exists() \
        else {"version": 1, "note": "", "items": []}
    kept, moved = [], []
    for entry in registry.get("entries", []):
        if entry.get("id") in failing_ids:
            item = dict(entry)
            item["status"] = "implemented-unproven"
            item["unproven_reason"] = next(
                f["problems"] for f in report["fail"]
                if f["id"] == entry.get("id"))
            moved.append(item)
        else:
            kept.append(entry)
    registry["entries"] = kept
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2) + "\n")
    backlog["items"].extend(moved)
    BACKLOG_PATH.write_text(json.dumps(backlog, indent=2) + "\n")
    return [m["id"] for m in moved]


def main(argv):
    report, registry = audit()
    if "--prune" in argv and report["fail"]:
        report["pruned"] = prune(report, registry)
        report, _ = audit()
    print(json.dumps(report, indent=2))
    return 0 if report["overall"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
