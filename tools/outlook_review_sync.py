"""Explicit authenticated review sync. Deterministic metadata requests, no AI or mail writes."""
import json
import time
import uuid
from outlook_outbox import canonical, DeliveryError, RETRYABLE_STATUS
from outlook_review import report, merge_outbox, CONFIRMED_CATEGORIES, CONFIRMED_ROLES

RULE_VERSION='local-rules:multilingual-v2'


def request_id(owner,kind,value):
    return str(uuid.uuid5(uuid.NAMESPACE_URL,canonical([owner,kind,value])))


def retry(rpc,name,data,wait):
    for attempt in range(3):
        try:return rpc(name,data)
        except DeliveryError as error:
            if error.status not in RETRYABLE_STATUS or attempt==2:raise
        except (TimeoutError,OSError):
            if attempt==2:raise
        wait(attempt+1)


def sync_review(box,batch,settings,owner,rpc,wait=time.sleep):
    box.bind_owner(owner)
    staged=box.stage(batch)
    # Do not import bridge here: keep credentials/transport out of review logic.
    from outlook_bridge import envelope
    delivery=box.flush(batch['scope_key'],lambda record:rpc('sales_ingest_outlook',{'p_data':envelope(record)}),limit=5000,wait=wait)
    state=dict(proposals=0,seeded_labels=0,preserved_labels=0,error=None,rule_version=RULE_VERSION)
    result=dict(staged=staged,delivery=delivery,review_sync=state)
    if delivery['pending']:
        state['error']='mail_delivery_pending';return result
    database=box.connection.execute('PRAGMA database_list').fetchone()[2]
    from pathlib import Path
    merged=merge_outbox(batch,Path(database))
    candidates=report(merged,{k:v for k,v in settings.items() if k!='confirmed_labels'})['rows']
    receipts={key:json.loads(receipt) for key,receipt in box.connection.execute('SELECT source_key,receipt FROM mail_outbox WHERE scope_key=?',(batch['scope_key'],))}
    try:
        for row in candidates:
            metadata={key:row[key] for key in ['source_key','role','category','confidence','evidence']}
            metadata.update(scope_key=batch['scope_key'],customer_ref=row['customer'],rule_version=RULE_VERSION)
            metadata['id']=request_id(owner,'proposal',metadata)
            response=retry(rpc,'sales_propose_outlook',{'p_data':metadata},wait)
            if not isinstance(response,dict) or response.get('id')!=metadata['id'] or response.get('source_key')!=row['source_key'] or response.get('mail_id')!=receipts[row['source_key']]['id']:raise ValueError('Invalid receipt')
            state['proposals']+=1
        for label in settings.get('confirmed_labels',[]):
            if label.get('confirmed_by')!='user' or label.get('category') not in CONFIRMED_CATEGORIES or label.get('role','미확인') not in CONFIRMED_ROLES:raise ValueError('Explicit user label required')
            if label['source_key'] not in receipts:raise ValueError('Confirmed source unavailable')
            data=dict(revision=0,role=label.get('role','미확인'),category=label['category'])
            data['id']=request_id(owner,'seed-label',dict(scope_key=batch['scope_key'],**label))
            mid=receipts[label['source_key']]['id']
            try: response=retry(rpc,'sales_classify_outlook',{'p_id':mid,'p_data':data},wait)
            except DeliveryError as error:
                if error.status==409:state['preserved_labels']+=1;continue
                raise
            if not isinstance(response,dict) or response.get('id')!=data['id'] or response.get('mail_id')!=mid or response.get('revision')!=1 or response.get('role')!=data['role'] or response.get('category')!=data['category']:raise ValueError('Invalid receipt')
            state['seeded_labels']+=1
    except DeliveryError as error:state['error']=f'http_{error.status}'
    except (TimeoutError,OSError):state['error']='network_error'
    except ValueError:state['error']='invalid_receipt'
    return result
