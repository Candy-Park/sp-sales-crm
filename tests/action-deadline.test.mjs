import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultActionDue,extendActionDue} from '../src/action-deadline.mjs';
test('default due is three calendar days after Seoul date across month/year/leap boundaries',()=>{
 assert.equal(defaultActionDue(new Date('2026-10-11T15:01:00Z')),'2026-10-15');
 assert.equal(defaultActionDue(new Date('2026-12-30T00:00:00Z')),'2027-01-02');
 assert.equal(defaultActionDue(new Date('2028-02-27T00:00:00Z')),'2028-03-01');
});
test('extension adds three days to the later of current deadline or today, invalid input rejected',()=>{
 const now=new Date('2026-10-11T00:00:00Z');
 assert.equal(extendActionDue('2026-10-12',now),'2026-10-15');
 assert.equal(extendActionDue('2026-10-01',now),'2026-10-14');
 assert.equal(extendActionDue('',now),'2026-10-14');
 assert.throws(()=>extendActionDue('2026-02-31',now));
 assert.throws(()=>defaultActionDue(new Date('invalid')));
});
