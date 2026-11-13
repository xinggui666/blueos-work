create table if not exists client_devices (
  id text primary key,
  user_id text not null,
  client text not null check (client in ('web', 'android', 'desktop')),
  label text not null default '',
  last_seen timestamptz not null default now()
);

create index if not exists client_devices_user_idx on client_devices (user_id, last_seen desc);

alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (status in ('pending', 'confirmed', 'cancelled', 'refunded'));
