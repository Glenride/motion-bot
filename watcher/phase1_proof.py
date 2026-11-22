#!/usr/bin/env python3
"""Phase 1 proof harness — Video Bot PRD Section 9.

Renders test briefs through the Phase 1 router (never the live
watcher), on the iMac, with the Critic + Check 8 variety gate, and
writes every run to the History log. The live 15-minute watcher is
never touched by this script.

Usage:
  python3 watcher/phase1_proof.py --briefs 'briefs/phase1-*.json' --tag proof-1
  python3 watcher/phase1_proof.py --briefs 'briefs/phase1-adm-*.json' --tag admission-1 --admission
  python3 watcher/phase1_proof.py --briefs 'briefs/phase1-*.json' --tag proof-1 --dry-run
  python3 watcher/phase1_proof.py --report --tag proof-1

A brief file is {"title": ..., "details": ...} plus optional test keys:
  "force": {"variant": "variant.sweep", ...} — admission override:
      the router cannot pick an entry that is not in the registry yet,
      so an admission brief forces the implemented-but-unproven entry
      onto the render to prove it. Logged as forced, never as a label.
  "expect": {"label": "panel.split", "approx": "canvas.riso",
             "draft": true, "style": "chart.count-up"} — what the
      acceptance report checks this run against.
  "gate": true — force the previous run's panel-and-entry pair and
      expect the Critic to FAIL it (Check 8), then re-pick and ship
      the replacement. Both events are logged.
  "corrects": "<brief id>" — this brief corrects an earlier draft
      brief's missing values; the report checks the placeholders
      are gone.

Every run appends one record to watcher/history.jsonl via
phase1_history.append_run (which also stamps the registry's
last_used_at / use_count). A Check 8 FAIL re-picks through the
router (exclude_ids) up to 3 times, then the run stops and reports
rather than shipping a repeat.
"""

import argparse
import glob
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import phase1_history as hist
import phase1_router as router
from harness_critic import check_variety
from harness_director import (
    ad_beat_scenes,
    build_ad_variant,
    build_everest_panel,
    build_explainer,
    build_product_demo,
    build_storyboard,
    build_whatif,
    draft_data_rows,
    parse_data_rows,
    parse_labels,
    pick_canvas_style,
)
from watch_motion_bot import (
    REPO,
    critic_summary,
    render_on_imac,
    rsync_dir_to_imac,
    rsync_from_imac,
    rsync_to_imac,
)
from skill_verify import verify as skill_verify

MAX_REPICKS = 3
CRITIC_STRUCTURAL = ("probe", "frames_differ", "not_blank")


def log(msg):
    print(f"[phase1-proof] {msg}", flush=True)


def _slug(brief_id):
    return f"phase1-{brief_id}"


