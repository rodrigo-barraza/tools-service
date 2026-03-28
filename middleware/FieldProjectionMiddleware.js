// ============================================================
// Field Projection Middleware (Sparse Fieldsets)
// ============================================================
// Intercepts JSON responses and filters them to only include
// fields specified via ?fields=a,b,c.d query parameter.
// Supports dot-notation for nested paths (e.g. venue.name).
// When absent, the full response is returned unchanged.
// ============================================================

/**
 * Known wrapper keys that contain arrays of domain objects.
 * When projecting, these arrays' items get projected individually,
 * while top-level metadata (count, query, etc.) is preserved.
 */
const ARRAY_WRAPPER_KEYS = new Set([
  "events",
  "products",
  "trends",
  "articles",
  "earnings",
  "snapshots",
  "commodities",
  "predictions",
  "requests",
  "foods",
  "comparison",
  "places",
  "results",
  "stops",
]);

/**
 * Internal/MongoDB fields to always strip from API responses,
 * regardless of whether field projection is active.
 */
const INTERNAL_FIELDS = new Set(["_id", "__v", "firstSeen", "lastSeen"]);

/**
 * Pick only the specified field paths from an object.
 * Supports dot-notation paths (e.g. "venue.name").
 *
 * @param {object} obj - Source object
 * @param {string[]} fieldPaths - Array of dot-notation field paths
 * @returns {object} New object with only the requested fields
 */
function pickFields(obj, fieldPaths) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;

  const result = {};

  for (const path of fieldPaths) {
    const parts = path.split(".");
    let source = obj;
    let target = result;

    for (let i = 0; i < parts.length; i++) {
      const key = parts[i];
      if (source == null || typeof source !== "object") break;

      if (i === parts.length - 1) {
        // Leaf — copy the value
        if (key in source) {
          target[key] = source[key];
        }
      } else {
        // Branch — create nested object if needed
        if (!(key in target)) {
          target[key] = {};
        }
        target = target[key];
        source = source[key];
      }
    }
  }

  return result;
}

/**
 * Strip internal/MongoDB fields from an object (shallow).
 *
 * @param {object} obj - Source object
 * @returns {object} Cleaned object
 */
function stripInternal(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!INTERNAL_FIELDS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Apply field projection and internal-field stripping to a response body.
 *
 * @param {*} data - The original response body
 * @param {string[]|null} fields - Requested field paths, or null for no projection
 * @returns {*} Projected response
 */
function projectResponse(data, fields) {
  if (data == null || typeof data !== "object") return data;

  // Single array response (rare — e.g. /commodities/categories)
  if (Array.isArray(data)) {
    if (!fields) return data.map(stripInternal);
    return data.map((item) =>
      typeof item === "object" && item !== null
        ? pickFields(stripInternal(item), fields)
        : item,
    );
  }

  // Object response — check for wrapper arrays
  const cleaned = stripInternal(data);

  // Find wrapper array keys present in this response
  const wrapperKey = Object.keys(cleaned).find(
    (key) => ARRAY_WRAPPER_KEYS.has(key) && Array.isArray(cleaned[key]),
  );

  if (wrapperKey) {
    // Strip internal fields from array items
    cleaned[wrapperKey] = cleaned[wrapperKey].map(stripInternal);

    // Apply field projection to array items if requested
    if (fields) {
      const prefix = wrapperKey + ".";
      const hasWrapperPrefix = fields.some((f) => f.startsWith(prefix));

      // Separate fields targeting wrapper items vs top-level metadata
      const itemFields = [];
      const topFields = [];

      for (const f of fields) {
        if (f.startsWith(prefix)) {
          // "foods.name" → "name" (strip wrapper key prefix)
          itemFields.push(f.slice(prefix.length));
        } else if (f === wrapperKey) {
          // Just "foods" — keep entire array, no item projection
        } else if (hasWrapperPrefix) {
          // When wrapper-prefixed fields exist, non-prefixed fields
          // are treated as top-level metadata selectors
          topFields.push(f);
        } else {
          // No wrapper-prefixed fields at all — bare fields target items
          // (backward compatible: "name,value" → project each item)
          itemFields.push(f);
        }
      }

      // Project items only if there are item-level fields
      if (itemFields.length > 0) {
        cleaned[wrapperKey] = cleaned[wrapperKey].map((item) =>
          typeof item === "object" && item !== null
            ? pickFields(item, itemFields)
            : item,
        );
      }

      // If top-level metadata fields were specified, project those too
      if (topFields.length > 0) {
        const projected = pickFields(cleaned, topFields);
        projected[wrapperKey] = cleaned[wrapperKey];
        return projected;
      }
    }

    return cleaned;
  }

  // Plain object — apply projection directly
  if (fields) {
    return pickFields(cleaned, fields);
  }

  return cleaned;
}

/**
 * Express middleware that enables sparse fieldsets via ?fields=a,b,c.d.
 * Also strips internal MongoDB fields (_id, __v, etc.) from all responses.
 */
export function fieldProjectionMiddleware(req, res, next) {
  const fieldsParam = req.query.fields;
  const fields = fieldsParam
    ? fieldsParam
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    : null;

  // Override res.json to intercept the response
  const originalJson = res.json.bind(res);

  res.json = (data) => {
    return originalJson(projectResponse(data, fields));
  };

  next();
}
