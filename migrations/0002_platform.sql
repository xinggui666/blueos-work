-- BlueOS workshop: projects, marketplace, membership, license keys, jobs, admin audit.
-- Quota ledger rows are append-only in application code. Do not add a delete path.

create table if not exists profiles (
  user_id text primary key,
  display_name text not null default '',
  status text not null default 'active' check (status in ('active', 'banned')),
  developer_status text not null default 'none' check (developer_status in ('none', 'pending', 'approved', 'suspended')),
  created_at timestamptz not null default now()
);

create table if not exists user_roles (
  user_id text not null,
  role text not null check (role in ('reviewer', 'operator', 'admin', 'super_admin')),
  primary key (user_id, role)
);

create table if not exists projects (
  id text primary key,
  user_id text not null,
  name text not null,
  app_name text not null,
  package_name text not null,
  device text not null,
  body jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists projects_user_idx on projects (user_id, updated_at desc);

create table if not exists project_revisions (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  user_id text not null,
  rev integer not null,
  note text not null default '',
  snapshot text not null,
  created_at timestamptz not null default now(),
  unique (project_id, rev)
);

create table if not exists components (
  id text primary key,
  slug text not null unique,
  name text not null,
  category text not null,
  summary text not null,
  author_name text not null,
  access text not null check (access in ('public_free', 'membership', 'license_key', 'specific_user', 'internal', 'disabled')),
  min_plan text not null default '',
  status text not null check (status in ('published', 'unpublished')),
  latest_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists component_versions (
  id text primary key,
  component_id text not null references components (id) on delete cascade,
  version text not null,
  changelog text not null default '',
  created_at timestamptz not null default now(),
  unique (component_id, version)
);

create table if not exists component_grants (
  user_id text not null,
  component_id text not null references components (id) on delete cascade,
  source text not null,
  expires_at timestamptz,
  primary key (user_id, component_id)
);

create table if not exists component_installs (
  user_id text not null,
  component_id text not null references components (id) on delete cascade,
  version text not null,
  installed_at timestamptz not null default now(),
  primary key (user_id, component_id)
);

create table if not exists submissions (
  id text primary key,
  user_id text not null,
  name text not null,
  slug text not null,
  category text not null,
  summary text not null,
  version text not null,
  schema jsonb not null,
  status text not null check (status in ('pending', 'changes', 'approved', 'rejected')),
  review_note text not null default '',
  checks jsonb not null,
  reviewer_id text,
  created_at timestamptz not null default now()
);

create table if not exists plans (
  id text primary key,
  slug text not null unique,
  name text not null,
  price_cents integer not null,
  duration_days integer not null,
  generation integer not null,
  build_quota integer not null,
  export_quota integer not null,
  concurrency integer not null,
  active boolean not null default true
);

create table if not exists memberships (
  id text primary key,
  user_id text not null,
  plan_id text not null,
  snapshot jsonb not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source text not null,
  created_at timestamptz not null default now()
);
create index if not exists memberships_user_idx on memberships (user_id, ends_at desc);

create table if not exists quota_accounts (
  user_id text not null,
  kind text not null check (kind in ('generation', 'build', 'export')),
  balance integer not null default 0,
  reserved integer not null default 0,
  primary key (user_id, kind)
);

create table if not exists quota_ledger (
  id text primary key,
  user_id text not null,
  kind text not null,
  delta integer not null,
  phase text not null check (phase in ('grant', 'reserve', 'commit', 'release', 'adjust')),
  ref text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists quota_ledger_user_idx on quota_ledger (user_id, created_at desc);

create table if not exists license_batches (
  id text primary key,
  type text not null check (type in ('membership', 'quota', 'component', 'custom')),
  title text not null,
  payload jsonb not null,
  quantity integer not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists license_keys (
  id text primary key,
  batch_id text not null references license_batches (id),
  code_hash text not null unique,
  hint text not null,
  type text not null check (type in ('membership', 'quota', 'component', 'custom')),
  payload jsonb not null,
  status text not null check (status in ('unused', 'used', 'frozen', 'void', 'expired')),
  expires_at timestamptz,
  used_by text,
  used_at timestamptz
);
create index if not exists license_keys_batch_idx on license_keys (batch_id);

create table if not exists license_activations (
  id text primary key,
  key_id text not null,
  user_id text not null,
  result text not null,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id text primary key,
  user_id text not null,
  plan_id text not null,
  status text not null check (status in ('pending', 'confirmed', 'cancelled')),
  amount_cents integer not null,
  snapshot jsonb not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id text primary key,
  user_id text not null,
  project_id text not null,
  kind text not null check (kind in ('generation', 'build', 'export')),
  status text not null check (status in ('succeeded', 'failed', 'unavailable')),
  idempotency_key text not null,
  message text not null default '',
  file_name text,
  sha256 text,
  artifact text,
  bytes integer,
  exported boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists jobs_user_idx on jobs (user_id, created_at desc);

create table if not exists announcements (
  id text primary key,
  title text not null,
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists system_config (
  key text primary key,
  value text not null
);

create table if not exists audit_logs (
  id text primary key,
  actor_id text not null,
  action text not null,
  target text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on audit_logs (created_at desc);

insert into system_config (key, value) values
  ('registration_open', 'true'),
  ('marketplace_open', 'true'),
  ('submissions_open', 'true'),
  ('auto_publish', 'false'),
  ('generation_enabled', 'true'),
  ('build_enabled', 'false')
on conflict (key) do nothing;

insert into plans (id, slug, name, price_cents, duration_days, generation, build_quota, export_quota, concurrency, active) values
  ('plan_member', 'member', '工坊会员', 4900, 30, 80, 0, 40, 2, true),
  ('plan_studio', 'studio', '工作室', 12900, 90, 300, 0, 150, 4, true)
on conflict (id) do nothing;

insert into components (id, slug, name, category, summary, author_name, access, min_plan, status, latest_version) values
  ('cmp_text', 'text', '文本', '基础', '官方 text。所有用户可用。', '蓝河工坊', 'public_free', '', 'published', '1.0.0'),
  ('cmp_image', 'image', '图片', '基础', '官方 image。地址由你自己提供。', '蓝河工坊', 'public_free', '', 'published', '1.0.0'),
  ('cmp_button', 'button', '按钮', '基础', '官方 input type=button。', '蓝河工坊', 'public_free', '', 'published', '1.0.0'),
  ('cmp_column', 'column', '纵向布局', '布局', '编辑器里的纵向容器。生成时仍按绝对坐标输出。', '蓝河工坊', 'public_free', '', 'published', '1.0.0'),
  ('cmp_row', 'row', '横向布局', '布局', '编辑器里的横向容器。生成时仍按绝对坐标输出。', '蓝河工坊', 'public_free', '', 'published', '1.0.0'),
  ('cmp_spacer', 'spacer', '间距', '布局', '空白间距。', '蓝河工坊', 'public_free', '', 'published', '1.0.0'),
  ('cmp_divider', 'divider', '分隔线', '布局', '分隔线。', '蓝河工坊', 'public_free', '', 'published', '1.0.0'),
  ('cmp_rect', 'rect', '矩形', '图形', '矩形色块。', '蓝河工坊', 'public_free', '', 'published', '1.0.0'),
  ('cmp_circle', 'circle', '圆形', '图形', '圆形。', '蓝河工坊', 'public_free', '', 'published', '1.0.0'),
  ('cmp_progress', 'progress', '进度', '数据', '进度条。', '蓝河工坊', 'public_free', '', 'published', '1.0.0'),
  ('cmp_switch', 'switch', '开关', '交互', '开关。', '蓝河工坊', 'public_free', '', 'published', '1.0.0'),
  ('cmp_number', 'number', '数字', '数据', '映射成文本。需要有效会员。', '蓝河工坊', 'membership', 'member', 'published', '1.0.0'),
  ('cmp_time', 'time', '时间', '数据', '映射成文本。需要有效会员。', '蓝河工坊', 'membership', 'member', 'published', '1.0.0'),
  ('cmp_hotspot', 'hotspot', '热区', '交互', '点击热区。需要组件卡密或指定授权。', '蓝河工坊', 'license_key', '', 'published', '1.0.0')
on conflict (id) do nothing;

insert into component_versions (id, component_id, version, changelog)
select 'ver_' || slug, id, '1.0.0', '官方目录初版。不是新的 BlueOS 标签。'
from components
on conflict (id) do nothing;

insert into announcements (id, title, body, active) values
  ('ann_source', '目前只交付源工程', '生成结果是 source_zip，可以交给 BlueOS Studio。这里没有跑官方编译器，构建任务不会被记成成功。', true)
on conflict (id) do nothing;
