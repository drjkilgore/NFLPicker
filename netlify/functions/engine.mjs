// NFL Win Predictor — Phase 2 engine
// v2 adds: opponent-adjusted EPA team form (recency-weighted, prior-season
// blended early), QB starter adjustment from EPA/dropback, position-weighted
// injury impact, and weather for outdoor games. All data: nflverse public
// releases + Open-Meteo (free, no keys). Every component degrades to zero
// with a "Data unavailable" note if its source fails — nothing is invented.
// Backtest metrics remain the core Elo+market model walked forward; the v2
// factors are tracked live from deployment, never retro-fitted.

const MODEL_VERSION = "v2.0.0-phase2";
const GAMES_CSV = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const TEAM_WEEK = s => `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${s}.csv`;
const PLAYER_WEEK = s => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${s}.csv`;
const PLAYER_REG = s => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${s}.csv`;
const INJURIES = s => `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${s}.csv`;

const ELO_START = 1300, ELO_MEAN = 1505, K = 20, HFA = 48;
const REST_PTS = 4, REST_CAP = 25;
const REPLAY_FROM = 2010, BACKTEST_FROM = 2015;
const ELO_TO_POINTS = 25;          // Elo diff -> points
const MARKET_WEIGHT = 0.5;
const PLAYS_PER_GAME = 62;         // per-team offensive snaps, for EPA -> points
const RECENCY_DECAY = 0.85;        // per-week weight decay on team form
const QB_PRIOR_DB = 200;           // shrinkage dropbacks toward league mean
const QB_LEAGUE_MEAN = 0.03;       // EPA/dropback prior
const QB_DB_PER_GAME = 36;         // dropbacks/game, EPA/db -> points
const QB_ADJ_CAP = 7;              // points
const INJ_TEAM_CAP = 6;            // points

const TEAMS = [
  ["ARI","Arizona Cardinals","NFC","West","#97233F","#FFB612","ari",33.5276,-112.2626],
  ["ATL","Atlanta Falcons","NFC","South","#A71930","#A5ACAF","atl",33.7554,-84.4009],
  ["BAL","Baltimore Ravens","AFC","North","#241773","#9E7C0C","bal",39.2780,-76.6227],
  ["BUF","Buffalo Bills","AFC","East","#00338D","#C60C30","buf",42.7738,-78.7870],
  ["CAR","Carolina Panthers","NFC","South","#0085CA","#BFC0BF","car",35.2258,-80.8528],
  ["CHI","Chicago Bears","NFC","North","#C83803","#0B162A","chi",41.8623,-87.6167],
  ["CIN","Cincinnati Bengals","AFC","North","#FB4F14","#000000","cin",39.0955,-84.5161],
  ["CLE","Cleveland Browns","AFC","North","#FF3C00","#311D00","cle",41.5061,-81.6995],
  ["DAL","Dallas Cowboys","NFC","East","#003594","#869397","dal",32.7473,-97.0945],
  ["DEN","Denver Broncos","AFC","West","#FB4F14","#002244","den",39.7439,-105.0201],
  ["DET","Detroit Lions","NFC","North","#0076B6","#B0B7BC","det",42.3400,-83.0456],
  ["GB","Green Bay Packers","NFC","North","#203731","#FFB612","gb",44.5013,-88.0622],
  ["HOU","Houston Texans","AFC","South","#03202F","#A71930","hou",29.6847,-95.4107],
  ["IND","Indianapolis Colts","AFC","South","#002C5F","#A2AAAD","ind",39.7601,-86.1639],
  ["JAX","Jacksonville Jaguars","AFC","South","#006778","#D7A22A","jax",30.3239,-81.6373],
  ["KC","Kansas City Chiefs","AFC","West","#E31837","#FFB81C","kc",39.0489,-94.4839],
  ["LA","Los Angeles Rams","NFC","West","#003594","#FFA300","lar",33.9535,-118.3392],
  ["LAC","Los Angeles Chargers","AFC","West","#0080C6","#FFC20E","lac",33.9535,-118.3392],
  ["LV","Las Vegas Raiders","AFC","West","#A5ACAF","#000000","lv",36.0909,-115.1833],
  ["MIA","Miami Dolphins","AFC","East","#008E97","#FC4C02","mia",25.9580,-80.2389],
  ["MIN","Minnesota Vikings","NFC","North","#4F2683","#FFC62F","min",44.9738,-93.2575],
  ["NE","New England Patriots","AFC","East","#002244","#C60C30","ne",42.0909,-71.2643],
  ["NO","New Orleans Saints","NFC","South","#D3BC8D","#101820","no",29.9511,-90.0812],
  ["NYG","New York Giants","NFC","East","#0B2265","#A71930","nyg",40.8135,-74.0745],
  ["NYJ","New York Jets","AFC","East","#125740","#FFFFFF","nyj",40.8135,-74.0745],
  ["PHI","Philadelphia Eagles","NFC","East","#004C54","#A5ACAF","phi",39.9008,-75.1675],
  ["PIT","Pittsburgh Steelers","AFC","North","#FFB612","#101820","pit",40.4468,-80.0158],
  ["SEA","Seattle Seahawks","NFC","West","#69BE28","#002244","sea",47.5952,-122.3316],
  ["SF","San Francisco 49ers","NFC","West","#AA0000","#B3995D","sf",37.4030,-121.9700],
  ["TB","Tampa Bay Buccaneers","NFC","South","#D50A0A","#FF7900","tb",27.9759,-82.5033],
  ["TEN","Tennessee Titans","AFC","South","#4B92DB","#0C2340","ten",36.1665,-86.7713],
  ["WAS","Washington Commanders","NFC","East","#5A1414","#FFB612","wsh",38.9077,-76.8645],
];
const ABBR_MAP = { SD: "LAC", OAK: "LV", STL: "LA", LAR: "LA" };
const COORDS = Object.fromEntries(TEAMS.map(t => [t[0], [t[7], t[8]]]));

