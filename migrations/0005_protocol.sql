-- 统一工程协议 v2：工程主体以协议文档保存，每次内容变化形成不可变服务端修订。
alter table projects add column if not exists schema_version integer not null default 1;
alter table projects add column if not exists revision integer not null default 0;
alter table projects add column if not exists content_sha256 text;

alter table project_revisions add column if not exists doc jsonb;
alter table project_revisions add column if not exists schema_version integer;
alter table project_revisions add column if not exists content_sha256 text;
alter table project_revisions add column if not exists source text not null default 'client';
alter table project_revisions add column if not exists client text;
create index if not exists project_revisions_project_idx on project_revisions (project_id, rev desc);

-- 构建/生成任务固定引用的工程修订。
alter table jobs add column if not exists project_revision integer;

-- 重复导入判断：同一账号导入同一内容只建一个工程。
create table if not exists project_imports (
  user_id text not null,
  content_sha256 text not null,
  project_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, content_sha256)
);
