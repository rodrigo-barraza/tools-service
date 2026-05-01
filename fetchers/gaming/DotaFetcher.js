// ============================================================
// DotaFetcher — OpenDota API Client
// ============================================================
// Free API, no key required. Rate-limited to 60 req/min.
// Docs: https://docs.opendota.com/
// ============================================================

const BASE_URL = "https://api.opendota.com/api";

// Cache hero list in memory (static data, changes only on patches)
let heroCache = null;
let heroCacheTime = 0;
const HERO_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function fetchJson(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenDota API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Hero Data ──────────────────────────────────────────────────

/**
 * Get all heroes with stats.
 * @returns {Array} Hero list with localized names, roles, stats
 */
export async function getHeroes() {
  const now = Date.now();
  if (heroCache && now - heroCacheTime < HERO_CACHE_TTL) return heroCache;

  const [heroes, stats] = await Promise.all([
    fetchJson("/heroes"),
    fetchJson("/heroStats"),
  ]);

  // Merge stats into hero objects
  const statsMap = new Map(stats.map((s) => [s.id, s]));
  heroCache = heroes.map((h) => {
    const s = statsMap.get(h.id) || {};
    return {
      id: h.id,
      name: h.localized_name,
      internalName: h.name,
      primaryAttr: h.primary_attr,
      attackType: h.attack_type,
      roles: h.roles,
      img: `https://cdn.cloudflare.steamstatic.com${s.img || ""}`,
      icon: `https://cdn.cloudflare.steamstatic.com${s.icon || ""}`,
      baseHealth: s.base_health,
      baseMana: s.base_mana,
      baseArmor: s.base_armor,
      baseAttackMin: s.base_attack_min,
      baseAttackMax: s.base_attack_max,
      moveSpeed: s.move_speed,
      legs: h.legs,
      // Win rates across brackets
      proWinRate: s.pro_pick ? ((s.pro_win / s.pro_pick) * 100).toFixed(1) + "%" : null,
      proPick: s.pro_pick || 0,
      turboPick: s.turbo_picks || 0,
      turboWinRate: s.turbo_picks ? ((s.turbo_wins / s.turbo_picks) * 100).toFixed(1) + "%" : null,
    };
  });
  heroCacheTime = now;
  return heroCache;
}

/**
 * Get a single hero by name or ID.
 * @param {string|number} query Hero name (partial match) or hero ID
 */
export async function getHero(query) {
  const heroes = await getHeroes();
  const q = String(query).toLowerCase();

  // Try ID match first
  const byId = heroes.find((h) => h.id === parseInt(query));
  if (byId) return byId;

  // Exact name match
  const exact = heroes.find((h) => h.name.toLowerCase() === q);
  if (exact) return exact;

  // Partial name match
  const partial = heroes.filter((h) => h.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    return {
      ambiguous: true,
      matches: partial.map((h) => ({ id: h.id, name: h.name })),
      hint: "Multiple heroes matched. Use the exact name or hero ID.",
    };
  }

  return null;
}

// ── Hero Matchups ────────────────────────────────────────────────

/**
 * Get hero matchup data (best/worst opponents).
 * @param {number} heroId Hero ID
 */
export async function getHeroMatchups(heroId) {
  const matchups = await fetchJson(`/heroes/${heroId}/matchups`);

  // Sort by win rate to find best/worst
  const withRates = matchups
    .filter((m) => m.games_played >= 50)
    .map((m) => ({
      heroId: m.hero_id,
      gamesPlayed: m.games_played,
      wins: m.wins,
      winRate: ((m.wins / m.games_played) * 100).toFixed(1) + "%",
    }));

  const sorted = [...withRates].sort(
    (a, b) => parseFloat(b.winRate) - parseFloat(a.winRate),
  );

  return {
    heroId,
    bestAgainst: sorted.slice(0, 10),
    worstAgainst: sorted.slice(-10).reverse(),
    totalMatchups: matchups.length,
  };
}

// ── Player Data ────────────────────────────────────────────────

/**
 * Get player profile by Steam account ID.
 * @param {number} accountId Steam32 account ID
 */
export async function getPlayer(accountId) {
  const [profile, wl] = await Promise.all([
    fetchJson(`/players/${accountId}`),
    fetchJson(`/players/${accountId}/wl`),
  ]);

  return {
    accountId: profile.profile?.account_id,
    personaName: profile.profile?.personaname,
    avatar: profile.profile?.avatarfull,
    steamId: profile.profile?.steamid,
    profileUrl: profile.profile?.profileurl,
    countryCode: profile.profile?.loccountrycode,
    mmrEstimate: profile.mmr_estimate?.estimate,
    rank: profile.rank_tier,
    leaderboardRank: profile.leaderboard_rank,
    wins: wl.win,
    losses: wl.lose,
    winRate: wl.win + wl.lose > 0
      ? (((wl.win / (wl.win + wl.lose)) * 100).toFixed(1) + "%")
      : null,
    totalGames: wl.win + wl.lose,
  };
}

/**
 * Get player's recent matches.
 * @param {number} accountId Steam32 account ID
 * @param {number} limit Number of matches (default: 10)
 */
export async function getPlayerRecentMatches(accountId, limit = 10) {
  const matches = await fetchJson(`/players/${accountId}/recentMatches`);
  return matches.slice(0, limit).map((m) => ({
    matchId: m.match_id,
    heroId: m.hero_id,
    duration: m.duration,
    durationMinutes: Math.round(m.duration / 60),
    kills: m.kills,
    deaths: m.deaths,
    assists: m.assists,
    kda: m.deaths > 0
      ? ((m.kills + m.assists) / m.deaths).toFixed(1)
      : (m.kills + m.assists).toFixed(1),
    lastHits: m.last_hits,
    denies: m.denies,
    xpm: m.xp_per_min,
    gpm: m.gold_per_min,
    playerSlot: m.player_slot,
    radiantWin: m.radiant_win,
    won: (m.player_slot < 128) === m.radiant_win,
    startTime: new Date(m.start_time * 1000).toISOString(),
  }));
}

// ── Match Data ─────────────────────────────────────────────────

/**
 * Get match details by match ID.
 * @param {number} matchId Match ID
 */
export async function getMatch(matchId) {
  const m = await fetchJson(`/matches/${matchId}`);

  return {
    matchId: m.match_id,
    duration: m.duration,
    durationMinutes: Math.round(m.duration / 60),
    radiantWin: m.radiant_win,
    radiantScore: m.radiant_score,
    direScore: m.dire_score,
    startTime: new Date(m.start_time * 1000).toISOString(),
    gameMode: m.game_mode,
    lobbyType: m.lobby_type,
    region: m.region,
    players: (m.players || []).map((p) => ({
      accountId: p.account_id,
      personaName: p.personaname,
      heroId: p.hero_id,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      lastHits: p.last_hits,
      denies: p.denies,
      gpm: p.gold_per_min,
      xpm: p.xp_per_min,
      heroDamage: p.hero_damage,
      towerDamage: p.tower_damage,
      heroHealing: p.hero_healing,
      level: p.level,
      isRadiant: p.isRadiant,
      won: p.isRadiant === m.radiant_win,
    })),
  };
}

// ── Pro Matches ────────────────────────────────────────────────

/**
 * Get recent professional matches.
 * @param {number} limit Number of matches (default: 10)
 */
export async function getProMatches(limit = 10) {
  const matches = await fetchJson("/proMatches");
  return matches.slice(0, limit).map((m) => ({
    matchId: m.match_id,
    duration: m.duration,
    durationMinutes: Math.round(m.duration / 60),
    radiantName: m.radiant_name,
    direName: m.dire_name,
    radiantWin: m.radiant_win,
    radiantScore: m.radiant_score,
    direScore: m.dire_score,
    leagueName: m.league_name,
    startTime: new Date(m.start_time * 1000).toISOString(),
  }));
}
