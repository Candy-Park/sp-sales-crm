"""Synthetic only: isolated backup, corruption detection and no live replacement."""
import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from tools.outlook_outbox import Outbox
from tools.outlook_restore_verify import verify
from tests.test_outlook_outbox import batch,mail,SCOPE,OWNER


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        self.source=root/'source.sqlite';self.backup=root/'backup.sqlite';self.restore=root/'restore.sqlite'
        box=Outbox(self.source);box.bind_owner(OWNER);box.stage(batch(mail(),mail('d'*64)))
        record=box.pending(SCOPE)[0]
        box.acknowledge(SCOPE,record['source_key'],dict(id=record['id'],source_key=record['source_key'],payload_hash=record['payload_hash']))
        box.close()

    def test_restored_mixed_pending_receipts_survive_replay_and_restart_without_touching_source(self):
        source_hash=hashlib.sha256(self.source.read_bytes()).hexdigest()
        result=verify(self.source,self.backup,self.restore)
        self.assertEqual(result['counts']['pending'],1);self.assertEqual(result['counts']['receipted'],1)
        self.assertEqual(result['replay_inserted'],0);self.assertEqual(result['replay_duplicates'],2)
        self.assertTrue(result['source_unchanged']);self.assertTrue(result['other_owner_rejected'])
        self.assertEqual(result['network_calls'],0)
        self.assertEqual(source_hash,hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertNotIn('synthetic@example.invalid',json.dumps(result))
        self.assertNotIn(mail()['body'],json.dumps(result))

    def test_existing_or_live_destination_is_never_replaced(self):
        source_hash=hashlib.sha256(self.source.read_bytes()).hexdigest()
        with self.assertRaises(ValueError):verify(self.source,self.source,self.restore)
        self.backup.write_text('preserve')
        with self.assertRaises(ValueError):verify(self.source,self.backup,self.restore)
        self.assertEqual(self.backup.read_text(),'preserve')
        self.assertEqual(source_hash,hashlib.sha256(self.source.read_bytes()).hexdigest())

    def test_corrupt_original_is_detected_before_backup(self):
        with closing(sqlite3.connect(self.source)) as db:
            with db:db.execute("UPDATE mail_outbox SET payload_hash=?",('f'*64,))
        with self.assertRaises(ValueError):verify(self.source,self.backup,self.restore)
        self.assertFalse(self.backup.exists());self.assertFalse(self.restore.exists())

    def test_invalid_receipt_never_becomes_a_verified_backup(self):
        with closing(sqlite3.connect(self.source)) as db:
            with db:db.execute('UPDATE mail_outbox SET receipt=? WHERE receipt IS NOT NULL',(json.dumps(dict(id=OWNER,source_key='e'*64,payload_hash='f'*64)),))
        source_hash=hashlib.sha256(self.source.read_bytes()).hexdigest()
        with self.assertRaises(ValueError):verify(self.source,self.backup,self.restore)
        self.assertFalse(self.backup.exists())
        self.assertEqual(source_hash,hashlib.sha256(self.source.read_bytes()).hexdigest())


if __name__=='__main__':unittest.main()
