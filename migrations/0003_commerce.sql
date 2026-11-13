-- Commercial rules: dynamic plan benefits, component codes, client release records.
-- Editing stays free. New accounts are not granted pack quota.

alter table plans add column if not exists daily_build integer not null default 0;
alter table plans add column if not exists monthly_build integer not null default 0;
alter table plans add column if not exists bonus_build integer not null default 0;
alter table plans add column if not exists project_limit integer not null default 20;
alter table plans add column if not exists storage_mb integer not null default 200;
alter table plans add column if not exists priority integer not null default 0;
alter table plans add column if not exists categories text not null default '';

alter table components add column if not exists code text not null default '';

update components set code = case slug
  when 'text' then 'MB001'
  when 'image' then 'MB002'
  when 'button' then 'MB003'
  when 'column' then 'MB004'
  when 'row' then 'MB005'
  when 'spacer' then 'MB006'
  when 'divider' then 'MB007'
  when 'rect' then 'MB008'
  when 'circle' then 'MB009'
  when 'progress' then 'MB010'
  when 'switch' then 'MB011'
  when 'number' then 'MB012'
  when 'time' then 'MB013'
  when 'hotspot' then 'MB014'
  else code
end
where code = '';

create unique index if not exists components_code_idx on components (code) where code <> '';

update plans set project_limit = 20, storage_mb = 200, monthly_build = 0 where id = 'plan_member';
update plans set project_limit = 100, storage_mb = 1000, priority = 2 where id = 'plan_studio';

insert into plans (
  id, slug, name, price_cents, duration_days, generation, build_quota, export_quota, concurrency, active,
  daily_build, monthly_build, bonus_build, project_limit, storage_mb, priority, categories
) values
  ('plan_basic', 'basic', '普通会员', 2900, 30, 10, 0, 5, 1, true, 0, 0, 0, 20, 200, 1, '基础'),
  ('plan_pro', 'pro', '专业会员', 19900, 30, 200, 0, 80, 4, true, 0, 0, 0, 0, 2000, 3, '')
on conflict (id) do nothing;

create table if not exists app_releases (
  id text primary key,
  channel text not null default 'stable' check (channel in ('stable', 'beta')),
  version_name text not null,
  version_code integer not null,
  min_version_code integer not null default 1,
  force_update boolean not null default false,
  notes text not null default '',
  apk_url text not null default '',
  sha256 text not null default '',
  size_bytes integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into system_config (key, value) values
  ('membership_open', 'true')
on conflict (key) do nothing;
