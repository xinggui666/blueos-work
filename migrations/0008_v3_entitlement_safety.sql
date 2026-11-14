-- Additive V3 safety migration. Existing snapshots keep known fields; unknown historical
-- fields freeze the current plan value ONCE at migration (cannot reconstruct history).
alter table memberships add column if not exists revoked_at timestamptz;
update memberships m set snapshot = jsonb_build_object(
  'projectLimit', coalesce(p.project_limit,20), 'concurrency', coalesce(p.concurrency,1),
  'priority',coalesce(p.priority,0), 'storageMb',coalesce(p.storage_mb,0),
  'dailyBuild',coalesce(p.daily_build,0)) || m.snapshot
from plans p where p.id = m.plan_id and
  (not (m.snapshot ? 'priority') or not (m.snapshot ? 'storageMb') or not (m.snapshot ? 'dailyBuild'));

create or replace view current_membership_entitlements as
select distinct on (user_id) m.*,
  case when snapshot->>'projectLimit' ~ '^[0-9]{1,7}$' then least((snapshot->>'projectLimit')::int,1000000) else 20 end as entitlement_project_limit,
  case when snapshot->>'concurrency' ~ '^[0-9]{1,2}$' then greatest(1,least((snapshot->>'concurrency')::int,8)) else 1 end as entitlement_concurrency,
  case when snapshot->>'priority' ~ '^[0-9]{1,2}$' then least((snapshot->>'priority')::int,9) else 0 end as entitlement_priority
from memberships m
where starts_at <= now() and now() < ends_at and revoked_at is null
order by user_id, ends_at desc, id;

create or replace function v3_immutable_entitlement_snapshot() returns trigger language plpgsql as $$
begin
  if new.snapshot is distinct from old.snapshot then
    raise exception 'entitlement snapshot is immutable';
  end if;
  return new;
end $$;
drop trigger if exists orders_immutable_snapshot on orders;
create trigger orders_immutable_snapshot before update on orders for each row execute function v3_immutable_entitlement_snapshot();
drop trigger if exists memberships_immutable_snapshot on memberships;
create trigger memberships_immutable_snapshot before update on memberships for each row execute function v3_immutable_entitlement_snapshot();
