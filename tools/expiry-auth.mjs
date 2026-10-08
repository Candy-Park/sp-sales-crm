// Test-only adapter: retain a real access token in memory without refreshing it.
// It is never part of the normal CRM build, and exports no credential values.
export function pinExpirySession(client, onExpiry = () => {}) {
  let pinned = null;
  const signIn = client.auth.signInWithPassword.bind(client.auth);
  const signOut = client.auth.signOut.bind(client.auth);
  client.auth.getSession = async () => ({data: {session: pinned}, error: null});
  client.auth.signInWithPassword = async credentials => {
    pinned = null;
    const result = await signIn(credentials);
    if (!result.error && result.data?.session) {
      const session = result.data.session;
      pinned = {access_token: session.access_token, expires_at: session.expires_at};
      onExpiry(session.expires_at);
    }
    return result;
  };
  client.auth.signOut = async () => {
    pinned = null;
    return signOut({scope: 'local'});
  };
  return client;
}