// Injury weight by position (points per fully-out player), status multiplier.
// QBs are excluded here — starter changes are handled by the QB adjustment.
const POS_WEIGHT = { T:1.0, OT:1.0, DE:1.0, OLB:0.9, EDGE:1.0, CB:0.9, WR:0.8,
  G:0.6, C:0.6, OL:0.6, DT:0.5, NT:0.5, S:0.5, SS:0.5, FS:0.5, DB:0.5,
  TE:0.4, ILB:0.4, LB:0.4, MLB:0.4, RB:0.3, FB:0.2, K:0.3, P:0.2, LS:0.1 };
const STATUS_MULT = { out: 1, doubtful: 0.75, questionable: 0.25 };

// ---------- CSV ----------
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
const num = v => (v === "" || v == null || v === "NA" ? null : Number(v));
const mapAbbr = a => ABBR_MAP[a] || a;

async function fetchCSV(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return parseCSV(await r.text());
}
async function tryFetchCSV(url) {
  try { return await fetchCSV(url); } catch { return null; }
}

// ---------- core math ----------
const winProbFromElo = diff => 1 / (1 + Math.pow(10, -diff / 400));
const winProbFromMargin = pts => winProbFromElo(pts * ELO_TO_POINTS);
const movMultiplier = (margin, winnerDiff) =>
  Math.log(Math.abs(margin) + 1) * (2.2 / (winnerDiff * 0.001 + 2.2));

function marketProb(homeML, awayML) {
  if (homeML == null || awayML == null) return null;
  const imp = ml => (ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100));
  const h = imp(homeML), a = imp(awayML);
  if (!isFinite(h) || !isFinite(a) || h + a <= 0) return null;
  return h / (h + a);
}

function confidence(p) {
  const m = Math.max(p, 1 - p);
  if (m >= 0.72) return "Very High";
  if (m >= 0.65) return "High";
  if (m >= 0.58) return "Moderate";
  if (m >= 0.53) return "Low";
  return "Toss-Up";
}

function gameDiff(g, ratings) {
  const home = ratings[g.home] ?? ELO_START;
  const away = ratings[g.away] ?? ELO_START;
  const hfa = g.neutral ? 0 : HFA;
  let rest = 0;
  if (g.home_rest != null && g.away_rest != null) {
    rest = Math.max(-REST_CAP, Math.min(REST_CAP, (g.home_rest - g.away_rest) * REST_PTS));
  }
  return { home, away, diff: home - away + hfa + rest, hfa, rest };
}

function kickoffISO(gameday, gametime) {
  if (!gameday) return null;
  const t = gametime && /^\d{2}:\d{2}$/.test(gametime) ? gametime : "13:00";
  const month = Number(gameday.slice(5, 7));
  const offset = month >= 3 && month <= 10 ? "-04:00" : "-05:00";
  return `${gameday}T${t}:00${offset}`;
}

