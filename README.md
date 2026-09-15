# NFL Win Predictor

Straight-up NFL win probabilities. Model v2.0.0-phase2: Elo + opponent-adjusted EPA
+ QB adjustment + injuries + weather, blended 50/50 with the betting market.
Data: nflverse public releases + Open-Meteo. No API keys required.

## Repo layout (paths must be preserved)

```
index.html
netlify.toml
README.md
supabase-schema.sql          <- run 1st in Supabase SQL Editor
schema-phase2.sql            <- run 2nd in Supabase SQL Editor
netlify/
  functions/
    sync.mjs                 <- manual sync endpoint
    sync-scheduled.mjs       <- auto-sync every 6 hours
    lib/
      engine.mjs             <- prediction engine
```

## Deploy

1. **Supabase**: new project -> SQL Editor -> run `supabase-schema.sql`, then `schema-phase2.sql`.
2. **index.html**: set `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top of the script
   (Supabase -> Settings -> API: Project URL + anon public key).
3. **GitHub**: upload this whole folder (see below).
4. **Netlify**: Add new site -> Import from GitHub -> pick the repo -> Deploy
   (no build command needed). Then Site configuration -> Environment variables:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role secret key (Settings -> API)
   Redeploy after adding the variables.
5. Open the site -> press **Update data**. First sync takes ~10s and loads teams,
   the full season schedule, Elo ratings, this week's predictions, and the
   2015-2025 backtest. After that it refreshes itself every 6 hours.

## Uploading to GitHub from the browser

The `netlify/functions/lib/` nesting must survive. Two ways that work:

**Drag the folders (easiest, Chrome/Edge):** repo -> Add file -> Upload files ->
drag `index.html`, `netlify.toml`, `README.md`, both `.sql` files AND the whole
`netlify` folder from Finder into the drop zone. Dragging the folder keeps the
nested paths. Commit.

**Or create by path:** Add file -> Create new file -> type
`netlify/functions/lib/engine.mjs` as the name (each `/` creates a folder),
paste the file contents, commit. Repeat for `netlify/functions/sync.mjs` and
`netlify/functions/sync-scheduled.mjs`. Upload the root files normally.

## Notes

- Predictions lock at kickoff and are never rewritten.
- Backtest covers the Elo+market core only; v2 factors are tracked live, never retro-fitted.
- If a data source is down, its component contributes zero and shows "Data unavailable".
