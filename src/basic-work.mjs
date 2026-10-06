/** Pure domain rules. No DB, credentials, network or real mail. */
const statuses = new Set(['open','completed','cancelled']);
const inquiryStatuses = new Set(['new','product_search','need_hq_confirmation','waiting_for_hq','customer_reply_needed','waiting_for_customer','closed']);

function clock(now) {
  // ISO calendar timestamp, seconds, optional 1-3 fractional digits and explicit zone.
  const match=typeof now==='string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(now);
  if (!match) throw new Error('Explicit ISO time zone required');
  dueDate(match[1]);
  if (+match[2]>23 || +match[3]>59 || +match[4]>59 || +(match[7]??0)>23 || +(match[8]??0)>59) throw new Error('Invalid clock');
  const date=new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid clock');
  return date;
}
function validAction(action) {
  if (!action || !statuses.has(action.status)) throw new Error('Unknown Action status');
}
function nextRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value === Number.MAX_SAFE_INTEGER) throw new Error('Invalid revision');
  return value+1;
}
function dueDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) throw new Error('Invalid due date');
  const date=new Date(value+'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) throw new Error('Invalid due date');
  return value;
}

export function actionBucket(action, now) {
  const date=clock(now);
  validAction(action);
  if (action.status!=='open') return 'finished';
  if (action.due_date===null || action.due_date===undefined) return 'undated';
  const due=dueDate(action.due_date);
  const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(date);
  const get=type=>parts.find(p=>p.type===type).value;
  const today=`${get('year')}-${get('month')}-${get('day')}`;
  return due===today ? 'today' : due<today ? 'overdue' : 'upcoming';
}

export function cancelAction(action, reason, now) {
  clock(now);
  validAction(action);
  if (action.status!=='open') throw new Error('Only open Actions can be cancelled');
  if (typeof reason!=='string' || !reason.trim()) throw new Error('Cancellation reason required');
  return {...action,status:'cancelled',cancel_reason:reason.trim(),completed_at:null,updated_at:now,revision:nextRevision(action.revision)};
}

export function closeInquiry(inquiry, actions, resolved, now) {
  clock(now);
  if (!inquiry || !inquiry.id || !inquiry.owner_id || !inquiryStatuses.has(inquiry.status)) throw new Error('Invalid Inquiry');
  if (inquiry.status==='closed') throw new Error('Inquiry is already closed');
  if (resolved!==true) throw new Error('User must confirm questions resolved');
  if (!Array.isArray(actions)) throw new Error('Related Actions required');
  for (const action of actions) {
    validAction(action);
    if (action.inquiry_id!==inquiry.id || action.owner_id!==inquiry.owner_id) throw new Error('Unrelated Action');
    if (typeof action.mandatory!=='boolean') throw new Error('Mandatory flag required');
    if (action.status==='completed') clock(action.completed_at);
    if (action.status==='cancelled' && (typeof action.cancel_reason!=='string' || !action.cancel_reason.trim())) throw new Error('Cancellation reason missing');
    if (action.mandatory && action.status==='open') throw new Error('Open mandatory Action prevents closure');
  }
  return {...inquiry,status:'closed',closed_at:now,updated_at:now,revision:nextRevision(inquiry.revision)};
}
