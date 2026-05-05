import request from "supertest";
import { createTestApp } from "./testApp.js";
import knowledgeRoutes from "../routes/KnowledgeRoutes.js";

// ─── Unit Tests for Knowledge Domain Endpoints ──────────────────
//
// Uses supertest to mount KnowledgeRoutes in-process.
// Only tests in-memory dataset endpoints (elements, indicators,
// exoplanets) that load from CSV at import time.
// External API endpoints (dictionary, books, countries, papers,
// wikipedia, anime, movies, TV, web extraction) are excluded —
// they live in tests/live/ as integration tests.
// ─────────────────────────────────────────────────────────────────

const app = createTestApp("/knowledge", knowledgeRoutes);

// ═══════════════════════════════════════════════════════════════════
//  Periodic Table — /knowledge/elements/*
// ═══════════════════════════════════════════════════════════════════

describe("GET /knowledge/elements/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/knowledge/elements/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns elements matching query", async () => {
    const res = await request(app).get("/knowledge/elements/search?q=hydrogen");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.count > 0).toBeTruthy();
    expect(Array.isArray(res.body.elements)).toBeTruthy();
    expect(res.body.elements[0].name).toBeTruthy();
    expect(res.body.elements[0].symbol).toBeTruthy();
    expect(typeof res.body.elements[0].atomicNumber === "number").toBeTruthy();
  });
});

describe("GET /knowledge/elements/:symbol", () => {
  it("returns element data for H", async () => {
    const res = await request(app).get("/knowledge/elements/H");
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe("H");
    expect(res.body.name).toBe("Hydrogen");
    expect(res.body.atomicNumber).toBe(1);
  });

  it("returns 404 for nonexistent element", async () => {
    const res = await request(app).get("/knowledge/elements/Zz");
    expect(res.status).toBe(404);
  });
});

