-- NFL Win Predictor — Phase 2 schema additions
-- Run once in Supabase SQL Editor (after the Phase 1 schema).

alter table predictions add column if not exists breakdown jsonb;

create table if not exists team_form (
  team text primary key references teams(abbr),
  season int,
  off_epa numeric,   -- opponent-adjusted offensive EPA/play (recency-weighted)
  def_epa numeric,   -- opponent-adjusted EPA/play allowed (lower is better)
  net_epa numeric,
  updated_at timestamptz default now()
);

create table if not exists qb_values (
  qb_name text primary key,
  team text,
  value numeric,     -- shrunken EPA per dropback, prior season discounted
  dropbacks int,
  is_primary boolean default false,
  updated_at timestamptz default now()
);

create table if not exists game_conditions (
  game_id text primary key references games(game_id),
  temp_f int,
  wind_mph int,
  precip_pct int,
  summary text,
  fetched_at timestamptz default now()
);

alter table team_form enable row level security;
alter table qb_values enable row level security;
alter table game_conditions enable row level security;

create policy "public read team_form" on team_form for select using (true);
create policy "public read qb_values" on qb_values for select using (true);
create policy "public read game_conditions" on game_conditions for select using (true);
