const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const credential = new RegExp(`^(${uuid})\\.(${uuid})\\.([0-9a-f]{64})$`, 'i');

export function parseJoinCode(value) {
  let raw = String(value).trim();
  if (/^https?:\/\//i.test(raw)) {
    try { raw = new URL(raw).hash.replace(/^#join\//, ''); } catch { /* reject below */ }
  }
  const match = credential.exec(raw);
  if (!match) throw new Error('Paste the complete join code or join link shared by your DM.');
  return { campaign: match[1].toLowerCase(), session: match[2].toLowerCase(), secret: match[3].toLowerCase() };
}
export function formatJoinCode(campaign, session, secret) {
  const value = `${campaign}.${session}.${secret}`;
  parseJoinCode(value);
  return value;
}
export function joinLink(origin, code) {
  parseJoinCode(code);
  const url = new URL(origin);
  url.search = '';
  url.hash = `join/${code}`;
  return url.href;
}
export const isDm = user => Boolean(user?.id && user.is_anonymous === false);
const result = response => {
  if (response.error) throw new Error(response.error.message);
  return response.data;
};
const name = value => {
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.length > 80) throw new Error('Use a name between 1 and 80 characters.');
  return trimmed;
};

/** All calls use the current user's client. The database enforces final authority. */
export function createEntryService(client) {
  const rpc = async (fn, args) => result(await client.rpc(fn, args));
  const user = async () => {
    const response = await client.auth.getUser();
    if (response.error?.name === 'AuthSessionMissingError') return null;
    return result(response)?.user ?? null;
  };
  const dm = async () => {
    const current = await user();
    if (!isDm(current)) throw new Error('Sign in with a DM account to continue.');
    return current;
  };
  return {
    user,
    register: async (email, password) => result(await client.auth.signUp({ email: email.trim(), password })),
    login: async (email, password) => result(await client.auth.signInWithPassword({ email: email.trim(), password })),
    logout: async () => result(await client.auth.signOut({ scope: 'local' })),
    async campaigns() {
      const current = await dm();
      return result(await client.from('campaigns').select('id,name,owner_id').eq('owner_id', current.id).order('created_at'));
    },
    async campaign(id) {
      const current = await dm();
      return result(await client.from('campaigns').select('id,name,owner_id').eq('id', id).eq('owner_id', current.id).single());
    },
    async createCampaign(value) {
      const current = await dm();
      return result(await client.from('campaigns').insert({ name: name(value), owner_id: current.id }).select('id,name,owner_id').single());
    },
    async sessions(campaign) {
      await dm();
      return result(await client.from('sessions').select('id,campaign_id,name,status').eq('campaign_id', campaign).order('name'));
    },
    async session(id) {
      await dm();
      return result(await client.from('sessions').select('id,campaign_id,name,status').eq('id', id).single());
    },
    async createSession(campaign, value) {
      await dm();
      return result(await client.from('sessions').insert({ campaign_id: campaign, name: name(value), status: 'lobby' }).select('id,campaign_id,name,status').single());
    },
    issueCode: session => rpc('issue_session_code', { p_session: session }),
    revokeCode: session => rpc('revoke_session_code', { p_session: session }),
    async join(value, displayName) {
      const code = parseJoinCode(value);
      const display = name(displayName);
      let current = await user();
      if (isDm(current)) throw new Error('Use a separate browser profile to join as a player, or sign out of your DM account first.');
      if (!current) current = result(await client.auth.signInAnonymously()).user;
      if (!current?.is_anonymous) throw new Error('An anonymous player identity is required.');
      await rpc('request_session_join', { p_campaign: code.campaign, p_session: code.session, p_code: code.secret, p_display_name: display });
      return code.session;
    },
    review: (session, user, action) => rpc('review_session_guest', { p_session: session, p_user: user, p_action: action }),
    lobby: session => rpc('get_guest_lobby', { p_session: session }),
    roster: session => rpc('get_session_roster', { p_session: session })
  };
}
