import test from 'node:test';import assert from 'node:assert/strict';
import {crmRequestTimeout} from '../web/crm-connection.mjs';
test('bounded multi-step reconciliation has time to finish; reads and collector kickoff retain short timeout',()=>{
 assert.equal(crmRequestTimeout('/api/followups','POST',{operation:'reconcile'}),120000);
 assert.equal(crmRequestTimeout('/api/followups','POST',{operation:'choose'}),120000);
 assert.equal(crmRequestTimeout('/api/followups','POST',{operation:'refresh'}),15000);
 assert.equal(crmRequestTimeout('/api/followups?view=analysis','GET'),15000);
 assert.equal(crmRequestTimeout('/api/inquiries','POST',{operation:'reconcile'}),15000);
});
