-- 管理后台（规格第十七章）。

-- 17.7 管理员重试构建：新任务记 retry_of，积分状态 waived（管理员免费重试，不预扣、不扣分）。
alter table build_tasks add column if not exists retry_of text;
alter table build_tasks add column if not exists retried_by text;
alter table build_tasks drop constraint if exists build_tasks_quota_state_check;
alter table build_tasks add constraint build_tasks_quota_state_check check (quota_state in ('none', 'reserved', 'committed', 'released', 'waived'));
-- 同一个原任务同时只能有一个进行中的重试（两个管理员同时点也只建一个）。
create unique index if not exists build_tasks_retry_active_idx on build_tasks (retry_of)
  where retry_of is not null and status in ('queued', 'waiting', 'running');

-- 17.3 组件：详细说明、SDK 兼容范围、依赖、资源文件。
alter table components add column if not exists description text not null default '';
alter table components add column if not exists sdk_min text not null default '';
alter table components add column if not exists sdk_max text not null default '';
alter table components add column if not exists dependencies jsonb not null default '[]';
alter table component_versions add column if not exists sdk_min text not null default '';
alter table component_versions add column if not exists active boolean not null default true;

create table if not exists component_assets (
  id text primary key,
  component_id text not null references components (id) on delete cascade,
  name text not null,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  bytes integer not null check (bytes > 0 and bytes <= 262144),
  sha256 text not null,
  data bytea not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists component_assets_component_idx on component_assets (component_id, created_at desc);

-- 17.8 APP 版本：灰度百分比、发布时间（未到时间不推送）。
alter table app_releases add column if not exists rollout_percent integer not null default 100 check (rollout_percent between 0 and 100);
alter table app_releases add column if not exists published_at timestamptz;

-- 17.9 系统开关补齐：卡密、工程下载、公告、维护模式。
insert into system_config (key, value) values
  ('keys_open', 'true'),
  ('export_enabled', 'true'),
  ('announcements_enabled', 'true'),
  ('maintenance_mode', 'false')
on conflict (key) do nothing;

-- 种子公告“目前只交付源工程”在阶段 4 之后已经不准确（服务器可以构建 RPK）。
-- 只修改仍是原始种子内容的那一条；运营改过的公告不动。
update announcements
set title = 'RPK 云端构建已上线',
    body = '交付面板可以发起 RPK 构建：预扣 1 个打包积分，编译成功并通过产物检查才扣除，失败或取消自动退回。生成的 RPK 尚未在真机上逐项验证。'
where id = 'ann_source' and title = '目前只交付源工程';