describe("GET /knowledge/elements/rank", () => {
  it("returns 400 when property is missing", async () => {
    const res = await request(app).get("/knowledge/elements/rank");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("ranks elements by atomic mass", async () => {
    const res = await request(app).get("/knowledge/elements/rank?property=atomic_mass&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.property).toBe("atomic_mass");
    expect(Array.isArray(res.body.elements)).toBeTruthy();
    expect(res.body.elements.length <= 5).toBeTruthy();
  });

  it("returns 400 for invalid property", async () => {
    const res = await request(app).get("/knowledge/elements/rank?property=invalid_xyz");
    expect(res.status).toBe(400);
    expect(res.body.error.includes("Unknown property")).toBeTruthy();
    expect(Array.isArray(res.body.availableProperties)).toBeTruthy();
  });
});

describe("GET /knowledge/elements/categories", () => {
  it("returns element category list", async () => {
    const res = await request(app).get("/knowledge/elements/categories");
    expect(res.status).toBe(200);
    expect(typeof res.body.totalElements === "number").toBeTruthy();
    expect(res.body.totalElements >= 118).toBeTruthy();
    expect(Array.isArray(res.body.categories)).toBeTruthy();
    expect(Array.isArray(res.body.blocks)).toBeTruthy();
    expect(Array.isArray(res.body.phases)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  World Bank Indicators — /knowledge/indicators/*
// ═══════════════════════════════════════════════════════════════════

describe("GET /knowledge/indicators/country/:code", () => {
  it("returns indicators for Canada", async () => {
    const res = await request(app).get("/knowledge/indicators/country/CAN");
    expect(res.status).toBe(200);
    expect(res.body.countryCode).toBe("CAN");
    expect(res.body.countryName).toBe("Canada");
    expect(typeof res.body.indicators === "object").toBeTruthy();
  });

  it("returns 404 for nonexistent country", async () => {
    const res = await request(app).get("/knowledge/indicators/country/ZZZ");
    expect(res.status).toBe(404);
  });
});

describe("GET /knowledge/indicators/rank", () => {
  it("returns 400 when indicator is missing", async () => {
    const res = await request(app).get("/knowledge/indicators/rank");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("ranks countries by population", async () => {
    const res = await request(app).get("/knowledge/indicators/rank?indicator=population&limit=5&order=desc");
    expect(res.status).toBe(200);
    expect(res.body.indicator).toBe("population");
    expect(Array.isArray(res.body.countries)).toBeTruthy();
    // Verify descending order
    for (let i = 1; i < res.body.countries.length; i++) {
      expect(res.body.countries[i - 1].value >= res.body.countries[i].value).toBeTruthy();
    }
  });

  it("returns 400 for invalid indicator", async () => {
    const res = await request(app).get("/knowledge/indicators/rank?indicator=invalid_xyz");
    expect(res.status).toBe(400);
    expect(res.body.error.includes("Unknown indicator")).toBeTruthy();
    expect(Array.isArray(res.body.availableIndicators)).toBeTruthy();
  });
});

describe("GET /knowledge/indicators/compare", () => {
  it("returns 400 when countries is missing", async () => {
    const res = await request(app).get("/knowledge/indicators/compare");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 with only one country", async () => {
    const res = await request(app).get("/knowledge/indicators/compare?countries=USA");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("compares two countries", async () => {
    const res = await request(app).get("/knowledge/indicators/compare?countries=USA,CAN");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(Array.isArray(res.body.comparison)).toBeTruthy();
    expect(res.body.comparison.length).toBe(2);
  });
});

describe("GET /knowledge/indicators/list", () => {
  it("returns available indicators", async () => {
    const res = await request(app).get("/knowledge/indicators/list");
    expect(res.status).toBe(200);
    expect(typeof res.body.totalCountries === "number").toBeTruthy();
    expect(res.body.totalCountries > 200).toBeTruthy();
    expect(Array.isArray(res.body.indicators)).toBeTruthy();
    expect(res.body.indicators.length >= 15).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  NASA Exoplanets — /knowledge/exoplanets/*
// ═══════════════════════════════════════════════════════════════════

describe("GET /knowledge/exoplanets/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/knowledge/exoplanets/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns exoplanet search results", async () => {
    const res = await request(app).get("/knowledge/exoplanets/search?q=kepler&limit=5");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.count > 0).toBeTruthy();
    expect(Array.isArray(res.body.planets)).toBeTruthy();
    expect(res.body.planets[0].name).toBeTruthy();
    expect(res.body.planets[0].hostStar).toBeTruthy();
  });
});

describe("GET /knowledge/exoplanets/rank", () => {
  it("returns 400 when field is missing", async () => {
    const res = await request(app).get("/knowledge/exoplanets/rank");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("ranks by planet mass", async () => {
    const res = await request(app).get("/knowledge/exoplanets/rank?field=pl_bmasse&limit=5&order=desc");
    expect(res.status).toBe(200);
    expect(res.body.field).toBe("pl_bmasse");
    expect(Array.isArray(res.body.planets)).toBeTruthy();
    // Verify descending order
    for (let i = 1; i < res.body.planets.length; i++) {
      expect(res.body.planets[i - 1].value >= res.body.planets[i].value).toBeTruthy();
    }
  });
});

describe("GET /knowledge/exoplanets/stats", () => {
  it("returns discovery statistics", async () => {
    const res = await request(app).get("/knowledge/exoplanets/stats");
    expect(res.status).toBe(200);
    expect(typeof res.body.totalPlanets === "number").toBeTruthy();
    expect(res.body.totalPlanets > 5000).toBeTruthy();
    expect(typeof res.body.yearRange === "object").toBeTruthy();
    expect(Array.isArray(res.body.discoveryMethods)).toBeTruthy();
  });
});

describe("GET /knowledge/exoplanets/habitable", () => {
  it("returns habitable-zone planets", async () => {
    const res = await request(app).get("/knowledge/exoplanets/habitable?limit=5");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(typeof res.body.criteria === "string").toBeTruthy();
    expect(Array.isArray(res.body.planets)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Validation-only tests for external API endpoints
//  (tests that the 400 validation works, no live calls)
// ═══════════════════════════════════════════════════════════════════

describe("GET /knowledge/books/search (validation)", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/knowledge/books/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/papers/search (validation)", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/knowledge/papers/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/anime/search (validation)", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/knowledge/anime/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/movies/search (validation)", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/knowledge/movies/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/tv/search (validation)", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/knowledge/tv/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/youtube/video (validation)", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app).get("/knowledge/youtube/video");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/github/repo (validation)", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app).get("/knowledge/github/repo");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/reddit/thread (validation)", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app).get("/knowledge/reddit/thread");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/npm/package (validation)", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(app).get("/knowledge/npm/package");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/twitter/post (validation)", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app).get("/knowledge/twitter/post");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/hackernews/thread (validation)", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app).get("/knowledge/hackernews/thread");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/stackoverflow/question (validation)", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app).get("/knowledge/stackoverflow/question");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/web/content (validation)", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app).get("/knowledge/web/content");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/package/info (validation)", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(app).get("/knowledge/package/info?registry=npm");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 when registry is missing", async () => {
    const res = await request(app).get("/knowledge/package/info?name=express");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/pdf/read (validation)", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app).get("/knowledge/pdf/read");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/rss/feed (validation)", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app).get("/knowledge/rss/feed");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/music/artists/search (validation)", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/knowledge/music/artists/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /knowledge/wayback/snapshot (validation)", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app).get("/knowledge/wayback/snapshot");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
