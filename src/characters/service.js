const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const codePattern = new RegExp(`^(${uuid})[.](${uuid})[.]([0-9a-f]{64})$`);
export function parseCharacterCode(value, campaign) {
  const match = codePattern.exec(String(value).trim());
  if (!match || match[1] !== campaign) throw new Error('Use a complete character code for this campaign.');
  return { character: match[2], secret: match[3] };
}
export function characterFields(values) {
  const result = {};
  for (const key of ['name', 'player_name']) {
    const value = String(values[key] ?? '').trim();
    if (!value || value.length > 80) throw new Error('Character and player names must be 1–80 characters.');
    result[`p_${key}`] = value;
  }
  for (const [key, min, max] of [['hp', -999, 9999], ['max_hp', 0, 9999], ['temp_hp', 0, 9999], ['ac', 0, 99], ['speed', 0, 999]]) {
    const value = Number(values[key]);
    if (String(values[key] ?? '').trim() === '' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Check ${key.replaceAll('_', ' ')} (${min}–${max}).`);
    result[`p_${key}`] = value;
  }
  const statuses = String(values.statuses ?? '').trim();
  result.p_statuses = statuses ? statuses.split(',').map(s => s.trim()) : [];
  if (result.p_statuses.length > 20 || result.p_statuses.some(s => !s || s.length > 60)) throw new Error('Use up to 20 comma-separated statuses, each 1–60 characters.');
  result.p_notes = String(values.notes ?? '');
  if (result.p_notes.length > 2000) throw new Error('Shared notes must be 2000 characters or fewer.');
  return result;
}
export function validatePortrait(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP image up to 5 MiB.');
}
export function createCharacterService(client) {
  const rpc = async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    panel: session => rpc('get_character_panel', { p_session: session }),
    create: (session, fields) => rpc('create_session_character', { p_session: session, ...characterFields(fields) }),
    update: (session, character, fields) => rpc('update_session_character', { p_session: session, p_character: character, ...characterFields(fields) }),
    review: (character, approved) => rpc('review_character', { p_character: character, p_approved: approved }),
    issue: async (campaign, character) => `${campaign}.${character}.${await rpc('issue_character_code', { p_character: character })}`,
    revoke: character => rpc('revoke_character_code', { p_character: character }),
    assign: (session, character, user) => rpc('assign_character', { p_session: session, p_character: character, p_user: user }),
    reclaim: async (session, campaign, code) => {
      const { character, secret } = parseCharacterCode(code, campaign);
      await rpc('reclaim_character', { p_session: session, p_character: character, p_code: secret });
    },
    async upload(session, campaign, character, file, replace = false) {
      validatePortrait(file);
      const bucket = client.storage.from('character-images');
      const path = `${campaign}/${character}/portrait.png`;
      const { error } = await bucket[replace ? 'update' : 'upload'](path, file, { contentType: file.type, cacheControl: '0', upsert: false });
      if (error) throw new Error(error.message);
      await rpc('set_character_image', { p_session: session, p_character: character });
    },
    // Retry linking after a successful upload whose subsequent RPC lost connection.
    linkImage: (session, character) => rpc('set_character_image', { p_session: session, p_character: character }),
    async portrait(path, version) {
      const { data, error } = await client.storage.from('character-images').download(path, { cacheNonce: version }, { cache: 'no-store' });
      if (error) throw new Error('Portrait unavailable. Check access and try again.');
      return data;
    },
  };
}