def select_composition(task, storyboard, routed):
    """Mirror the watcher's rung chain, driven by the Phase 1 route
    picks, with draft=True everywhere (PRD: draft first, never
    blocked). Returns (composition, codec, extra_notes)."""
    details = task.get("details") or ""
    labels = parse_labels(details)
    style = routed.get("style")
    notes = storyboard.setdefault("notes", [])
    codec = None

    if style and style.startswith("chart."):
        rows = parse_data_rows(details)
        if not rows:
            rows = draft_data_rows(details)
            notes.append("phase1 draft: chart brief carries no numbers "
                         "— placeholder bars [VALUE 1/2 NEEDED] at 0; "
                         "add Data: rows and re-render")
        composition = "D3Chart" if style == "chart.d3" else "Chart"
        storyboard["bars"] = rows
        storyboard["chartTitle"] = storyboard.get("hook", "")
        if labels.get("unit"):
            storyboard["unit"] = labels["unit"]
        if labels.get("mode", "").lower() in ("bars", "stats"):
            storyboard["mode"] = labels["mode"].lower()
        return composition, codec, notes

    if style == "product.demo":
        demo = build_product_demo(task, storyboard,
                                  ecommerce_matched=True, draft=True)
        if demo:
            storyboard["product"] = demo["product"]
            storyboard["features"] = demo["features"]
            storyboard["offer"] = demo["offer"]
            storyboard["cta"] = demo["cta"]
            storyboard["scenes"] = demo["scenes"]
            _len = storyboard.get("lengthSeconds") or 15
            storyboard["lengthSeconds"] = _len if 12 <= _len <= 30 else 15
            return "ProductDemo", codec, notes

    if style == "ad.template":
        ad = build_ad_variant(task, storyboard)
        if ad:
            storyboard["variant"] = ad["variant"]
            storyboard["testField"] = ad["testField"]
            storyboard["scenes"] = ad_beat_scenes(ad["variant"])
            _len = storyboard.get("lengthSeconds") or 25
            storyboard["lengthSeconds"] = _len if 15 <= _len <= 30 else 25
            return "AdTemplate", codec, notes

    if style and style.startswith("canvas."):
        composition = "CanvasStyles"
        storyboard["canvasStyle"] = style.split(".", 1)[1]
        return composition, codec, notes

    if style == "broll.cut-on-noun":
        # The b-roll pool lives outside git; the proof briefs avoid
        # this style. Fall through to the default host if it fires.
        notes.append("phase1: broll style picked but the proof harness "
                     "does not ship pool clips — default host renders")

    if style and style.startswith("everest."):
        category = style.split(".", 1)[1]
        panel = build_everest_panel(task, storyboard,
                                    [f"everest-{category}"], draft=True)
        if panel:
            storyboard["category"] = panel["category"]
            for _k in ("prompt", "steps", "outputLines", "bars", "tiers",
                       "usage", "name", "role", "pills", "quote",
                       "highlight", "comparison", "version", "receipt",
                       "wasPrice", "nowPrice", "project"):
                if _k in panel:
                    storyboard[_k] = panel[_k]
            storyboard["scenes"] = panel["scenes"]
            return "EverestPanels", codec, notes

    if style and style.startswith("explainer."):
        expl = build_explainer(task, storyboard, draft=True)
        if expl:
            storyboard["ideas"] = expl["ideas"]
            storyboard["style"] = expl["style"]
            storyboard["cta"] = expl["cta"]
            storyboard["scenes"] = expl["scenes"]
            storyboard["lengthSeconds"] = expl["lengthSeconds"]
            return "Explainer", codec, notes

    if style == "whatif.rig":
        whatif = build_whatif(task, storyboard, draft=True)
        if whatif:
            storyboard["whatif"] = whatif["whatif"]
            storyboard["lengthSeconds"] = whatif["lengthSeconds"]
            storyboard["story"] = whatif["story"]
            storyboard["scenes"] = whatif["scenes"]
            storyboard["format"] = "vertical"
            return "WhatIf", codec, notes

    if style == "lower-third.strap":
        name = (labels.get("name") or "").strip()
        if name:
            storyboard = {
                "name": name,
                "role": labels.get("role", ""),
                "pills": [p.strip() for p in
                          re.split(r"[,|]", labels.get("pills", ""))
                          if p.strip()][:4],
                "source": labels.get("source", ""),
                "palette": storyboard.get("palette"),
                "lengthSeconds": 6,
                "skills": ["phase1"],
                "format": "overlay",
            }
            return "LowerThird", "alpha-prores", notes

    if style and style.startswith("tiktok."):
        storyboard["tiktokFormat"] = style.split(".", 1)[1]
        return "Vertical", codec, notes

    return routed.get("composition") or "Harness", codec, notes