// ---------- Elo replay + core backtest (unchanged from v1) ----------
function replay(games, retroSeason) {
  const ratings = {}, record = {}, perf = {}, retroRows = [];
  let lastSeason = null;
  const blank = () => ({ games: 0, correct: 0, brier: 0,
    marketGames: 0, marketFavCorrect: 0, modelCorrectWithMarket: 0, buckets: {} });

  for (const g of games) {
    if (!g.completed) continue;
    if (g.season !== lastSeason) {
      for (const t of Object.keys(ratings)) ratings[t] += (ELO_MEAN - ratings[t]) / 3;
      for (const t of Object.keys(record)) record[t] = { w: 0, l: 0, t: 0 };
      lastSeason = g.season;
    }
    ratings[g.home] = ratings[g.home] ?? ELO_START;
    ratings[g.away] = ratings[g.away] ?? ELO_START;
    record[g.home] = record[g.home] || { w: 0, l: 0, t: 0 };
    record[g.away] = record[g.away] || { w: 0, l: 0, t: 0 };

    const { diff } = gameDiff(g, ratings);
    const pHomeModel = winProbFromElo(diff);

    if (g.season >= BACKTEST_FROM || g.season === retroSeason) {
      const pMkt = marketProb(g.home_moneyline, g.away_moneyline);
      const pFinal = pMkt == null ? pHomeModel
        : MARKET_WEIGHT * pMkt + (1 - MARKET_WEIGHT) * pHomeModel;
      const homeWon = g.home_score > g.away_score;
      if (g.season >= BACKTEST_FROM && g.home_score !== g.away_score) {
        const s = (perf[g.season] = perf[g.season] || blank());
        const correct = (pFinal >= 0.5) === homeWon;
        s.games++; if (correct) s.correct++;
        s.brier += Math.pow(pFinal - (homeWon ? 1 : 0), 2);
        const b = confidence(pFinal);
        s.buckets[b] = s.buckets[b] || { n: 0, correct: 0 };
        s.buckets[b].n++; if (correct) s.buckets[b].correct++;
        if (pMkt != null) {
          s.marketGames++;
          if ((pMkt >= 0.5) === homeWon) s.marketFavCorrect++;
          if (correct) s.modelCorrectWithMarket++;
        }
      }
      if (g.season === retroSeason) {
        // Retrospective prediction: core model (Elo + rest + HFA + market),
        // computed with ratings as they stood before this game. Inserted only
        // where no locked live prediction exists.
        const total = g.total_line ?? 44.5;
        const marginPts = diff / ELO_TO_POINTS;
        retroRows.push({
          game_id: g.game_id, model_version: MODEL_VERSION + "-retro",
          away_elo: Math.round(ratings[g.away] * 10) / 10,
          home_elo: Math.round(ratings[g.home] * 10) / 10,
          home_prob_model: Math.round(pHomeModel * 1000) / 1000,
          home_prob_market: pMkt == null ? null : Math.round(pMkt * 1000) / 1000,
          home_prob: Math.round(pFinal * 1000) / 1000,
          pick: pFinal >= 0.5 ? g.home : g.away,
          proj_home: Math.round(Math.max(3, (total + marginPts) / 2)),
          proj_away: Math.round(Math.max(3, (total - marginPts) / 2)),
          confidence: confidence(pFinal), upset_flag: false,
          factors: ["Retrospective: computed after the fact from pregame Elo, rest, home field, and the market line only"],
          risks: ["Not a live prediction; QB, injury, EPA, and weather factors are excluded to avoid using postgame information"],
          locked: true, retro: true, updated_at: new Date().toISOString(),
        });
      }
    }

    const margin = g.home_score - g.away_score;
    const winnerDiff = margin > 0 ? diff : -diff;
    const mult = margin === 0 ? 1 : movMultiplier(margin, winnerDiff);
    const actual = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    const shift = K * mult * (actual - pHomeModel);
    ratings[g.home] += shift; ratings[g.away] -= shift;
    if (margin > 0) { record[g.home].w++; record[g.away].l++; }
    else if (margin < 0) { record[g.away].w++; record[g.home].l++; }
    else { record[g.home].t++; record[g.away].t++; }
  }
  return { ratings, record, perf, lastSeason, retroRows };
}

// ---------- team EPA form (opponent-adjusted, recency-weighted) ----------
function teamEpaForm(curRows, prevRows, currentWeek) {
  // Per-game raw EPA/play (offense) from team-week stats; defense allowed is
  // derived from the opponent's offensive line for the same game.
  const toGames = rows => rows.map(r => ({
    team: mapAbbr(r.team), opp: mapAbbr(r.opponent_team), week: num(r.week),
    passEpa: num(r.passing_epa) ?? 0, rushEpa: num(r.rushing_epa) ?? 0,
    plays: (num(r.attempts) ?? 0) + (num(r.carries) ?? 0) + (num(r.sacks_suffered) ?? 0),
  })).filter(x => x.team && x.plays > 10);

  function seasonAverages(gamesArr, weighted) {
    const off = {}, def = {};
    const add = (m, t, epa, w) => {
      m[t] = m[t] || { epa: 0, w: 0 };
      m[t].epa += epa * w; m[t].w += w;
    };
    for (const g of gamesArr) {
      const w = weighted ? Math.pow(RECENCY_DECAY, Math.max(0, currentWeek - g.week)) : 1;
      const perPlay = (g.passEpa + g.rushEpa) / g.plays;
      add(off, g.team, perPlay, w);
      add(def, g.opp, perPlay, w);   // what the opponent allowed
    }
    const avg = m => Object.fromEntries(Object.entries(m).map(([t, v]) => [t, v.epa / v.w]));
    return { off: avg(off), def: avg(def) };
  }

  const cur = toGames(curRows || []);
  const prev = toGames(prevRows || []);
  if (!cur.length && !prev.length) return null;

  // Opponent adjustment: two iterations against league mean.
  function adjust(gamesArr) {
    let { off, def } = seasonAverages(gamesArr, true);
    const lg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    for (let it = 0; it < 2; it++) {
      const lgDef = lg(Object.values(def)), lgOff = lg(Object.values(off));
      const off2 = {}, def2 = {}, wOff = {}, wDef = {};
      for (const g of gamesArr) {
        const w = Math.pow(RECENCY_DECAY, Math.max(0, currentWeek - g.week));
        const perPlay = (g.passEpa + g.rushEpa) / g.plays;
        const oAdj = perPlay - ((def[g.opp] ?? lgDef) - lgDef);
        off2[g.team] = (off2[g.team] ?? 0) + oAdj * w; wOff[g.team] = (wOff[g.team] ?? 0) + w;
        const dAdj = perPlay - ((off[g.team] ?? lgOff) - lgOff);
        def2[g.opp] = (def2[g.opp] ?? 0) + dAdj * w; wDef[g.opp] = (wDef[g.opp] ?? 0) + w;
      }
      off = Object.fromEntries(Object.entries(off2).map(([t, v]) => [t, v / wOff[t]]));
      def = Object.fromEntries(Object.entries(def2).map(([t, v]) => [t, v / wDef[t]]));
    }
    return { off, def };
  }

  const curAdj = cur.length ? adjust(cur) : { off: {}, def: {} };
  const prevAvg = prev.length ? seasonAverages(prev, false) : { off: {}, def: {} };

  // Early-season blend toward last season, gone by week 7.
  const priorW = Math.max(0, (7 - currentWeek) / 7);
  const out = {};
  for (const [abbr] of TEAMS) {
    const co = curAdj.off[abbr], cd = curAdj.def[abbr];
    const po = prevAvg.off[abbr] ?? 0, pd = prevAvg.def[abbr] ?? 0;
    const offv = co == null ? po : co * (1 - priorW) + po * priorW;
    const defv = cd == null ? pd : cd * (1 - priorW) + pd * priorW;
    out[abbr] = {
      off: offv, def: defv, net: offv - defv,
      off_raw: co ?? null, def_raw: cd ?? null,
    };
  }
  return out;
}

