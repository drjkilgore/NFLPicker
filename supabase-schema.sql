-- NFL Win Predictor — Phase 1 schema
-- Run once in Supabase SQL Editor.

create table if not exists teams (
  abbr text primary key,
  name text not null,
  conference text,
  division text,
  color text,
  color2 text,
  logo text
);

create table if not exists games (
  game_id text primary key,
  season int not null,
  week int not null,
  game_type text,
  gameday date,
  gametime text,
  weekday text,
  away text references teams(abbr),
  home text references teams(abbr),
  away_score int,
  home_score int,
  spread_line numeric,
  total_line numeric,
  away_moneyline numeric,
  home_moneyline numeric,
  away_rest int,
  home_rest int,
  roof text,
  stadium text,
  div_game boolean,
  away_qb text,
  home_qb text,
  completed boolean default false,
  kickoff timestamptz
);
create index if not exists games_season_week on games(season, week);

create table if not exists elo_ratings (
  team text primary key references teams(abbr),
  rating numeric not null,
  season int,
  wins int default 0,
  losses int default 0,
  ties int default 0,
  rank int,
  prev_rank int,
  updated_at timestamptz default now()
);

create table if not exists predictions (
  game_id text primary key references games(game_id),
  model_version text not null,
  away_elo numeric,
  home_elo numeric,
  home_prob_model numeric,   -- Elo-based probability, model only
  home_prob_market numeric,  -- de-vigged market implied probability (null if no line)
  home_prob numeric,         -- final blended probability used for the pick
  pick text,
  proj_home numeric,
  proj_away numeric,
  confidence text,           -- Very High / High / Moderate / Low / Toss-Up
  upset_flag boolean default false,
  factors jsonb,             -- top reasons, deterministic
  risks jsonb,               -- what could break the pick
  locked boolean default false,
  updated_at timestamptz default now()
);

create table if not exists prediction_snapshots (
  id bigint generated always as identity primary key,
  game_id text references games(game_id),
  home_prob numeric,
  pick text,
  model_version text,
  captured_at timestamptz default now()
);
create index if not exists snaps_game on prediction_snapshots(game_id);

create table if not exists model_performance (
  id text primary key,       -- 'season-2019' ... 'overall'
  season int,
  metrics jsonb not null,
  updated_at timestamptz default now()
);

-- Public read, writes only via service role (bypasses RLS).
alter table teams enable row level security;
alter table games enable row level security;
alter table elo_ratings enable row level security;
alter table predictions enable row level security;
alter table prediction_snapshots enable row level security;
alter table model_performance enable row level security;

create policy "public read teams" on teams for select using (true);
create policy "public read games" on games for select using (true);
create policy "public read elo" on elo_ratings for select using (true);
create policy "public read predictions" on predictions for select using (true);
create policy "public read snapshots" on prediction_snapshots for select using (true);
create policy "public read performance" on model_performance for select using (true);
