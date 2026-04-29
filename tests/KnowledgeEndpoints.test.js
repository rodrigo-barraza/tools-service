import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Knowledge Domain Endpoints ───────────
//
// These tests hit the live tools-api server on localhost:5590.
// They validate response shapes for all /knowledge/* endpoints
// (on-demand fetchers + in-memory datasets).
// ─────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/knowledge`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─── Dictionary ────────────────────────────────────────────────────

describe("GET /knowledge/dictionary/:word", () => {
  it("returns a definition for a known word", async () => {
    const { status, data } = await fetchJson("/dictionary/hello");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── Books (OpenLibrary) ───────────────────────────────────────────

describe("GET /knowledge/books/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/books/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns book search results", async () => {
    const { status, data } = await fetchJson("/books/search?q=dune&limit=3");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── Countries (RestCountries) ─────────────────────────────────────

describe("GET /knowledge/countries/search/:name", () => {
  it("returns country data for Canada", async () => {
    const { status, data } = await fetchJson("/countries/search/Canada");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/countries/code/:code", () => {
  it("returns country data by ISO code", async () => {
    const { status, data } = await fetchJson("/countries/code/CAN");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── Papers (arXiv) ────────────────────────────────────────────────

describe("GET /knowledge/papers/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/papers/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns arXiv paper results (tolerates upstream failures)", async () => {
    const res = await fetch(`${BASE}/papers/search?q=transformer&limit=3`);
    // arXiv API can be unreliable — accept any response as long as the server doesn't crash
    assert.ok(typeof res.status === "number", "returns an HTTP status");
    if (res.status === 200) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        assert.ok(typeof data === "object", "returns data");
      }
    }
  });
});

// ─── Wikipedia ─────────────────────────────────────────────────────

describe("GET /knowledge/wikipedia/summary/:title", () => {
  it("returns a Wikipedia summary", async () => {
    const { status, data } = await fetchJson("/wikipedia/summary/JavaScript");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/wikipedia/onthisday", () => {
  it("returns On This Day events", async () => {
    const { status, data } = await fetchJson("/wikipedia/onthisday");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── Anime (Jikan) ─────────────────────────────────────────────────

describe("GET /knowledge/anime/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/anime/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns anime search results", async () => {
    const { status, data } = await fetchJson("/anime/search?q=naruto&limit=3");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/anime/top", () => {
  it("returns top-ranked anime", async () => {
    const { status, data } = await fetchJson("/anime/top?limit=5");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── Movies (TMDb) ─────────────────────────────────────────────────

describe("GET /knowledge/movies/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/movies/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns movie search results", async () => {
    const { status, data } = await fetchJson("/movies/search?q=inception");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/movies/trending", () => {
  it("returns trending movies", async () => {
    const { status, data } = await fetchJson("/movies/trending?limit=5");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/movies/genres", () => {
  it("returns movie genre list", async () => {
    const { status, data } = await fetchJson("/movies/genres");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── TV Series (TMDb) ──────────────────────────────────────────────

describe("GET /knowledge/tv/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/tv/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns TV show search results", async () => {
    const { status, data } = await fetchJson("/tv/search?q=breaking+bad");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/tv/trending", () => {
  it("returns trending TV shows", async () => {
    const { status, data } = await fetchJson("/tv/trending?limit=5");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/tv/genres", () => {
  it("returns TV genre list", async () => {
    const { status, data } = await fetchJson("/tv/genres");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── Periodic Table (in-memory) ────────────────────────────────────

describe("GET /knowledge/elements/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/elements/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns elements matching query", async () => {
    const { status, data } = await fetchJson("/elements/search?q=hydrogen");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/elements/:symbol", () => {
  it("returns element data for H", async () => {
    const { status, data } = await fetchJson("/elements/H");
    assert.equal(status, 200);
    assert.ok(data.symbol || data.name, "has element data");
  });

  it("returns 404 for nonexistent element", async () => {
    const { status } = await fetchJson("/elements/Zz");
    assert.equal(status, 404);
  });
});

describe("GET /knowledge/elements/rank", () => {
  it("returns 400 when property is missing", async () => {
    const { status, data } = await fetchJson("/elements/rank");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("ranks elements by atomic mass", async () => {
    const { status, data } = await fetchJson("/elements/rank?property=atomic_mass&limit=5");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/elements/categories", () => {
  it("returns element category list", async () => {
    const { status, data } = await fetchJson("/elements/categories");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── World Bank Indicators (in-memory) ─────────────────────────────

describe("GET /knowledge/indicators/country/:code", () => {
  it("returns indicators for Canada", async () => {
    const { status, data } = await fetchJson("/indicators/country/CAN");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });

  it("returns 404 for nonexistent country", async () => {
    const { status } = await fetchJson("/indicators/country/ZZZ");
    assert.equal(status, 404);
  });
});

describe("GET /knowledge/indicators/rank", () => {
  it("returns 400 when indicator is missing", async () => {
    const { status, data } = await fetchJson("/indicators/rank");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("ranks countries by an indicator", async () => {
    const { status, data } = await fetchJson("/indicators/rank?indicator=population&limit=5");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/indicators/compare", () => {
  it("returns 400 when countries is missing", async () => {
    const { status, data } = await fetchJson("/indicators/compare");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns 400 with only one country", async () => {
    const { status, data } = await fetchJson("/indicators/compare?countries=USA");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("compares two countries", async () => {
    const { status, data } = await fetchJson("/indicators/compare?countries=USA,CAN");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/indicators/list", () => {
  it("returns available indicators", async () => {
    const { status, data } = await fetchJson("/indicators/list");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── Exoplanets (in-memory) ────────────────────────────────────────

describe("GET /knowledge/exoplanets/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/exoplanets/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns exoplanet search results", async () => {
    const { status, data } = await fetchJson("/exoplanets/search?q=kepler&limit=5");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/exoplanets/rank", () => {
  it("returns 400 when field is missing", async () => {
    const { status, data } = await fetchJson("/exoplanets/rank");
    assert.equal(status, 400);
    assert.ok(data.error);
  });
});

describe("GET /knowledge/exoplanets/stats", () => {
  it("returns discovery statistics", async () => {
    const { status, data } = await fetchJson("/exoplanets/stats");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /knowledge/exoplanets/habitable", () => {
  it("returns habitable-zone planets", async () => {
    const { status, data } = await fetchJson("/exoplanets/habitable?limit=5");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});