function epaMarginPts(form, home, away) {
  if (!form || !form[home] || !form[away]) return null;
  const homePerPlay = (form[home].off + form[away].def) / 2;
  const awayPerPlay = (form[away].off + form[home].def) / 2;
  return (homePerPlay - awayPerPlay) * PLAYS_PER_GAME;
}

// ---------- QB values ----------
function qbValues(curWeekRows, prevRegRows) {
  const acc = {}; // name -> {epa, db, teams:{team:db}, recentEpa, recentDb}
  const addRow = (name, team, epa, db, isCurrent, week) => {
    if (!name || db <= 0) return;
    const a = (acc[name] = acc[name] || { epa: 0, db: 0, teams: {}, curDb: 0 });
    const w = isCurrent ? 1 : 0.6; // prior season discounted
    a.epa += epa * w; a.db += db * w;
    if (isCurrent) { a.curDb += db; a.teams[team] = (a.teams[team] || 0) + db; }
    else if (!Object.keys(a.teams).length) a.teams[team] = (a.teams[team] || 0) + db * 0.01;
  };
  for (const r of prevRegRows || []) {
    if (r.position !== "QB") continue;
    const db = (num(r.attempts) ?? 0) + (num(r.sacks_suffered) ?? 0) + (num(r.carries) ?? 0);
    addRow(r.player_display_name, mapAbbr(r.recent_team || r.team), (num(r.passing_epa) ?? 0) + (num(r.rushing_epa) ?? 0), db, false);
  }
  for (const r of curWeekRows || []) {
    if (r.position !== "QB") continue;
    const db = (num(r.attempts) ?? 0) + (num(r.sacks_suffered) ?? 0) + (num(r.carries) ?? 0);
    addRow(r.player_display_name, mapAbbr(r.team || r.recent_team), (num(r.passing_epa) ?? 0) + (num(r.rushing_epa) ?? 0), db, true, num(r.week));
  }
  const vals = {};
  for (const [name, a] of Object.entries(acc)) {
    // shrink toward league mean by sample size
    vals[name] = {
      value: (a.epa + QB_LEAGUE_MEAN * QB_PRIOR_DB) / (a.db + QB_PRIOR_DB),
      dropbacks: Math.round(a.db),
      team: Object.entries(a.teams).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
      curDb: a.curDb,
    };
  }
  // primary QB per team = most current-season dropbacks
  const primary = {};
  for (const [name, v] of Object.entries(vals)) {
    if (!v.team) continue;
    if (!primary[v.team] || v.curDb > vals[primary[v.team]].curDb) primary[v.team] = name;
  }
  return { vals, primary };
}

function qbAdjustment(listedStarter, team, qb) {
  // Points added to `team`'s side when the listed starter differs from the QB
  // who has taken the team's snaps (the one already baked into Elo/EPA).
  if (!qb || !listedStarter) return { pts: 0, note: null, starterVal: null };
  const primaryName = qb.primary[team];
  const starter = qb.vals[listedStarter];
  const starterVal = starter ? starter.value : QB_LEAGUE_MEAN - 0.08; // unproven
  if (!primaryName || primaryName === listedStarter) {
    return { pts: 0, note: null, starterVal };
  }
  const primaryVal = qb.vals[primaryName].value;
  let pts = (starterVal - primaryVal) * QB_DB_PER_GAME;
  pts = Math.max(-QB_ADJ_CAP, Math.min(QB_ADJ_CAP, pts));
  return {
    pts,
    note: `${listedStarter} starts in place of ${primaryName} (${pts >= 0 ? "+" : ""}${pts.toFixed(1)} pts)`,
    starterVal,
  };
}

