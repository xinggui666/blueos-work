-- Existing memberships were credited eagerly: never silently regrant or claw back history.
alter table memberships add column credits_state text not null default 'applied'
  check (credits_state in ('pending','applied','revoked'));
alter table memberships add column credits_applied_at timestamptz;
create index memberships_pending_credits on memberships(starts_at,user_id)
  where credits_state = 'pending' and revoked_at is null;

-- One shared, transaction-atomic policy for API, operator scheduler and Worker.
-- Credits become due at starts_at, are non-expiring one-time credits, and catch up
-- after downtime. monthlyBuild/dailyBuild are NOT implemented periodic awards.
create or replace function activate_membership_credits(p_user_id text default null)
returns integer language plpgsql as $$
declare m record; k text; raw_amount text; amount integer; awards jsonb; activated integer := 0;
begin
  for m in select * from memberships
    where credits_state='pending' and revoked_at is null and starts_at <= now()
      and (p_user_id is null or user_id=p_user_id)
    order by user_id,id limit 500 for update
  loop
    -- Recheck after a competing activation/refund acquired the row first.
    if m.credits_state <> 'pending' or m.revoked_at is not null then continue; end if;
    awards := jsonb_build_object('generation',m.snapshot->>'generation',
      'export',m.snapshot->>'export','build',m.snapshot->>'build');
    for k in select jsonb_object_keys(awards) order by 1 loop
      raw_amount := awards->>k;
      if raw_amount is null or raw_amount !~ '^[0-9]{1,7}$' then
        raise exception 'invalid membership credit snapshot';
      end if;
      amount := least(raw_amount::integer,1000000);
      if k='build' then
        raw_amount := coalesce(m.snapshot->>'bonusBuild','0');
        if raw_amount !~ '^[0-9]{1,7}$' then raise exception 'invalid membership bonus snapshot'; end if;
        amount := amount + least(raw_amount::integer,1000000);
      end if;
      if amount > 0 then
        insert into quota_accounts(user_id,kind,balance,reserved) values(m.user_id,k,0,0)
          on conflict(user_id,kind) do nothing;
        update quota_accounts set balance=balance+amount where user_id=m.user_id and kind=k;
        insert into quota_ledger(id,user_id,kind,delta,phase,ref,note)
          values('activation:'||m.id||':'||k,m.user_id,k,amount,'grant',m.source,'会员段生效：一次性额度（不含周期额度）');
      end if;
    end loop;
    update memberships set credits_state='applied',credits_applied_at=now() where id=m.id;
    activated := activated+1;
  end loop;
  return activated;
end $$;
