"""No real mail: exercise persistence and receipt failure boundaries."""

import tempfile
import unittest
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path

from tools.sync_receipt_probe import ReceiptQueue


class ReceiptQueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "synthetic.sqlite"
        self.queue = ReceiptQueue(self.path)
        self.addCleanup(self.queue.close)

    def test_duplicate_retry_keeps_one_pending_message(self):
        for _ in range(3):
            self.queue.enqueue("demo-store", "entry-1", "synthetic")
        self.assertEqual(self.queue.pending(), [("demo-store", "entry-1", "synthetic")])

    def test_unacknowledged_message_survives_reopen(self):
        self.queue.enqueue("demo-store", "entry-1", "synthetic")
        self.queue.close()
        reopened = ReceiptQueue(self.path)
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.pending(), [("demo-store", "entry-1", "synthetic")])

    def test_lost_response_keeps_retryable_key_until_receipt(self):
        self.queue.enqueue("demo-store", "entry-1", "synthetic")
        # Remote outcome is unknown: do not acknowledge on send alone.
        self.queue.close()
        reopened = ReceiptQueue(self.path)
        self.addCleanup(reopened.close)
        reopened.enqueue("demo-store", "entry-1", "synthetic")
        self.assertEqual(reopened.pending(), [("demo-store", "entry-1", "synthetic")])
        reopened.acknowledge("demo-store", "entry-1", "demo-receipt")
        reopened.enqueue("demo-store", "entry-1", "synthetic")
        self.assertEqual(reopened.pending(), [])
        reopened.close()
        final = ReceiptQueue(self.path)
        self.addCleanup(final.close)
        self.assertEqual(final.pending(), [])

    def test_identical_entry_ids_in_different_stores_remain_separate(self):
        self.queue.enqueue("store-a", "entry-1", "synthetic-a")
        self.queue.enqueue("store-b", "entry-1", "synthetic-b")
        self.assertEqual(self.queue.pending(), [
            ("store-a", "entry-1", "synthetic-a"),
            ("store-b", "entry-1", "synthetic-b"),
        ])

    def test_empty_receipt_does_not_drop_pending_message(self):
        self.queue.enqueue("demo-store", "entry-1", "synthetic")
        with self.assertRaises(ValueError):
            self.queue.acknowledge("demo-store", "entry-1", " ")
        self.assertEqual(len(self.queue.pending()), 1)

    def test_changed_payload_rejects_silent_overwrite(self):
        self.queue.enqueue("demo-store", "entry-1", "original-synthetic")
        with self.assertRaises(ValueError):
            self.queue.enqueue("demo-store", "entry-1", "changed-synthetic")
        self.assertEqual(self.queue.pending(), [("demo-store", "entry-1", "original-synthetic")])

    def test_missing_id_is_not_enqueued_and_unknown_receipt_is_not_accepted(self):
        with self.assertRaises(ValueError):
            self.queue.enqueue("", "entry-1", "synthetic")
        with self.assertRaises(KeyError):
            self.queue.acknowledge("demo-store", "missing-entry", "receipt")
        self.assertEqual(self.queue.pending(), [])

    def test_conflicting_receipt_cannot_replace_original_after_reopen(self):
        self.queue.enqueue("demo-store", "entry-1", "synthetic")
        self.queue.acknowledge("demo-store", "entry-1", "receipt-a")
        self.queue.close()
        reopened = ReceiptQueue(self.path)
        self.addCleanup(reopened.close)
        reopened.acknowledge("demo-store", "entry-1", "receipt-a")
        with self.assertRaises(ValueError):
            reopened.acknowledge("demo-store", "entry-1", "receipt-b")
        with closing(sqlite3.connect(self.path)) as connection:
            self.assertEqual(connection.execute("SELECT receipt_id FROM receipts").fetchone(), ("receipt-a",))


@unittest.skipUnless(sys.platform == "win32", "Windows PowerShell probe")
class OutlookBoundaryTests(unittest.TestCase):
    def test_subminute_boundaries_are_rejected_before_outlook_access(self):
        script = Path(__file__).resolve().parents[1] / "tools" / "outlook_readonly_probe.ps1"
        result = subprocess.run([
            "powershell.exe", "-NoProfile", "-File", str(script),
            "-StoreDisplayName", "synthetic-nonexistent-store",
            "-Start", "2026-10-06T10:00:30", "-End", "2026-10-06T10:01:30",
        ], capture_output=True, timeout=20)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"whole-minute", result.stderr)


if __name__ == "__main__":
    unittest.main()
