import test from 'node:test';
import assert from 'node:assert/strict';
import {pinExpirySession} from '../tools/expiry-auth.mjs';

test('expiry adapter retains issued token past expiry without SDK refresh or refresh-token exposure', async () => {
  let refreshed = 0, expiry;
  const client = pinExpirySession({auth: {
    getSession: async () => {refreshed++; throw new Error('Unexpected refresh');},
    signInWithPassword: async () => ({data: {session: {access_token: 'synthetic-expired', refresh_token: 'synthetic-private', expires_at: 1}}, error: null}),
    signOut: async () => ({error: null}),
  }}, value => {expiry = value;});
  assert.equal((await client.auth.getSession()).data.session, null);
  await client.auth.signInWithPassword({email: 'synthetic@example.test', password: 'synthetic'});
  assert.deepEqual((await client.auth.getSession()).data.session, {access_token: 'synthetic-expired', expires_at: 1});
  assert.equal(expiry, 1);
  assert.equal(refreshed, 0);
});

test('logout only revokes this local verification session and clears pinned credentials', async () => {
  let scope;
  const client = pinExpirySession({auth: {
    signInWithPassword: async () => ({data: {session: {access_token: 'synthetic', expires_at: 1}}, error: null}),
    signOut: async options => {scope = options.scope; return {error: null};},
  }});
  await client.auth.signInWithPassword({});
  await client.auth.signOut({scope: 'global'});
  assert.equal(scope, 'local');
  assert.equal((await client.auth.getSession()).data.session, null);
});

test('failed replacement login cannot reuse a prior verification token', async () => {
  let fail = false;
  const client = pinExpirySession({auth: {
    signInWithPassword: async () => fail ? {data: {session: null}, error: new Error('Synthetic failure')} : {data: {session: {access_token: 'synthetic', expires_at: 1}}, error: null},
    signOut: async () => ({error: null}),
  }});
  await client.auth.signInWithPassword({}); fail = true;
  assert.ok((await client.auth.signInWithPassword({})).error);
  assert.equal((await client.auth.getSession()).data.session, null);
});
