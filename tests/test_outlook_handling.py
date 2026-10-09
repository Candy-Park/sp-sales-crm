import unittest,tempfile,sqlite3,json,hashlib,uuid,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from outlook_handling import read_handling

class HandlingTest(unittest.TestCase):
    def test_verified_owner_receipt_and_original_are_required_and_input_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);db=root/'queue.sqlite';worksheet=root/'review.json'
            owner=str(uuid.uuid4());server=str(uuid.uuid4());key='a'*64
            mail={'direction':'received','source_key':key,'body':'SYNTHETIC only'}
            payload=json.dumps(mail);hashed=hashlib.sha256(payload.encode()).hexdigest()
            case={'source_key':key,'payload_sha256':hashlib.sha256(json.dumps(mail,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'case_id':'M20-01','user_review_status':'user_confirmed_crm_handling','crm_registration_candidate':True,'expected_category':'고객 업무','expected_role':'고객사','confirmed_handling_reason':'SYNTHETIC user review'}
            with sqlite3.connect(db) as c:
                c.execute('create table agent_binding(key text,value text)');c.execute('insert into agent_binding values (?,?)',('owner',owner))
                c.execute('create table mail_outbox(scope_key text,source_key text,payload text,payload_hash text,receipt text)')
                c.execute('insert into mail_outbox values (?,?,?,?,?)',('b'*64,key,payload,hashed,json.dumps({'id':server,'source_key':key,'payload_hash':hashed})))
            c.close()
            worksheet.write_text(json.dumps({'version':2,'cases':[case]}));before=hashlib.sha256(db.read_bytes()).hexdigest()
            result=read_handling(db,worksheet,owner);self.assertEqual(result[0]['id'],server);self.assertEqual(result[0]['category'],'고객 업무');self.assertNotIn('body',json.dumps(result));self.assertEqual(hashlib.sha256(db.read_bytes()).hexdigest(),before)
            with self.assertRaises(ValueError):read_handling(db,worksheet,str(uuid.uuid4()))
            case['payload_sha256']='c'*64;worksheet.write_text(json.dumps({'version':2,'cases':[case]}))
            with self.assertRaises(ValueError):read_handling(db,worksheet,owner)

if __name__=='__main__':unittest.main()
