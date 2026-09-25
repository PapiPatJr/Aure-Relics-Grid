-- Issue #9 independent-review corrective pass.
--
-- Independent review found that the DM "Preview as Player" feature (Issue #9) rendered the DM's
-- own manager-shaped BoardView through the player-facing renderer with only `dm` nulled out. The
-- manager snapshot returned by private.session_projection legitimately contains hidden tokens,
-- fog-hidden tokens, unapproved characters and initiative entries tied to those hidden tokens (see
-- the `manager or (...)` conditions this migration touches below) — none of that is safe to render
-- as a generic public/player-facing preview, and a purely client-side filter cannot faithfully
-- reconstruct fog/approval state without duplicating (and risking drift from) this function.
--
-- This migration extends private.session_projection to stamp each token/character/initiative
-- entry with an authoritative `publicVisible` boolean, computed with the exact same predicates
-- this function already uses to decide whether a *non-manager* recipient may see that entry. A
-- manager's own snapshot already contains every entry regardless of this flag (unchanged); the
-- flag simply lets a manager-shaped BoardView be filtered, client-side, down to a truthful generic
-- public projection without re-deriving or approximating any authorization predicate. Real
-- (non-manager) recipient snapshots are unaffected in shape or authorization semantics: they
-- already only ever contained publicly-visible entries (plus the recipient's own character), so
-- `publicVisible` is simply always true for every token they receive and reflects the character's
-- actual public-approval state for characters (including their own, which may legitimately be
-- `false` while still present in their own recipient array via the existing own-character rule).
--
-- No RLS policy, grant, or authorization predicate is weakened or duplicated inconsistently: the
-- three predicates added below are copied verbatim from the existing WHERE clauses in this same
-- function.
create or replace function private.session_projection(p_session uuid,p_user uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare s public.sessions; manager boolean; own_id uuid; token_rows jsonb; cards jsonb; turns jsonb; dm_state jsonb;
begin
  select * into s from public.sessions where id=p_session;
  if s.id is null or p_user is null or not private.sync_can_read(p_session,p_user) then
    raise exception 'Session unavailable' using errcode='42501';
  end if;
  manager:=private.sync_can_manage(s.campaign_id,p_user);
  select p.character_id into own_id from public.session_players p
    join public.campaign_members m on m.campaign_id=p.campaign_id and m.user_id=p.user_id
    where p.session_id=s.id and p.user_id=p_user and p.status='approved' and m.status='approved'
      and s.status in ('lobby','active');
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'levelId',t.level_id,'characterId',t.character_id,
    'kind',t.kind,'label',t.label,'conditionLabel',t.condition_label,'x',t.x,'y',t.y,
    'width',t.width,'height',t.height,'isVisible',t.is_visible,
    'publicVisible',(s.status='active' and t.is_visible and private.sync_rect_visible(t.level_id,t.x,t.y,t.width,t.height)))
    order by t.id),'[]'::jsonb) into token_rows
    from public.tokens t where t.campaign_id=s.campaign_id and t.level_id=s.active_level_id
      and (manager or (s.status='active' and t.is_visible and private.sync_rect_visible(t.level_id,t.x,t.y,t.width,t.height)));
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'playerName',c.player_name,
    'approved',c.approved,'hp',c.hp,'maxHp',c.max_hp,'tempHp',c.temp_hp,'ac',c.ac,'speed',c.speed,
    'statuses',c.statuses,'publicNotes',c.public_notes,'imagePath',c.image_path,'updatedAt',c.updated_at,
    'publicVisible',exists(select 1 from public.session_players p2 join public.campaign_members m2
      on m2.campaign_id=p2.campaign_id and m2.user_id=p2.user_id
      where p2.session_id=s.id and p2.character_id=c.id and c.approved and p2.status='approved' and m2.status='approved'))
    order by c.id),'[]'::jsonb) into cards from public.characters c where c.campaign_id=s.campaign_id
    and (c.id=own_id or exists(select 1 from public.session_players p join public.campaign_members m
      on m.campaign_id=p.campaign_id and m.user_id=p.user_id where p.session_id=s.id and p.character_id=c.id
      and (manager or (c.approved and p.status='approved' and m.status='approved'))));
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'tokenId',i.token_id,'initiative',i.initiative,
    'position',i.position,'isActive',i.is_active,
    'publicVisible',coalesce((select (t->>'publicVisible')::boolean from jsonb_array_elements(token_rows) t
      where t->>'id'=i.token_id::text),false))
    order by i.position,i.id),'[]'::jsonb) into turns
    from public.initiative_entries i where i.session_id=s.id and i.campaign_id=s.campaign_id
    and exists(select 1 from jsonb_array_elements(token_rows) t where t->>'id'=i.token_id::text);
  if manager then
    select jsonb_build_object('tokenDetails',coalesce((select jsonb_agg(jsonb_build_object(
      'tokenId',d.token_id,'actualHp',d.actual_hp,'maxHp',d.max_hp,'dmNotes',d.dm_notes) order by d.token_id)
      from private.token_details d join public.tokens t on t.id=d.token_id
      where d.campaign_id=s.campaign_id and t.level_id=s.active_level_id),'[]'::jsonb),
      'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'subject',n.subject,'body',n.body) order by n.id)
        from private.dm_notes n where n.campaign_id=s.campaign_id),'[]'::jsonb),
      'activity',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'eventType',a.event_type,
        'actorId',a.actor_id,'createdAt',a.created_at) order by a.created_at desc,a.id)
        from (select id,event_type,actor_id,created_at from private.activity_feed
          where campaign_id=s.campaign_id and session_id=s.id order by created_at desc,id limit 50) a),'[]'::jsonb)) into dm_state;
  end if;
  return jsonb_build_object('schemaVersion',1,'sessionId',s.id,'campaignId',s.campaign_id,
    'authority',jsonb_build_object('canManage',manager,'ownCharacterId',own_id),
    'session',jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'activeLevelId',s.active_level_id),
    'roundNumber',coalesce((select round_number from public.session_state where session_id=s.id),1),
    'tokens',token_rows,'characters',cards,'initiative',turns,'dm',dm_state);
end $$;

-- private.session_projection's output shape just changed for every recipient (new `publicVisible`
-- field on token/character/initiative entries). private.get_session_snapshot always recomputes the
-- projection fresh on every call (it never reads the cached private.session_sync.projection column
-- for the returned body), so any hydrate() from this point on already receives the new field with
-- no client reconnect required. However, private.session_sync.projection is also the change-
-- detection baseline private.refresh_session_sync diffs against to decide whether to bump a
-- recipient's revision and emit a session_events row; leaving it on the pre-migration shape until
-- the next unrelated data change would not cause incorrect data (get_session_snapshot is always
-- fresh) but would leave already-connected clients' realtime invalidation watermark referencing a
-- stale projection body. Force every recipient's cached projection/revision to the new shape now,
-- exactly the way this same migration file's predecessor bootstrapped clocks before publishing
-- session_events for the first time.
do $$ declare c record; begin
  for c in select id from public.campaigns order by id loop perform private.refresh_session_sync(c.id); end loop;
end $$;
