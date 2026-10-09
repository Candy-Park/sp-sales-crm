import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSubmission,dumpJobs} from '../tools/auth-backup.mjs';
const nonce='a'.repeat(64),password='synthetic-only password+&';
const headers={host:'127.0.0.1:4323',origin:'http://127.0.0.1:4323','content-type':'application/x-www-form-urlencoded'};
const body=new URLSearchParams({nonce,password}).toString();
test('private form accepts only the exact local origin and nonce',()=>{
 assert.equal(validateSubmission(headers,body,nonce),password);
 for(const mutation of [{origin:'http://evil.test'},{host:'localhost:4323'},{origin:undefined}])assert.throws(()=>validateSubmission({...headers,...mutation},body,nonce));
 assert.throws(()=>validateSubmission(headers,body,'b'.repeat(64)));
});
test('malformed, duplicated and oversized password submissions are rejected without disclosure',()=>{
 for(const bad of [body+'&password=duplicate',body+'&extra=x',new URLSearchParams({nonce,password:''}).toString(),'x'.repeat(5000)]){
  assert.throws(()=>validateSubmission(headers,bad,nonce),error=>!error.message.includes(password));
 }
});
test('dump password travels only in child environment, never arguments; three official exports',()=>{
 const jobs=dumpJobs('D:/private-test',password);
 assert.equal(jobs.length,3);
 for(const job of jobs){assert.ok(!job.args.some(arg=>arg.includes(password)));assert.equal(job.env.SUPABASE_DB_PASSWORD,password);assert.equal(job.env.PGPASSWORD,password);assert.ok(job.args.includes('--file'));assert.ok(!job.args.includes('--debug'));}
 assert.ok(jobs[0].args.includes('--role-only'));
 assert.ok(jobs[2].args.includes('--data-only'));assert.ok(jobs[2].args.includes('--use-copy'));
});
