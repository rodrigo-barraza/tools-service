import type { OnDemandSourceOptions, CachedEvent } from "./_helpers.ts";

const OPENLIGADB_BASE = "https://api.openligadb.de/getmatchdata/bl1";

interface OpenLigaMatch {
  matchID: number;
  matchDateTimeUTC: string;
  leagueName: string;
  team1: {
    teamName: string;
    shortName: string;
    teamIconUrl: string;
  };
  team2: {
    teamName: string;
    shortName: string;
    teamIconUrl: string;
  };
  location: {
    locationCity: string;
    locationStadium: string;
  } | null;
}

function cityMatchesTeam(city: string, teamName: string): boolean {
  const normalizedCity = city.toLowerCase();
  const normalizedTeam = teamName.toLowerCase();
  return (
    normalizedTeam.includes(normalizedCity) ||
    normalizedCity.includes(normalizedTeam)
  );
}

/**
 * Fetch German Bundesliga matches from OpenLigaDB. No API key required.
 * Filters matches where the requested city matches a team name or location city.
 */
export async function fetchOpenLigaDbOnDemand(
  options: OnDemandSourceOptions,
): Promise<CachedEvent[]> {
  try {
    const response = await fetch(OPENLIGADB_BASE);
    if (!response.ok) return [];

    const matches: OpenLigaMatch[] = await response.json();
    const events: CachedEvent[] = [];

    for (const match of matches) {
      const homeTeam = match.team1.teamName;
      const awayTeam = match.team2.teamName;
      const locationCity = match.location?.locationCity || "";

      const isRelevant =
        cityMatchesTeam(options.city, homeTeam) ||
        cityMatchesTeam(options.city, awayTeam) ||
        cityMatchesTeam(options.city, locationCity);

      if (!isRelevant) continue;

      events.push({
        name: `${homeTeam} vs ${awayTeam}`,
        source: "openligadb",
        sourceId: `openligadb-${match.matchID}`,
        category: "sports",
        startDate: new Date(match.matchDateTimeUTC),
        venue: match.location ? {
          name: match.location.locationStadium,
          city: match.location.locationCity,
        } : undefined,
        metadata: {
          league: match.leagueName,
          homeTeamIcon: match.team1.teamIconUrl,
          awayTeamIcon: match.team2.teamIconUrl,
        },
      });
    }

    return events;
  } catch {
    return [];
  }
}
