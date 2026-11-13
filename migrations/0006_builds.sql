-- RPK 构建引擎（规格第十三章）：构建任务、Worker 心跳。
-- 状态：queued 待排队（超出并发，等前面的任务）、waiting 等待执行、running 执行中、
--       succeeded 成功、failed 失败、cancelled 已取消、unavailable 不可用（没有启用或没有在线 Worker，不扣分）。
create table if not exists build_tasks (
  id text primary key,
  user_id text not null,
  project_id text not null,
  revision integer not null,
  content_sha256 text not null,
  status text not null check (status in ('queued', 'waiting', 'running', 'succeeded', 'failed', 'cancelled', 'unavailable')),
  mode text not null check (mode in ('debug', 'release')),
  package_name text not null,
  version_name text not null,
  version_code integer not null,
  routes jsonb not null default '[]',
  generator text not null,
  runtime_sha256 text not null default '',
  components jsonb not null default '[]',
  source_sha256 text not null default '',
  source_zip bytea,
  -- 积分状态：none 没有预扣、reserved 已预扣、committed 已确认、released 已释放。
  quota_state text not null default 'none' check (quota_state in ('none', 'reserved', 'committed', 'released')),
  priority integer not null default 0,
  worker_id text,
  toolkit text not null default '',
  environment jsonb not null default '{}',
  heartbeat_at timestamptz,
  cancel_requested boolean not null default false,
  log text not null default '',
  error text not null default '',
  artifact bytea,
  artifact_name text,
  artifact_sha256 text,
  artifact_bytes integer,
  verify jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists build_tasks_queue_idx on build_tasks (status, priority desc, created_at);
create index if not exists build_tasks_user_idx on build_tasks (user_id, created_at desc);
create index if not exists build_tasks_project_idx on build_tasks (project_id, revision);

create table if not exists build_workers (
  id text primary key,
  host text not null default '',
  toolkit text not null default '',
  sandbox text not null default '',
  signing boolean not null default false,
  started_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
