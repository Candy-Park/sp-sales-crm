"""Synthetic-only receipt experiment; not a production Outlook agent."""

import sqlite3


class ReceiptQueue:
    def __init__(self, path):
        self.connection = sqlite3.connect(path)
        with self.connection:
            self.connection.execute("""
                CREATE TABLE IF NOT EXISTS receipts (
                    store_id TEXT NOT NULL,
                    entry_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    receipt_id TEXT,
                    PRIMARY KEY (store_id, entry_id)
                )
            """)

    @staticmethod
    def _check_identifiers(*values):
        if any(not isinstance(value, str) or not value.strip() for value in values):
            raise ValueError("Nonempty identifiers required")

    def enqueue(self, store_id, entry_id, payload):
        self._check_identifiers(store_id, entry_id)
        if not isinstance(payload, str):
            raise ValueError("Synthetic payload must be text")
        with self.connection:
            self.connection.execute(
                "INSERT OR IGNORE INTO receipts(store_id, entry_id, payload) VALUES (?, ?, ?)",
                (store_id, entry_id, payload),
            )
            stored = self.connection.execute(
                "SELECT payload FROM receipts WHERE store_id=? AND entry_id=?",
                (store_id, entry_id),
            ).fetchone()
            if stored[0] != payload:
                raise ValueError("Same source identity has conflicting content")

    def pending(self):
        return self.connection.execute(
            "SELECT store_id, entry_id, payload FROM receipts "
            "WHERE receipt_id IS NULL ORDER BY store_id, entry_id"
        ).fetchall()

    def acknowledge(self, store_id, entry_id, receipt_id):
        self._check_identifiers(store_id, entry_id, receipt_id)
        with self.connection:
            result = self.connection.execute(
                "UPDATE receipts SET receipt_id=COALESCE(receipt_id, ?) WHERE store_id=? AND entry_id=?",
                (receipt_id, store_id, entry_id),
            )
            if result.rowcount != 1:
                raise KeyError("Unknown source identity")
            stored = self.connection.execute(
                "SELECT receipt_id FROM receipts WHERE store_id=? AND entry_id=?",
                (store_id, entry_id),
            ).fetchone()
            if stored[0] != receipt_id:
                raise ValueError("Conflicting receipt cannot replace original")

    def close(self):
        self.connection.close()
