import {
  EVENT_SOURCES,
  TICKETMASTER_INTERVAL_MS,
  SEATGEEK_INTERVAL_MS,
  CRAIGSLIST_INTERVAL_MS,
  UNIVERSITY_INTERVAL_MS,
  CITY_OF_VANCOUVER_INTERVAL_MS,
  SPORTS_INTERVAL_MS,
  MOVIE_INTERVAL_MS,
  GOOGLE_PLACES_INTERVAL_MS,
} from "../constants.js";
import { fetchTicketmasterEvents } from "../fetchers/event/TicketmasterFetcher.js";
import { fetchSeatGeekEvents } from "../fetchers/event/SeatGeekFetcher.js";
import { fetchCraigslistEvents } from "../fetchers/event/CraigslistFetcher.js";
import { fetchUniversityEvents } from "../fetchers/event/UniversityFetcher.js";
import { fetchCityOfVancouverEvents } from "../fetchers/event/CityOfVancouverFetcher.js";
import { fetchSportsEvents } from "../fetchers/event/SportsFetcher.js";
import { fetchMovieEvents } from "../fetchers/event/MovieFetcher.js";
import { fetchGooglePlacesEvents } from "../fetchers/event/GooglePlacesFetcher.js";
import { updateEvents, setError } from "../caches/EventCache.js";

// ─── Collector Factory ─────────────────────────────────────────────

/**
 * Create a standard event collector that fetches, caches, and persists.
 * @param {string} label - Log label (e.g. "Ticketmaster")
 * @param {string} source - EVENT_SOURCES key
 * @param {Function} fetchFn - Async function returning event array
 */
function createEventCollector(label, source, fetchFn) {
  return async function () {
    try {
      const events = await fetchFn();
      const result = await updateEvents(source, events);
      console.log(
        `[${label}] ✅ ${events.length} events | ${result?.upserted || 0} new, ${result?.modified || 0} updated`,
      );
    } catch (error) {
      setError(source, error);
      console.error(`[${label}] ❌ ${error.message}`);
    }
  };
}

// ─── Simple Collectors (factory-generated) ─────────────────────────

const collectTicketmaster = createEventCollector(
  "Ticketmaster",
  EVENT_SOURCES.TICKETMASTER,
  fetchTicketmasterEvents,
);
const collectSeatGeek = createEventCollector(
  "SeatGeek",
  EVENT_SOURCES.SEATGEEK,
  fetchSeatGeekEvents,
);
const collectCraigslist = createEventCollector(
  "Craigslist",
  EVENT_SOURCES.CRAIGSLIST,
  fetchCraigslistEvents,
);
const collectCityOfVancouver = createEventCollector(
  "City of Vancouver",
  EVENT_SOURCES.CITY_OF_VANCOUVER,
  fetchCityOfVancouverEvents,
);
const collectMovies = createEventCollector(
  "Movies",
  EVENT_SOURCES.TMDB,
  fetchMovieEvents,
);
const collectGooglePlaces = createEventCollector(
  "Google Places",
  EVENT_SOURCES.GOOGLE_PLACES,
  fetchGooglePlacesEvents,
);

// ─── Multi-Source Collectors (custom logic) ────────────────────────

async function collectUniversities() {
  try {
    const events = await fetchUniversityEvents();
    const ubcEvents = events.filter((e) => e.source === EVENT_SOURCES.UBC);
    const sfuEvents = events.filter((e) => e.source === EVENT_SOURCES.SFU);

    if (ubcEvents.length > 0) {
      const r = await updateEvents(EVENT_SOURCES.UBC, ubcEvents);
      console.log(
        `[UBC] ✅ ${ubcEvents.length} events | ${r?.upserted || 0} new`,
      );
    }
    if (sfuEvents.length > 0) {
      const r = await updateEvents(EVENT_SOURCES.SFU, sfuEvents);
      console.log(
        `[SFU] ✅ ${sfuEvents.length} events | ${r?.upserted || 0} new`,
      );
    }
    if (ubcEvents.length === 0 && sfuEvents.length === 0) {
      console.log("[Universities] ✅ 0 events parsed");
    }
  } catch (error) {
    setError(EVENT_SOURCES.UBC, error);
    setError(EVENT_SOURCES.SFU, error);
    console.error(`[Universities] ❌ ${error.message}`);
  }
}

async function collectSports() {
  try {
    const events = await fetchSportsEvents();
    const nhl = events.filter((e) => e.source === EVENT_SOURCES.NHL);
    const caps = events.filter((e) => e.source === EVENT_SOURCES.WHITECAPS);
    const lions = events.filter((e) => e.source === EVENT_SOURCES.BC_LIONS);

    if (nhl.length > 0) {
      const r = await updateEvents(EVENT_SOURCES.NHL, nhl);
      console.log(`[Canucks] ✅ ${nhl.length} games | ${r?.upserted || 0} new`);
    }
    if (caps.length > 0) {
      const r = await updateEvents(EVENT_SOURCES.WHITECAPS, caps);
      console.log(
        `[Whitecaps] ✅ ${caps.length} games | ${r?.upserted || 0} new`,
      );
    }
    if (lions.length > 0) {
      const r = await updateEvents(EVENT_SOURCES.BC_LIONS, lions);
      console.log(
        `[BC Lions] ✅ ${lions.length} games | ${r?.upserted || 0} new`,
      );
    }
    if (events.length === 0) {
      console.log("[Sports] ✅ No upcoming games found");
    }
  } catch (error) {
    setError(EVENT_SOURCES.NHL, error);
    setError(EVENT_SOURCES.WHITECAPS, error);
    setError(EVENT_SOURCES.BC_LIONS, error);
    console.error(`[Sports] ❌ ${error.message}`);
  }
}

// ─── Start All Event Collectors ────────────────────────────────────

export function startEventCollectors() {
  // Staggered initial fetch
  collectTicketmaster();
  setTimeout(collectSeatGeek, 3_000);
  setTimeout(collectCraigslist, 6_000);
  setTimeout(collectUniversities, 9_000);
  setTimeout(collectCityOfVancouver, 12_000);
  setTimeout(collectSports, 15_000);
  setTimeout(collectMovies, 18_000);
  setTimeout(collectGooglePlaces, 21_000);

  // Recurring intervals
  setInterval(collectTicketmaster, TICKETMASTER_INTERVAL_MS);
  setInterval(collectSeatGeek, SEATGEEK_INTERVAL_MS);
  setInterval(collectCraigslist, CRAIGSLIST_INTERVAL_MS);
  setInterval(collectUniversities, UNIVERSITY_INTERVAL_MS);
  setInterval(collectCityOfVancouver, CITY_OF_VANCOUVER_INTERVAL_MS);
  setInterval(collectSports, SPORTS_INTERVAL_MS);
  setInterval(collectMovies, MOVIE_INTERVAL_MS);
  setInterval(collectGooglePlaces, GOOGLE_PLACES_INTERVAL_MS);

  console.log("📅 Event collectors started");
}
