-- Run this in the Supabase SQL editor to set up the analyses table + RLS

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz default now(),
  club text not null,
  camera_angle text not null,
  overall_score integer not null,
  overall_grade text not null,
  summary text not null,
  positions jsonb not null,
  priority_fix jsonb not null,
  drills jsonb not null,
  frame_paths text[] not null default '{}'
);

alter table public.analyses enable row level security;

create policy "Users can only access their own analyses"
  on public.analyses
  for all
  using (auth.uid() = user_id);

-- Storage bucket: run these in the SQL editor OR via the Supabase dashboard
-- insert into storage.buckets (id, name, public) values ('swing-frames', 'swing-frames', false);

-- create policy "Users can upload their own frames"
--   on storage.objects for insert
--   with check (bucket_id = 'swing-frames' and auth.uid()::text = (storage.foldername(name))[1]);

-- create policy "Users can read their own frames"
--   on storage.objects for select
--   using (bucket_id = 'swing-frames' and auth.uid()::text = (storage.foldername(name))[1]);