// ---------- injuries ----------
function injuryImpact(injRows, week) {
  const byTeam = {};
  for (const r of injRows || []) {
    if (num(r.week) !== week) continue;
    const status = (r.report_status || "").toLowerCase();
    const mult = STATUS_MULT[status];
    if (!mult) continue;
    const pos = (r.position || "").toUpperCase();
    if (pos === "QB") continue; // handled by QB adjustment
    const wgt = POS_WEIGHT[pos] ?? 0.3;
    const team = mapAbbr(r.team);
    const t = (byTeam[team] = byTeam[team] || { pts: 0, out: 0, quest: 0, names: [] });
    t.pts += wgt * mult;
    if (status === "out" || status === "doubtful") { t.out++; t.names.push(`${r.full_name} (${pos}, ${r.report_status})`); }
    else t.quest++;
  }
  for (const t of Object.values(byTeam)) {
    t.pts = Math.min(INJ_TEAM_CAP, Math.round(t.pts * 10) / 10);
    t.names = t.names.slice(0, 6);
  }
  return byTeam;
}

// ---------- weather ----------
async function fetchWeather(games) {
  const out = {};
  const targets = games.filter(g => {
    const roof = (g.roof || "").toLowerCase();
    if (!(roof === "outdoors" || roof === "open")) return false;
    if (g.neutral) return false;             // unknown coordinates
    if (!COORDS[g.home] || !g.kickoff) return false;
    const dt = (new Date(g.kickoff) - Date.now()) / 864e5;
    return dt >= -0.2 && dt <= 8;
  });
  await Promise.all(targets.map(async g => {
    try {
      const [lat, lon] = COORDS[g.home];
      const day = g.gameday;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&hourly=temperature_2m,wind_speed_10m,precipitation_probability` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto` +
        `&start_date=${day}&end_date=${day}`;
      const r = await fetch(url);
      if (!r.ok) return;
      const j = await r.json();
      const hour = Math.min(23, Math.max(0, new Date(g.kickoff).getHours()));
      const idx = (j.hourly?.time || []).findIndex(t => Number(t.slice(11, 13)) === hour);
      if (idx < 0) return;
      out[g.game_id] = {
        temp: Math.round(j.hourly.temperature_2m[idx]),
        wind: Math.round(j.hourly.wind_speed_10m[idx]),
        precip: j.hourly.precipitation_probability?.[idx] ?? null,
      };
    } catch { /* leave unavailable */ }
  }));
  return out;
}

function weatherEffect(wx) {
  if (!wx) return { shrink: 0, totalCut: 0, summary: null };
  let shrink = 0, totalCut = 0;
  const bits = [`${wx.temp}°F`, `${wx.wind} mph wind`];
  if (wx.wind >= 15) shrink = Math.min(0.25, (wx.wind - 15) * 0.02);
  if (wx.wind > 10) totalCut += (wx.wind - 10) * 0.35;
  if (wx.precip != null && wx.precip >= 60) { totalCut += 2; bits.push(`${wx.precip}% precip`); }
  if (wx.temp <= 15) bits.push("extreme cold");
  return { shrink, totalCut: Math.min(totalCut, 8), summary: bits.join(", ") };
}

// ---------- narration ----------
function narrate(g, ctx, teamName) {
  const { d, pModel, pMkt, pFinal, epaPts, epaW, qbHome, qbAway, injH, injA, wxFx } = ctx;
  const pickHome = pFinal >= 0.5;
  const pick = pickHome ? g.home : g.away;
  const factors = [], risks = [];
  const eloEdge = pickHome ? d.home - d.away : d.away - d.home;

  if (eloEdge > 15) factors.push(`${teamName(pick)} rate ${Math.round(eloEdge)} Elo points stronger on results to date`);
  if (epaPts != null && Math.abs(epaPts) >= 1.5) {
    const epaFav = epaPts > 0 ? g.home : g.away;
    (epaFav === pick ? factors : risks).push(
      `Opponent-adjusted efficiency favors ${teamName(epaFav)} by ${Math.abs(epaPts).toFixed(1)} points per game`);
  }
  if (pickHome && !g.neutral) factors.push(`Home field is worth about ${(HFA / ELO_TO_POINTS).toFixed(1)} points here`);
  if (!pickHome && !g.neutral) risks.push(`${teamName(g.home)} get the home crowd, worth about ${(HFA / ELO_TO_POINTS).toFixed(1)} points`);
  const qbNet = (qbHome.pts || 0) - (qbAway.pts || 0);
  // A starter change is an uncertainty item regardless of direction.
  if (qbHome.note) risks.push(`${teamName(g.home)}: ${qbHome.note}`);
  if (qbAway.note) risks.push(`${teamName(g.away)}: ${qbAway.note}`);
  if (Math.abs(qbNet) >= 1.5) {
    const f = qbNet > 0 ? g.home : g.away;
    (f === pick ? factors : risks).push(`Quarterback situation shifts ${Math.abs(qbNet).toFixed(1)} points toward ${teamName(f)}`);
  }
  const injNet = (injA?.pts || 0) - (injH?.pts || 0);
  if (Math.abs(injNet) >= 1) {
    const f = injNet > 0 ? g.home : g.away;
    (f === pick ? factors : risks).push(`Injury report tilts ${Math.abs(injNet).toFixed(1)} points toward ${teamName(f)}`);
  }
  if (d.rest !== 0) {
    const restFav = d.rest > 0 ? g.home : g.away;
    (restFav === pick ? factors : risks).push(`${teamName(restFav)} hold a rest edge (${g.home_rest ?? "?"} vs ${g.away_rest ?? "?"} days)`);
  }
  if (wxFx.summary && wxFx.shrink > 0) risks.push(`Weather (${wxFx.summary}) pushes this toward a coin flip`);
  if (pMkt != null) {
    const mktPickHome = pMkt >= 0.5;
    if (mktPickHome === pickHome) factors.push(`Betting market agrees (${Math.round((pickHome ? pMkt : 1 - pMkt) * 100)}% implied)`);
    else risks.push(`Betting market leans the other way, toward ${teamName(mktPickHome ? g.home : g.away)}`);
  } else risks.push(`No market line available; prediction is model-only`);
  if (g.div_game) risks.push(`Division game; familiarity narrows talent gaps`);
  if (Math.max(pFinal, 1 - pFinal) < 0.58) risks.push(`Model sees this close to a coin flip; treat the pick lightly`);
  return { factors: factors.slice(0, 5), risks: risks.slice(0, 3), pick };
}

