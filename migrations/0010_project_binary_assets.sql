-- Additive: immutable owner-scoped PNG bytes. Roll back application first; retain table for revision/export recovery.
create table if not exists project_binary_assets (
 user_id text not null references "user"(id) on delete cascade,
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 bytes integer not null check (bytes > 0 and bytes <= 2097152),
 mime text not null check (mime = 'image/png'),
 data_base64 text not null check (octet_length(data_base64) <= 2796204),
 created_at timestamptz not null default now(),
 primary key (user_id, sha256)
);
create or replace function immutable_project_binary_asset() returns trigger language plpgsql as $$
begin raise exception 'project binary assets are immutable; upload a new digest'; end $$;
drop trigger if exists project_binary_assets_immutable on project_binary_assets;
create trigger project_binary_assets_immutable before update on project_binary_assets for each row execute function immutable_project_binary_asset();
