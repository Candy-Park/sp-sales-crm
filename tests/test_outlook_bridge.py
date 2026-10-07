import hashlib
import json
import sys
import tempfile
import unittest
import subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'tools'))
from outlook_bridge import envelope
from outlook_outbox import Outbox,canonical

class BridgeTests(unittest.TestCase):
    def test_received_only_folders_and_helper_direction_survive_dot_source(self):
        collector=str(Path(__file__).resolve().parent.parent/'tools/outlook_capture.ps1').replace("'","''")
        script="& {param([string]$CaptureDirection); . '"+collector+"' -LibraryOnly; $folders=@(Get-CrmCaptureFolders $CaptureDirection); if($CaptureDirection -ne 'received' -or $folders.Count -ne 1 -or $folders[0].Id -ne 6 -or $folders[0].Date -ne 'ReceivedTime'){throw 'Received scope changed'}; if(@(Get-CrmCaptureFolders).Count -ne 2){throw 'Default changed'}; if(@(Get-CrmCaptureFolders 'sent')[0].Id -ne 5){throw 'Sent scope changed'} } -CaptureDirection 'received'"
        result=subprocess.run(['powershell.exe','-NoProfile','-Command',script],capture_output=True)
        self.assertEqual(result.returncode,0,'Direction selection must preserve default scope and received-only selection')
    def test_scope_helper_dates_survive_dot_sourced_collector_parameters(self):
        collector=str(Path(__file__).resolve().parent.parent/'tools/outlook_capture.ps1').replace("'","''")
        script="& {param([datetime]$ScopeStart,[datetime]$ScopeEnd,[string]$CaptureDestination); . '"+collector+"' -LibraryOnly; if($ScopeStart.Year -ne 2026 -or $ScopeEnd.Month -ne 10 -or $CaptureDestination -ne 'synthetic.json'){throw 'Scope parameters overwritten'} } -ScopeStart '2026-09-07T01:27:00' -ScopeEnd '2026-10-07T01:27:00' -CaptureDestination 'synthetic.json'"
        result=subprocess.run(['powershell.exe','-NoProfile','-Command',script],capture_output=True)
        self.assertEqual(result.returncode,0,'Collector dot-source must preserve helper window and output')
    def record(self,body):
        mail=dict(source_key='b'*64,identity_method='internet_message_id',direction='received',subject='synthetic',body=body,sender='x@example.test',recipients='y@example.test',occurred_at='2026-10-06T12:00:00Z',conversation_key=None,attachments=[])
        return mail|dict(id='00000000-0000-4000-8000-000000000071',scope_key='a'*64,payload_hash=hashlib.sha256(canonical(mail).encode()).hexdigest())
    def test_normal_original_hash_matches_transport_exact_utf8(self):
        r=self.record('한글 😀 <script> source');e=envelope(r)
        self.assertEqual(e['payload_hash'],hashlib.sha256(e['original_json'].encode()).hexdigest())
        self.assertEqual(json.loads(e['original_json'])['body'],r['body'])
    def test_held_original_never_enters_transport(self):
        r=self.record('가'*100001);e=envelope(r)
        self.assertEqual(e['body_length'],100001);self.assertIsNone(json.loads(e['original_json'])['body']);self.assertEqual(e['payload_hash'],r['payload_hash'])
    def test_limit_and_empty_body_preserved(self):
        for body in ['', '😀'*100000]:self.assertEqual(json.loads(envelope(self.record(body))['original_json'])['body'],body)
    def test_reopening_queue_preserves_large_original_and_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'queue.sqlite';r=self.record('가'*100001)
            batch=dict(version=1,batch_id=r['id'],scope_key=r['scope_key'],start='2026-10-06T00:00:00Z',end='2026-10-07T00:00:00Z',records=[{k:v for k,v in r.items() if k not in {'id','scope_key','payload_hash'}}])
            b=Outbox(path);b.stage(batch);saved=b.pending(r['scope_key'])[0];b.close()
            b=Outbox(path);self.assertEqual(b.pending(r['scope_key'])[0],saved);self.assertIsNone(json.loads(envelope(saved)['original_json'])['body'])
            receipt={k:saved[k] for k in ['id','source_key','payload_hash']};b.acknowledge(r['scope_key'],r['source_key'],receipt);b.close()
            b=Outbox(path);self.assertEqual(b.status(r['scope_key'])['pending'],0);self.assertEqual(json.loads(b.connection.execute('select payload from mail_outbox').fetchone()[0])['body'],r['body']);b.close()

if __name__=='__main__':unittest.main()
