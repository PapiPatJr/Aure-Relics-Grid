-- Issue #10 Task 1 regression fix.
-- Use positional function parameters inside the nested fog_cells query so PostgreSQL
-- cannot resolve x/y/w/h as columns from the inner relation.

create or replace function private.sync_rect_exposed(l uuid,x integer,y integer,w integer,h integer) returns boolean
language sql stable set search_path='' as $$
  select exists(
    select 1
    from public.levels lv
    where lv.id=$1
      and $2>=0 and $3>=0 and $4>0 and $5>0
      and $2+$4<=lv.grid_width and $3+$5<=lv.grid_height
      and (
        not coalesce(private.fog_effective_enabled($1),true)
        or exists(
          select 1 from public.fog_cells f
          where f.level_id=$1 and f.is_revealed
            and f.x>=$2 and f.x<$2+$4
            and f.y>=$3 and f.y<$3+$5
        )
      )
  )
$$;

revoke all on function private.sync_rect_exposed(uuid,integer,integer,integer,integer)
from public,anon,authenticated;
