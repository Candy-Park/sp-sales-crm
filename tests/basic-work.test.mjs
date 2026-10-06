import test from 'node:test';
import assert from 'node:assert/strict';
import { actionBucket, cancelAction, closeInquiry } from '../src/basic-work.mjs';

const now = '2026-10-06T15:10:00Z'; // Seoul: October 7, 00:10.
const inquiry = { id: 'demo-inquiry', owner_id: 'demo-owner', status: 'new', revision: 1 };
const action = { id: 'demo-action', inquiry_id: 'demo-inquiry', owner_id: 'demo-owner', status: 'open', mandatory: true, revision: 1 };

test('Seoul midnight determines Today, Overdue and undated work', () => {
  assert.equal(actionBucket({...action, due_date:'2026-10-07'}, now), 'today');
  assert.equal(actionBucket({...action, due_date:'2026-10-06'}, now), 'overdue');
  assert.equal(actionBucket({...action, due_date:'2026-10-08'}, now), 'upcoming');
  assert.equal(actionBucket({...action, due_date:null}, now), 'undated');
});
test('completed and cancelled actions leave unfinished buckets', () => {
  assert.equal(actionBucket({...action,status:'completed',due_date:'2026-10-01'},now), 'finished');
  assert.equal(actionBucket({...action,status:'cancelled'},now), 'finished');
});
test('invalid due dates or clock fail instead of misleading classification', () => {
  assert.throws(() => actionBucket({...action,due_date:'2026-02-31'},now));
  assert.throws(() => actionBucket(action,'invalid-time'));
});
test('cancelling requires a reason and preserves the original action', () => {
  assert.throws(() => cancelAction(action,'  ',now));
  const cancelled=cancelAction(action,'No longer required',now);
  assert.equal(cancelled.status,'cancelled');
  assert.equal(cancelled.cancel_reason,'No longer required');
  assert.equal(cancelled.revision,2);
  assert.equal(action.status,'open');
});
test('unresolved questions and open mandatory actions prevent closure', () => {
  assert.throws(() => closeInquiry(inquiry,[],false,now));
  assert.throws(() => closeInquiry(inquiry,[action],true,now));
});
test('valid completed and cancelled work permits closure without deleting data', () => {
  const closed=closeInquiry(inquiry,[{...action,status:'completed',completed_at:now}],true,now);
  assert.equal(closed.status,'closed');
  assert.equal(closed.closed_at,now);
  assert.equal(closed.revision,2);
  assert.equal(inquiry.status,'new');
  assert.equal(closeInquiry(inquiry,[{...action,status:'cancelled',cancel_reason:'Duplicate follow-up'}],true,now).status,'closed');
});
test('foreign-owner actions and invalid completion evidence prevent closure', () => {
  assert.throws(() => closeInquiry(inquiry,[{...action,owner_id:'other-owner',status:'completed',completed_at:now}],true,now));
  assert.throws(() => closeInquiry(inquiry,[{...action,status:'completed'}],true,now));
  assert.throws(() => closeInquiry(inquiry,[{...action,status:'cancelled',cancel_reason:' '}],true,now));
});

test('impossible calendar timestamps and ambiguous clock formats are rejected', () => {
  const invalid='2026-02-31T00:00:00Z';
  assert.throws(() => actionBucket({...action,due_date:'2026-03-03'},invalid));
  assert.throws(() => cancelAction(action,'No longer required',invalid));
  assert.throws(() => closeInquiry(inquiry,[],true,invalid));
  assert.throws(() => actionBucket(action,'2026-10-06T24:00:00Z'));
  assert.throws(() => actionBucket(action,'October 6, 2026 UTC'));
});