def run_critic_phase1(mp4_path, storyboard_path, picks):
    """Run harness_critic.py with the Phase 1 picks + history, so
    Check 8 (variety) runs. Returns the report dict."""
    picks_path = Path(mp4_path).with_suffix(".picks.json")
    picks_path.write_text(json.dumps(picks, indent=2) + "\n")
    critic_path = Path(__file__).resolve().parent / "harness_critic.py"
    cmd = [sys.executable, str(critic_path), str(mp4_path),
           str(storyboard_path), "--picks", str(picks_path),
           "--history", str(hist.HISTORY_PATH)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    report_path = Path(str(mp4_path).replace(".mp4", ".critic.json"))
    if report_path.exists():
        return json.loads(report_path.read_text())
    raise RuntimeError(
        f"critic crashed (exit {r.returncode}): "
        f"{((r.stdout or '') + (r.stderr or '')).strip()[-500:]}")


def delivery_note(brief_id, task, routed, composition, mp4_name, critic,
                  repicks, attempts):
    """Plain-language delivery note: placeholders, assumptions,
    approximation, critic result. Written next to the mp4."""
    lines = [f"Phase 1 proof run — brief {brief_id}",
             f"Brief: {task.get('title')}",
             f"Composition: {composition}",
             f"Clip: out/{mp4_name}",
             f"Critic: {critic.get('overall', '?')} — "
             f"{critic_summary(critic)}"]
    picks = routed
    lines.append("Picks: " + ", ".join(
        f"{k}={v}" for k, v in
        ((k, picks.get(k)) for k in
         ("panel", "variant", "font", "motion", "kinetic", "move",
          "style", "composition", "format"))
        if v))
    if routed.get("labelled"):
        lines.append(f"Labelled override: {routed.get('label_source') or ''}")
    approx = routed.get("approximation")
    if approx:
        lines.append(f"APPROXIMATION: {approx.get('note', '')}")
    for a in routed.get("assumptions", []):
        lines.append(f"Assumption: {a}")
    for p in routed.get("placeholders", []):
        lines.append(f"Placeholder: {p}")
    if repicks:
        for rp in repicks:
            lines.append(f"Re-pick: {rp['reason']} "
                         f"({rp['from_entry']} -> {rp['to_entry']})")
    if attempts:
        lines.append(f"Attempts: {len(attempts)} "
                     f"({', '.join(a['critic_overall'] for a in attempts)})")
    return "\n".join(lines) + "\n"


def run_brief(brief_path, tag, dry_run=False):
    """Route, storyboard, render, critic, re-pick on Check 8 FAIL,
    log to history. Returns the history record."""
    brief = json.loads(Path(brief_path).read_text())
    brief_id = brief.get("id") or Path(brief_path).stem
    task = {"title": brief["title"], "details": brief.get("details", "")}
    expect = brief.get("expect") or {}
    slug = _slug(brief_id)
    log(f"{brief_id}: {task['title'][:60]}")

    routed = router.route(task)
    forced = {}
    if brief.get("force"):
        forced = dict(brief["force"])
        for k, v in forced.items():
            routed[k] = v
        routed["forced"] = True
        routed["force_reason"] = ("admission render — proving an "
                                  "implemented-but-unproven entry")
        routed["entry"] = hist.effective_entry(routed)
        log(f"  forced picks (admission): {forced}")
    if brief.get("gate"):
        prev = hist.recent_runs(1)
        if prev:
            pp = prev[0].get("picks") or {}
            for k in ("panel", "motion", "kinetic", "move", "style"):
                if pp.get(k) is not None:
                    routed[k] = pp[k]
            routed["entry"] = hist.effective_entry(routed)
            routed["forced"] = True
            routed["force_reason"] = ("gate test — deliberate repeat of "
                                      "the previous run's pair")
            log(f"  gate test: forcing previous pair "
                f"{routed.get('panel')} + {routed.get('entry')}")
    log(f"  route: panel={routed.get('panel')} entry={routed.get('entry')} "
        f"style={routed.get('style')} comp={routed.get('composition')} "
        f"labelled={routed.get('labelled')} approx={bool(routed.get('approximation'))}")

    storyboard = build_storyboard(task, route=routed)
    composition, codec, _notes = select_composition(task, storyboard, routed)
    storyboard["format"] = routed.get("format", "landscape")
    storyboard["skills"] = ["phase1"]
    log(f"  composition: {composition} (codec {codec or 'default'})")

    sb_name = f"{slug}-harness.json"
    sb_path = REPO / "briefs" / sb_name
    mp4_name = (f"{slug}-harness.mov" if composition == "LowerThird"
                else f"{slug}-harness.mp4")
    mp4_path = REPO / "out" / mp4_name
    sb_path.write_text(json.dumps(storyboard, indent=2) + "\n")

    if dry_run:
        log("  dry-run: storyboard written, no render")
        return {"brief_id": brief_id, "dry_run": True,
                "composition": composition,
                "picks": {k: routed.get(k) for k in
                          ("panel", "variant", "font", "motion", "kinetic",
                           "move", "style")},
                "storyboard": str(sb_path)}

    rsync_to_imac(sb_path, f"briefs/{sb_name}")
    attempts = []
    repicks = []
    exclude = set()
    critic = None
    for attempt in range(MAX_REPICKS + 1):
        if attempt > 0:
            # Check 8 FAIL on the previous attempt: re-route excluding
            # the failed entry, rebuild, re-render.
            routed = router.route(task, exclude_ids=exclude)
            storyboard = build_storyboard(task, route=routed)
            composition, codec, _notes = select_composition(
                task, storyboard, routed)
            storyboard["format"] = routed.get("format", "landscape")
            storyboard["skills"] = ["phase1"]
            sb_path.write_text(json.dumps(storyboard, indent=2) + "\n")
            rsync_to_imac(sb_path, f"briefs/{sb_name}")
            log(f"  re-pick {attempt}: panel={routed.get('panel')} "
                f"entry={routed.get('entry')}")
        render_on_imac(f"briefs/{sb_name}", composition,
                       f"out/{mp4_name}", codec=codec)
        rsync_from_imac(f"out/{mp4_name}", mp4_path)
        if composition == "LowerThird":
            # Transparent overlay: alpha is the whole point, and the
            # critic's .mp4 assumptions don't apply to a .mov.
            from skill_verify import has_alpha
            alpha = has_alpha(str(mp4_path))
            critic = {"overall": "PASS" if alpha else "FAIL",
                      "checks": {"alpha": {
                          "status": "PASS" if alpha else "FAIL",
                          "detail": "transparent ProRes export"}}}
            attempts.append({
                "attempt": attempt,
                "picks": {k: routed.get(k) for k in
                          ("panel", "variant", "font", "motion", "kinetic",
                           "move", "style")},
                "entry": routed.get("entry"),
                "critic_overall": critic.get("overall"),
                "variety": {"status": "SKIP",
                            "detail": "lower-third overlay, no variety gate"},
                "mp4": mp4_name,
            })
            log(f"  attempt {attempt}: lower-third alpha "
                f"{'ok' if alpha else 'MISSING'}")
            break
        sverify = skill_verify(str(mp4_path), {
            "width": 720 if storyboard.get("format") == "vertical" else 1280,
            "height": 1280 if storyboard.get("format") == "vertical" else 720,
            "min_duration_s": max(1.0, storyboard.get("lengthSeconds", 12) - 1.5),
        })
        if not sverify["structural_ok"]:
            raise RuntimeError("critic structural FAIL (skill_verify: "
                               + "; ".join(sverify["mismatches"]) + ")")
        critic = run_critic_phase1(mp4_path, sb_path, routed)
        attempts.append({
            "attempt": attempt,
            "picks": {k: routed.get(k) for k in
                      ("panel", "variant", "font", "motion", "kinetic",
                       "move", "style")},
            "entry": routed.get("entry"),
            "critic_overall": critic.get("overall"),
            "variety": critic.get("checks", {}).get("variety", {}),
            "mp4": mp4_name,
        })
        log(f"  attempt {attempt}: critic {critic.get('overall')} — "
            f"{critic_summary(critic)}; variety: "
            f"{critic.get('checks', {}).get('variety', {}).get('status')} "
            f"({critic.get('checks', {}).get('variety', {}).get('detail', '')})")
        variety = critic.get("checks", {}).get("variety", {})
        if variety.get("status") == "FAIL" and attempt < MAX_REPICKS:
            failed_entry = routed.get("entry")
            exclude.add(failed_entry)
            # A family-cap failure needs the family out of the fit
            # set, not just a new entry — exclude the style id too.
            # A pair failure excludes the entry only: excluding the
            # style would break single-entry families (product.demo
            # is the only product entry) by dropping the style.
            if ("family" in (variety.get("detail") or "")
                    and routed.get("style")):
                exclude.add(routed["style"])
            repicks.append({
                "reason": f"Check 8 FAIL: {variety.get('detail', '')}",
                "from_entry": failed_entry,
                "to_entry": None,
            })
            continue
        if variety.get("status") == "FAIL":
            log(f"  Check 8 still FAIL after {MAX_REPICKS} re-picks — "
                f"stopping, not shipping a repeat")
        break
    if repicks and attempts:
        # Fill in where each re-pick landed.
        for i, rp in enumerate(repicks):
            if i + 1 < len(attempts):
                rp["to_entry"] = attempts[i + 1]["entry"]

    note = delivery_note(brief_id, task, routed, composition, mp4_name,
                         critic, repicks, attempts)
    note_path = REPO / "out" / f"{slug}-phase1.note.md"
    note_path.write_text(note)

    record = {
        "brief_id": brief_id,
        "brief_title": task["title"],
        "picks": {k: routed.get(k) for k in
                  ("panel", "variant", "font", "motion", "kinetic",
                   "move", "style", "composition", "format")
                  if routed.get(k) is not None},
        "critic": {"overall": critic.get("overall"),
                   "checks": {k: v.get("status") for k, v in
                              critic.get("checks", {}).items()},
                   "summary": critic_summary(critic)},
        "labelled": bool(routed.get("labelled")),
        "label": routed.get("label_source") or "",
        "approximation": (routed.get("approximation") or {}).get("note", "")
                         if isinstance(routed.get("approximation"), dict)
                         else (routed.get("approximation") or ""),
        "assumptions": routed.get("assumptions", []),
        "placeholders": routed.get("placeholders", []),
        "repicks": repicks,
        "attempts": attempts,
        "delivery_note": note,
        "mp4": mp4_name,
        "storyboard": sb_name,
        "tag": tag,
        "composition": composition,
        "forced": bool(routed.get("forced")),
        "force_reason": routed.get("force_reason", ""),
        "expect": expect,
        "corrects": brief.get("corrects", ""),
    }
    stored = hist.append_run(record)
    log(f"  logged {stored['run_id']} — critic {critic.get('overall')}, "
        f"repicks {len(repicks)}")
    return stored


def admit_entries(tag):
    """After an admission run: every forced pick that is not yet in
    the registry and whose run PASSED the critic gets a registry
    entry — plus every per-scene move in the run's storyboard
    (a Moves: label proves each listed move on screen; the moves
    live in the storyboard, not the picks dict). Descriptive fields
    copy from the nearest sibling entry (the backlog item's
    'nearest'); proof_clip + critic_pass come from this run.
    Backlog items are removed as they are admitted."""
    registry = hist.load_registry()
    by_id = {e.get("id"): e for e in registry.get("entries", [])}
    backlog = json.loads(
        (Path(__file__).resolve().parent / "style_backlog.json").read_text())
    backlog_by_id = {i.get("id"): i for i in backlog.get("items", [])}
    admitted = []
    for run in hist.load_history():
        if run.get("tag") != tag:
            continue
        if (run.get("critic") or {}).get("overall") != "PASS":
            log(f"  admission SKIP {run.get('brief_id')}: critic "
                f"{(run.get('critic') or {}).get('overall')}")
            continue
        picks = run.get("picks") or {}
        candidates = [v for v in picks.values()
                      if isinstance(v, str) and "." in v]
        # Per-scene moves live in the storyboard, not the picks.
        sb_name = run.get("storyboard") or ""
        if sb_name:
            sb_path = REPO / "briefs" / sb_name
            if sb_path.exists():
                sb = json.loads(sb_path.read_text())
                for m in sb.get("moves") or []:
                    candidates.append(f"move.{m}")
        for entry_id in candidates:
            if entry_id in by_id:
                continue
            item = backlog_by_id.get(entry_id)
            if not item:
                log(f"  admission SKIP {entry_id}: not in backlog")
                continue
            sibling = by_id.get(item.get("nearest"))
            if not sibling:
                log(f"  admission SKIP {entry_id}: nearest sibling "
                    f"{item.get('nearest')} not in registry")
                continue
            entry = {
                "id": entry_id,
                "family": item.get("family") or entry_id.split(".")[0],
                "component": sibling.get("component"),
                "composition": sibling.get("composition"),
                "props_key": sibling.get("props_key"),
                "use_for": sibling.get("use_for"),
                "content_fit": sibling.get("content_fit"),
                "ratios": sibling.get("ratios"),
                "duration_s": sibling.get("duration_s"),
                "status": "implemented",
                "proof_clip": f"out/{run.get('mp4')}",
                "proof_note": (f"admission render {run.get('brief_id')} "
                               f"({run.get('run_id')}), critic PASS"),
                "critic_pass": True,
                "last_used_at": run.get("timestamp"),
                "use_count": 1,
            }
            if sibling.get("requires"):
                entry["requires"] = sibling["requires"]
            registry["entries"].append(entry)
            by_id[entry_id] = entry
            backlog["items"] = [i for i in backlog["items"]
                                if i.get("id") != entry_id]
            admitted.append(entry_id)
            log(f"  admitted {entry_id} (proof {run.get('mp4')})")
    if admitted:
        (Path(__file__).resolve().parent / "style_registry.json").write_text(
            json.dumps(registry, indent=2) + "\n")
        (Path(__file__).resolve().parent / "style_backlog.json").write_text(
            json.dumps(backlog, indent=2) + "\n")
    return admitted


def evaluate_report(tag):
    """Acceptance tests (PRD Section 9) from the History log."""
    runs = [r for r in hist.load_history()
            if (tag is None and (r.get("tag") or "").startswith("proof"))
            or (tag is not None and r.get("tag") == tag)]
    lines = [f"# Phase 1 acceptance report — tag {tag or 'proof*'}",
             "", f"Runs evaluated: {len(runs)}", ""]
    results = {}

    def verdict(name, ok, detail):
        results[name] = ok
        lines.append(f"## {name}: {'PASS' if ok else 'FAIL'}")
        lines.append(detail)
        lines.append("")

    # 1. 10-brief proof run: >= 8 distinct panel-or-style entries,
    # zero back-to-back panel-and-motion pair repeats.
    proof_runs = [r for r in runs
                  if not r.get("expect") and not r.get("forced")]
    distinct = set()
    for r in proof_runs:
        p = r.get("picks") or {}
        if p.get("panel"):
            distinct.add(p["panel"])
        if p.get("style"):
            distinct.add(p["style"])
    repeats = 0
    for a, b in zip(proof_runs, proof_runs[1:]):
        pa, pb = a.get("picks") or {}, b.get("picks") or {}
        if (pa.get("panel"), hist.effective_entry(pa)) == \
           (pb.get("panel"), hist.effective_entry(pb)):
            repeats += 1
    verdict("10-brief proof run",
            len(proof_runs) >= 10 and len(distinct) >= 8 and repeats == 0,
            f"{len(proof_runs)} unlabelled runs, {len(distinct)} distinct "
            f"panel/style entries ({sorted(distinct)}), {repeats} "
            f"back-to-back pair repeats (pass: >=8 distinct, 0 repeats)")

    # 2. Label test: 3 labelled briefs each render in the labelled style.
    labelled = [r for r in runs if (r.get("expect") or {}).get("label")]
    label_ok = []
    for r in labelled:
        want = (r.get("expect") or {})["label"]
        p = r.get("picks") or {}
        got = p.get("panel") or p.get("style") or p.get("move") or ""
        label_ok.append((r.get("brief_id"), want, got,
                         r.get("labelled") and want in (got, p.get("panel"),
                                                        p.get("style"),
                                                        p.get("move"))))
    verdict("Label test",
            len(labelled) >= 3 and all(x[3] for x in label_ok),
            "; ".join(f"{b}: want {w}, got {g} "
                      f"({'ok' if ok else 'MISMATCH'})"
                      for b, w, g, ok in label_ok)
            or "no labelled runs found")

    # 3. Gate test: a forced repeat fails Check 8, re-picks, logs both.
    gate = [r for r in runs if (r.get("expect") or {}).get("gate")]
    gate_detail = []
    gate_ok = False
    for r in gate:
        attempts = r.get("attempts") or []
        failed = [a for a in attempts
                  if (a.get("variety") or {}).get("status") == "FAIL"]
        passed = [a for a in attempts
                  if (a.get("variety") or {}).get("status") == "PASS"]
        gate_ok = bool(failed and passed and r.get("repicks"))
        gate_detail.append(f"{r.get('brief_id')}: {len(failed)} FAIL "
                           f"attempt(s), {len(passed)} PASS attempt(s), "
                           f"{len(r.get('repicks') or [])} re-pick(s) logged")
    verdict("Gate test", bool(gate) and gate_ok,
            "; ".join(gate_detail) or "no gate run found")

    # 4. Registry audit.
    import registry_audit
    audit, _registry = registry_audit.audit()
    verdict("Registry audit",
            audit["overall"] == "PASS",
            f"{len(audit['pass'])}/{audit['entries']} entries have "
            f"component + proof clip + Critic pass"
            + (f"; failures: {audit['fail']}" if audit["fail"] else ""))

    # 5. Draft-first test: thin Chart brief drafts with placeholders;
    # correcting a value and re-rendering works.
    drafts = [r for r in runs if (r.get("expect") or {}).get("draft")]
    draft_ok = False
    draft_detail = []
    for r in drafts:
        note = r.get("delivery_note") or ""
        has_placeholder = ("[VALUE" in note or "placeholder" in note.lower())
        correction = [c for c in runs
                      if c.get("corrects") == r.get("brief_id")]
        corr_ok = bool(correction) and not any(
            "[VALUE" in (c.get("delivery_note") or "") for c in correction)
        draft_ok = (r.get("critic", {}).get("overall") == "PASS"
                    and has_placeholder and corr_ok)
        draft_detail.append(
            f"{r.get('brief_id')}: critic "
            f"{r.get('critic', {}).get('overall')}, placeholders marked: "
            f"{has_placeholder}, corrected re-render: "
            f"{[c.get('brief_id') for c in correction] or 'none'} "
            f"(placeholders gone: {corr_ok})")
    verdict("Draft-first test", bool(drafts) and draft_ok,
            "; ".join(draft_detail) or "no draft run found")

    # 6. Unbuilt-style draft test: approximation flagged, never the
    # labelled style's name on the render.
    unbuilt = [r for r in runs if (r.get("expect") or {}).get("approx")]
    unbuilt_ok = False
    unbuilt_detail = []
    for r in unbuilt:
        want = (r.get("expect") or {})["approx"]
        approx = r.get("approximation") or ""
        p = r.get("picks") or {}
        used = p.get("style") or p.get("panel") or ""
        unbuilt_ok = bool(approx) and want not in used and "APPROXIMATION" in (r.get("delivery_note") or "")
        unbuilt_detail.append(
            f"{r.get('brief_id')}: asked {want}, drafted as {used}, "
            f"approximation flagged: {bool(approx)}")
    verdict("Unbuilt-style draft test", bool(unbuilt) and unbuilt_ok,
            "; ".join(unbuilt_detail) or "no unbuilt-style run found")

    lines.append(f"## Overall: {'PASS' if all(results.values()) else 'FAIL'} "
                 f"({sum(results.values())}/{len(results)} tests)")
    report = "\n".join(lines)
    return report, results


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--briefs", default="briefs/phase1-*.json",
                    help="glob of brief JSON files (relative to repo)")
    ap.add_argument("--tag", default="proof-1",
                    help="run tag recorded in history")
    ap.add_argument("--dry-run", action="store_true",
                    help="route + storyboard only, no iMac render")
    ap.add_argument("--admission", action="store_true",
                    help="admit forced picks to the registry on PASS")
    ap.add_argument("--admit-only", action="store_true",
                    help="admit from existing history for the tag, no renders")
    ap.add_argument("--report", action="store_true",
                    help="evaluate acceptance from history and exit")
    ap.add_argument("--no-sync", action="store_true",
                    help="skip the src/ sync to the iMac")
    args = ap.parse_args(argv)

    if args.admit_only:
        admitted = admit_entries(args.tag)
        log(f"admitted to registry: {admitted or 'none'}")
        return 0

    if args.report:
        report, results = evaluate_report(args.tag if args.tag else None)
        path = REPO / "out" / f"phase1-acceptance-{args.tag or 'proof'}.md"
        path.write_text(report + "\n")
        print(report)
        print(f"\nReport written to {path}")
        return 0 if all(results.values()) else 1

    files = sorted(glob.glob(str(REPO / args.briefs)))
    # Generated storyboards live next to the briefs as
    # <slug>-harness.json — they are outputs, never inputs.
    files = [f for f in files if not f.endswith("-harness.json")]
    if not files:
        print(f"no briefs matched {args.briefs}")
        return 2
    log(f"{len(files)} brief(s), tag {args.tag}")
    if not args.dry_run and not args.no_sync:
        log("syncing src/ to the iMac (once for the run)")
        rsync_dir_to_imac(REPO / "src", "src")
    done = []
    for f in files:
        try:
            done.append(run_brief(f, args.tag, dry_run=args.dry_run))
        except Exception as e:
            log(f"FAILED {f}: {e}")
            done.append({"brief": f, "error": str(e)})
    if args.admission and not args.dry_run:
        admitted = admit_entries(args.tag)
        log(f"admitted to registry: {admitted or 'none'}")
    failed = [d for d in done if d.get("error")]
    log(f"done: {len(done) - len(failed)}/{len(done)} briefs rendered")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