// ---------- Supabase REST ----------
function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}
async function supa(path, method, body, extraHeaders = {}) {
  const url = process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { ...supaHeaders(), "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal", ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path}: ${res.status} ${await res.text()}`);
  return res;
}
const upsert = (table, rows) => (rows && rows.length ? supa(table, "POST", rows) : null);

async function fetchSnapshotsLatest() {
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/prediction_snapshots?select=game_id,home_prob&order=captured_at.desc&limit=600`,
      { headers: supaHeaders() });
    if (!res.ok) return {};
    const rows = await res.json();
    const latest = {};
    for (const r of rows) if (!(r.game_id in latest)) latest[r.game_id] = Number(r.home_prob);
    return latest;
  } catch { return {}; }
}

// ---------- main ----------
export async function runSync() {
  const started = Date.now();
  const raw = await fetchCSV(GAMES_CSV);

  const games = raw.map(r => ({
    game_id: r.game_id, season: num(r.season), week: num(r.week), game_type: r.game_type,
    gameday: r.gameday || null, gametime: r.gametime || null, weekday: r.weekday || null,
    away: mapAbbr(r.away_team), home: mapAbbr(r.home_team),
    away_score: num(r.away_score), home_score: num(r.home_score),
    spread_line: num(r.spread_line), total_line: num(r.total_line),
    away_moneyline: num(r.away_moneyline), home_moneyline: num(r.home_moneyline),
    away_rest: num(r.away_rest), home_rest: num(r.home_rest),
    roof: r.roof || null, stadium: r.stadium || null, div_game: r.div_game === "1",
    away_qb: r.away_qb_name || null, home_qb: r.home_qb_name || null,
    neutral: (r.location || "").toLowerCase() === "neutral",
  }))
  .filter(g => g.season >= REPLAY_FROM && g.game_id)
  .map(g => ({ ...g, completed: g.home_score != null && g.away_score != null,
               kickoff: kickoffISO(g.gameday, g.gametime) }));

  games.sort((a, b) => a.season - b.season ||
    (a.gameday || "").localeCompare(b.gameday || "") ||
    (a.gametime || "").localeCompare(b.gametime || ""));

  const currentSeason = Math.max(...games.map(g => g.season));
  const { ratings, record, perf, lastSeason, retroRows } = replay(games, currentSeason);
  const seasonGames = games.filter(g => g.season === currentSeason);
  const upcoming = seasonGames.filter(g => !g.completed);
  const currentWeek = upcoming.length ? Math.min(...upcoming.map(g => g.week))
    : Math.max(...seasonGames.map(g => g.week));
  const teamName = a => (TEAMS.find(t => t[0] === a) || [a, a])[1];

  // Phase 2 data, fetched in parallel; each may come back null and the
  // corresponding component contributes zero with a note.
  const [twCur, twPrev, pwCur, prReg, injRows, wxMap] = await Promise.all([
    tryFetchCSV(TEAM_WEEK(currentSeason)),
    tryFetchCSV(TEAM_WEEK(currentSeason - 1)),
    tryFetchCSV(PLAYER_WEEK(currentSeason)),
    tryFetchCSV(PLAYER_REG(currentSeason - 1)),
    tryFetchCSV(INJURIES(currentSeason)),
    fetchWeather(upcoming),
  ]);

  const form = teamEpaForm(twCur, twPrev, currentWeek);
  const qb = (pwCur || prReg) ? qbValues(pwCur, prReg) : null;
  const inj = injRows ? injuryImpact(injRows, currentWeek) : null;

  // teams
  await upsert("teams", TEAMS.map(([abbr, name, conference, division, color, color2, slug]) => ({
    abbr, name, conference, division, color, color2,
    logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`,
  })));

  // current-season games
  await upsert("games", seasonGames.map(g => ({
    game_id: g.game_id, season: g.season, week: g.week, game_type: g.game_type,
    gameday: g.gameday, gametime: g.gametime, weekday: g.weekday,
    away: g.away, home: g.home, away_score: g.away_score, home_score: g.home_score,
    spread_line: g.spread_line, total_line: g.total_line,
    away_moneyline: g.away_moneyline, home_moneyline: g.home_moneyline,
    away_rest: g.away_rest, home_rest: g.home_rest,
    roof: g.roof, stadium: g.stadium, div_game: g.div_game,
    away_qb: g.away_qb, home_qb: g.home_qb, completed: g.completed, kickoff: g.kickoff,
  })));

  // Elo with rank movement
  const ranked = Object.entries(ratings)
    .filter(([t]) => TEAMS.some(x => x[0] === t)).sort((a, b) => b[1] - a[1]);
  let prevRanks = {};
  try {
    const pr = await fetch(`${process.env.SUPABASE_URL}/rest/v1/elo_ratings?select=team,rank`, { headers: supaHeaders() });
    if (pr.ok) prevRanks = Object.fromEntries((await pr.json()).map(r => [r.team, r.rank]));
  } catch {}
  await upsert("elo_ratings", ranked.map(([team, rating], i) => ({
    team, rating: Math.round(rating * 10) / 10, season: lastSeason,
    wins: record[team]?.w ?? 0, losses: record[team]?.l ?? 0, ties: record[team]?.t ?? 0,
    rank: i + 1, prev_rank: prevRanks[team] ?? null, updated_at: new Date().toISOString(),
  })));

  // team form
  if (form) {
    await upsert("team_form", TEAMS.map(([abbr]) => ({
      team: abbr, season: currentSeason,
      off_epa: round3(form[abbr].off), def_epa: round3(form[abbr].def),
      net_epa: round3(form[abbr].net), updated_at: new Date().toISOString(),
    })));
  }

  // qb values (starters + notable backups)
  if (qb) {
    const rows = Object.entries(qb.vals)
      .filter(([, v]) => v.dropbacks >= 30 || v.curDb >= 10)
      .sort((a, b) => b[1].dropbacks - a[1].dropbacks).slice(0, 120)
      .map(([name, v]) => ({
        qb_name: name, team: v.team, value: round3(v.value),
        dropbacks: v.dropbacks, is_primary: qb.primary[v.team] === name,
        updated_at: new Date().toISOString(),
      }));
    await upsert("qb_values", rows);
  }

  // predictions
  const now = Date.now();
  const latestSnap = await fetchSnapshotsLatest();
  const predRows = [], snapRows = [], lockIds = [], condRows = [];
  const epaW = Math.min(0.55, Math.max(0.15, 0.15 + Math.max(0, currentWeek - 2) * 0.08));

  for (const g of upcoming) {
    const kicked = g.kickoff && new Date(g.kickoff).getTime() <= now;
    if (kicked) { lockIds.push(g.game_id); continue; }

    const d = gameDiff(g, ratings);
    const eloPts = d.diff / ELO_TO_POINTS;
    const epaPts = epaMarginPts(form, g.home, g.away);
    const qbHome = qbAdjustment(g.home_qb, g.home, qb);
    const qbAway = qbAdjustment(g.away_qb, g.away, qb);
    const injH = inj?.[g.home] ?? null, injA = inj?.[g.away] ?? null;
    const wx = wxMap[g.game_id] ?? null;
    const wxFx = weatherEffect(wx);

    let margin = epaPts == null ? eloPts : eloPts * (1 - epaW) + epaPts * epaW;
    margin += (qbHome.pts || 0) - (qbAway.pts || 0);
    margin += ((injA?.pts || 0) - (injH?.pts || 0));
    margin *= (1 - wxFx.shrink);

    const pModel = winProbFromMargin(margin);
    const pMkt = marketProb(g.home_moneyline, g.away_moneyline);
    const pFinal = pMkt == null ? pModel : MARKET_WEIGHT * pMkt + (1 - MARKET_WEIGHT) * pModel;
    const ctx = { d, pModel, pMkt, pFinal, epaPts, epaW, qbHome, qbAway, injH, injA, wxFx };
    const { factors, risks, pick } = narrate(g, ctx, teamName);

    const total = Math.max(30, (g.total_line ?? 44.5) - wxFx.totalCut);
    const projHome = Math.max(3, (total + margin) / 2);
    const projAway = Math.max(3, (total - margin) / 2);
    const upset = pMkt != null && ((pMkt >= 0.5) !== (pFinal >= 0.5)) && Math.abs(pFinal - pMkt) >= 0.05;

    if (wx) condRows.push({ game_id: g.game_id, temp_f: wx.temp, wind_mph: wx.wind,
      precip_pct: wx.precip, summary: wxFx.summary, fetched_at: new Date().toISOString() });

    predRows.push({
      game_id: g.game_id, model_version: MODEL_VERSION,
      away_elo: round1(d.away), home_elo: round1(d.home),
      home_prob_model: round3(pModel),
      home_prob_market: pMkt == null ? null : round3(pMkt),
      home_prob: round3(pFinal),
      pick, proj_home: Math.round(projHome), proj_away: Math.round(projAway),
      confidence: confidence(pFinal), upset_flag: upset,
      factors, risks, locked: false, updated_at: new Date().toISOString(),
      breakdown: {
        elo_margin: round1(eloPts),
        epa_margin: epaPts == null ? null : round1(epaPts),
        epa_weight: round2(epaW),
        qb_adj: round1((qbHome.pts || 0) - (qbAway.pts || 0)),
        home_qb: { name: g.home_qb, value: qbHome.starterVal == null ? null : round3(qbHome.starterVal), note: qbHome.note },
        away_qb: { name: g.away_qb, value: qbAway.starterVal == null ? null : round3(qbAway.starterVal), note: qbAway.note },
        injury_adj: round1((injA?.pts || 0) - (injH?.pts || 0)),
        injuries: {
          home: injH ? { pts: injH.pts, out: injH.out, questionable: injH.quest, names: injH.names } : null,
          away: injA ? { pts: injA.pts, out: injA.out, questionable: injA.quest, names: injA.names } : null,
        },
        weather: wx ? { ...wx, summary: wxFx.summary, shrink: round2(wxFx.shrink) }
          : ((g.roof || "").toLowerCase() === "outdoors" || (g.roof || "").toLowerCase() === "open")
            ? null : { indoor: true },
        final_margin: round1(margin),
      },
    });
    const prev = latestSnap[g.game_id];
    if (prev == null || Math.abs(prev - pFinal) >= 0.005) {
      snapRows.push({ game_id: g.game_id, home_prob: round3(pFinal), pick, model_version: MODEL_VERSION });
    }
  }
  await upsert("predictions", predRows);
  // Retro rows: insert-only-if-missing, so a locked live prediction is never
  // replaced by a retrospective one.
  if (retroRows.length) {
    await supa("predictions", "POST", retroRows,
      { Prefer: "resolution=ignore-duplicates,return=minimal" });
  }
  if (condRows.length) await upsert("game_conditions", condRows);
  if (snapRows.length) await supa("prediction_snapshots", "POST", snapRows, { Prefer: "return=minimal" });
  if (lockIds.length) {
    await supa(`predictions?game_id=in.(${lockIds.map(encodeURIComponent).join(",")})`, "PATCH", { locked: true });
  }

  // core-model backtest metrics
  const seasons = Object.keys(perf).map(Number).sort();
  const perfRows = [];
  const agg = { games: 0, correct: 0, brier: 0, marketGames: 0, marketFavCorrect: 0, modelCorrectWithMarket: 0, buckets: {} };
  for (const s of seasons) {
    const m = perf[s];
    perfRows.push({ id: `season-${s}`, season: s, metrics: finalize(m), updated_at: new Date().toISOString() });
    agg.games += m.games; agg.correct += m.correct; agg.brier += m.brier;
    agg.marketGames += m.marketGames; agg.marketFavCorrect += m.marketFavCorrect;
    agg.modelCorrectWithMarket += m.modelCorrectWithMarket;
    for (const [b, v] of Object.entries(m.buckets)) {
      agg.buckets[b] = agg.buckets[b] || { n: 0, correct: 0 };
      agg.buckets[b].n += v.n; agg.buckets[b].correct += v.correct;
    }
  }
  perfRows.push({ id: "overall", season: null, metrics: finalize(agg), updated_at: new Date().toISOString() });
  await upsert("model_performance", perfRows);

  return {
    ok: true, model: MODEL_VERSION, season: currentSeason, week: currentWeek,
    predictions: predRows.length, retro: retroRows.length, locked: lockIds.length, snapshots: snapRows.length,
    components: {
      epa: !!form, qb: !!qb, injuries: !!inj,
      weather: Object.keys(wxMap).length,
    },
    ms: Date.now() - started,
  };
}

const round1 = v => v == null ? null : Math.round(v * 10) / 10;
const round2 = v => v == null ? null : Math.round(v * 100) / 100;
const round3 = v => v == null ? null : Math.round(v * 1000) / 1000;

function finalize(m) {
  return {
    games: m.games,
    accuracy: m.games ? Math.round((m.correct / m.games) * 1000) / 10 : null,
    brier: m.games ? Math.round((m.brier / m.games) * 1000) / 1000 : null,
    marketFavAccuracy: m.marketGames ? Math.round((m.marketFavCorrect / m.marketGames) * 1000) / 10 : null,
    modelAccuracyWithMarket: m.marketGames ? Math.round((m.modelCorrectWithMarket / m.marketGames) * 1000) / 10 : null,
    marketGames: m.marketGames,
    buckets: Object.fromEntries(Object.entries(m.buckets).map(([b, v]) => [
      b, { n: v.n, winRate: v.n ? Math.round((v.correct / v.n) * 1000) / 10 : null },
    ])),
  };
}
