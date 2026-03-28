import CONFIG from "../../config.js";
import { PRODUCT_SOURCES } from "../../constants.js";
import { computeTrendingScore, TokenManager } from "../../utilities.js";

const GRAPHQL_URL = "https://api.producthunt.com/v2/api/graphql";

// ─── OAuth2 Token Management ──────────────────────────────────────

const phTokenManager = new TokenManager(async () => {
  const response = await fetch("https://api.producthunt.com/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CONFIG.PRODUCTHUNT_API_KEY,
      client_secret: CONFIG.PRODUCTHUNT_API_SECRET,
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Product Hunt OAuth failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return {
    token: data.access_token,
    // Token typically lasts ~2 weeks, refresh at 24h to be safe
    expiresInMs: 86_400_000,
  };
});

// ─── GraphQL Query ────────────────────────────────────────────────

const POSTS_QUERY = `
  query {
    posts(order: VOTES, first: 20) {
      edges {
        node {
          id
          name
          tagline
          description
          url
          votesCount
          commentsCount
          website
          thumbnail {
            url
          }
          topics(first: 5) {
            edges {
              node {
                name
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Map Product Hunt topics to a unified category.
 */
function mapTopicToCategory(topics) {
  const topicNames = topics.map((t) => t.toLowerCase());

  if (topicNames.some((t) => t.includes("gaming") || t.includes("game")))
    return "gaming";
  if (topicNames.some((t) => t.includes("developer") || t.includes("api")))
    return "software";
  if (topicNames.some((t) => t.includes("home") || t.includes("smart home")))
    return "home";
  if (topicNames.some((t) => t.includes("health") || t.includes("fitness")))
    return "sports";
  if (
    topicNames.some((t) => t.includes("productivity") || t.includes("office"))
  )
    return "office";

  // Default for Product Hunt — mostly tech/software
  return "tech";
}

/**
 * Fetch today's trending products from Product Hunt.
 */
export async function fetchProductHuntTrending() {
  if (!CONFIG.PRODUCTHUNT_API_KEY || !CONFIG.PRODUCTHUNT_API_SECRET) {
    throw new Error(
      "PRODUCTHUNT_API_KEY and PRODUCTHUNT_API_SECRET not configured",
    );
  }

  const token = await phTokenManager.getToken();

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: POSTS_QUERY }),
  });

  if (!response.ok) {
    // Invalidate cached token on auth failure
    if (response.status === 401) {
      phTokenManager.invalidate();
    }
    throw new Error(
      `Product Hunt API returned ${response.status}: ${await response.text()}`,
    );
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(
      `Product Hunt GraphQL errors: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const edges = data?.data?.posts?.edges || [];

  const products = edges.map((edge, index) => {
    const node = edge.node;
    const topics = node.topics?.edges?.map((e) => e.node.name) || [];

    const product = {
      sourceId: node.id,
      source: PRODUCT_SOURCES.PRODUCTHUNT,
      name: node.name,
      category: mapTopicToCategory(topics),
      sourceCategory: topics.join(", ") || "Tech",
      rank: index + 1,
      price: null,
      currency: null,
      rating: null,
      reviewCount: node.commentsCount || 0,
      imageUrl: node.thumbnail?.url || null,
      productUrl: node.url || node.website || null,
      description: node.tagline || node.description || null,
      trendingScore: 0,
      votesCount: node.votesCount || 0,
      fetchedAt: new Date(),
    };
    product.trendingScore = computeTrendingScore(product);
    return product;
  });

  return products;
}
