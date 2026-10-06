import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardSummary} from '../src/dashboard.mjs';
test('dashboard uses actual DB due_date and Seoul midnight for counts',()=>{
  const data={actions:[{status:'open',due_date:'2026-10-07'},{status:'open',due_date:'2026-10-06'},{status:'open',due_date:null}],inquiries:[{status:'waiting_for_hq'},{status:'new'},{status:'waiting_for_customer'}]};
  assert.deepEqual(dashboardSummary(data,'2026-10-06T15:10:00Z'),{today:1,overdue:1,waiting:2});
});
