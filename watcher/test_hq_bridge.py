#!/usr/bin/env python3
"""Tests for the Bot HQ bridge (hq_bridge.py + watcher HQ wiring).

No live HQ calls: poll_inbox is NEVER called here, because a real
inbox fetch marks messages delivered server-side. The live proof is
the next watcher run's summary (hq entries + heartbeat attempt).
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import hq_bridge
import watch_motion_bot as w
import memory

PASS = []
FAIL = []


def check(name, ok, extra=""):
    (PASS if ok else FAIL).append(name)
    print(f"{'ok' if ok else 'FAIL'}: {name} {extra}")


def main():
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        hq_bridge.SEEN_PATH = t / "hq_seen.json"
        hq_bridge.PENDING_PATH = t / "hq_pending.json"
        memory.MEMORY_PATH = t / "memory.json"
        w.log = lambda m: None

        # 1. Title + correction + command parsing (verbatim, no gating).
        check("split_title first line",
              hq_bridge.split_title("Hello world story\nsecond line") == "Hello world story")
        check("split_title empty", hq_bridge.split_title("  \n ") == "")
        check("correction id",
              hq_bridge.correction_task_id("Fix task-236: the cursor must end it.") == 236)
        check("correction none",
              hq_bridge.correction_task_id("make me a clip about dogs") is None)
        check("status command",
              hq_bridge.is_command("Status?", "status") and not hq_bridge.is_command("status update", "status"))
        check("help command", hq_bridge.is_command("  help ", "help"))

        # 2. Pending / seen roundtrip.
        hq_bridge.add_pending({"id": 7, "body": "hi", "in_reply_to": None})
        check("pending stored", len(hq_bridge.load_pending()) == 1)
        hq_bridge.add_pending({"id": 7, "body": "hi", "in_reply_to": None})
        check("pending dedup", len(hq_bridge.load_pending()) == 1)
        hq_bridge.mark_seen(7, 999)
        check("seen stored", hq_bridge.load_seen()["7"]["task_id"] == 999)
        hq_bridge.drop_pending(7)
        check("pending dropped", hq_bridge.load_pending() == [])

        # 3. Handle: status command (no task, reply sent, seen marked).
        sent = []
        hq_bridge.load_key = lambda: "test-key"
        hq_bridge.send_message = lambda k, b, in_reply_to=None: sent.append((b, in_reply_to))
        summary = {"hq": []}
        origin = {}
        ok = w._hq_handle_message("pw", {"id": 11, "body": "status"},
                                  origin, summary, "Motion Bot queue — open: 1.")
        check("status handled", ok is True and sent and sent[0][1] == 11
              and summary["hq"][0]["action"] == "status_reply")

        # 4. Handle: new task (POST -> verify GET -> queued dict, no dup).
        api_calls = []

        def fake_api(method, path, password, body=None):
            api_calls.append((method, path, body))
            if method == "POST":
                return {"data": {"id": 999}}
            if path == "/api/tasks/999":
                return {"data": {"id": 999, "title": "Dogs in space",
                                 "details": "Dogs in space\nA golden retriever floats."}}
            raise AssertionError((method, path))

        w.api = fake_api
        w.patch_task = lambda pw, tid, fields: api_calls.append(("PATCH", tid, fields))
        summary = {"hq": []}
        origin = {}
        created = w._hq_handle_message(
            "pw", {"id": 12, "body": "Dogs in space\nA golden retriever floats."},
            origin, summary, "status")
        check("task created + queued", isinstance(created, dict) and created["id"] == 999
              and origin[999] == 12 and summary["hq"][0]["action"] == "task_created")
        # Retry of the same message must NOT duplicate the task.
        api_calls.clear()
        ok = w._hq_handle_message(
            "pw", {"id": 12, "body": "Dogs in space\nA golden retriever floats."},
            origin, summary, "status")
        check("duplicate suppressed", ok is True and api_calls == [])

        # 5. Handle: correction (verbatim record + details append + reopen).
        def fake_api2(method, path, password, body=None):
            api_calls.append((method, path, body))
            if method == "GET":
                return {"data": {"id": 236, "title": "The Anatomy of Slop",
                                 "details": "original beat sheet"}}
            return {"ok": True}

        w.api = fake_api2
        summary = {"hq": []}
        origin = {}
        ok = w._hq_handle_message(
            "pw", {"id": 13, "body": "task-236: the cursor must END the clip, not open it."},
            origin, summary, "status")
        patch = [c for c in api_calls if c[0] == "PATCH"][0][2]
        check("correction applied verbatim",
              ok is True and patch["status"] == "open"
              and "the cursor must END the clip, not open it." in patch["details"]
              and patch["details"].startswith("original beat sheet"))
        mem = memory.load()
        check("correction in memory verbatim",
              any("END the clip, not open it" in c["text"] for c in mem["corrections"]))

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILED:", FAIL)
        return 1
    print("ALL HQ BRIDGE TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
