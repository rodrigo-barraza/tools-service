// ─── Persistent Structured Datastore ─────────────────────────
//
// Queryable record store for agents — the structured counterpart to
// semantic memory. Records live in namespaces (datasets) scoped per
// project and SHARED across agents: a scheduled collector agent can
// write price history that a conversational agent later queries.
// Provenance (agent/username/session) is stamped on every record.
//
// Identity (project/agent/username) arrives via trusted orchestrator
// body-injection + X-headers — never from model-supplied args.

import { getDatabase } from "@rodrigo-barraza/utilities-library/service/mongo";
import { ObjectId } from "mongodb";
import logger from "../logger.ts";
import type {
  DatastoreRecord,
  DatastoreProvenance,
  DatastoreQueryOptions,
  DatastoreDeleteOptions,
  SanitizedDatastoreRecord,
} from "../types/agentic.ts";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const COLLECTION = "agent_datastore";

const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const MAX_BATCH_SIZE = 200;
const MAX_RECORD_BYTES = 32 * 1024;
const MAX_RECORDS_PER_NAMESPACE = 50_000;
const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 200;
const MAX_PIPELINE_STAGES = 12;

/** Top-level record fields queryable without the `data.` prefix. */
const META_FIELDS = new Set([
  "key",
  "agent",
  "username",
  "createdAt",
  "updatedAt",
]);

/** Logical operators whose values are arrays of sub-filters. */
const LOGICAL_OPERATORS = new Set(["$and", "$or", "$nor"]);

/** Operators that execute code or escape the namespace — always rejected. */
const FORBIDDEN_OPERATORS = new Set([
  "$where",
  "$function",
  "$accumulator",
  "$lookup",
  "$graphLookup",
  "$unionWith",
  "$merge",
  "$out",
  "$facet",
  "$documents",
]);

const ALLOWED_PIPELINE_STAGES = new Set([
  "$match",
  "$group",
  "$sort",
  "$project",
  "$limit",
  "$skip",
  "$unwind",
  "$count",
  "$addFields",
  "$sortByCount",
]);

// ────────────────────────────────────────────────────────────
// Collection Setup (called at server start)
// ────────────────────────────────────────────────────────────

export async function setupAgenticDatastoreCollection() {
  const database = getDatabase();
  const collection = database.collection(COLLECTION);

  await collection.createIndex(
    { project: 1, namespace: 1, key: 1 },
    { unique: true, partialFilterExpression: { key: { $type: "string" } } },
  );
  await collection.createIndex({ project: 1, namespace: 1, updatedAt: -1 });

  logger.info(`   ✅ ${COLLECTION} indexes ensured`);
}

// ────────────────────────────────────────────────────────────
// Validation & Query Rewriting (pure — unit tested)
// ────────────────────────────────────────────────────────────

export function isValidNamespace(namespace: unknown): namespace is string {
  return typeof namespace === "string" && NAMESPACE_PATTERN.test(namespace);
}

/**
 * Recursively reject filters/pipelines containing operators that execute
 * code ($where, $function, …) or escape the namespace ($lookup, $out, …).
 */
export function assertNoForbiddenOperators(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = assertNoForbiddenOperators(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_OPERATORS.has(k)) return k;
      const found = assertNoForbiddenOperators(v);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Map a model-facing field name onto the stored document shape:
 * meta fields (key, agent, createdAt, …) stay top-level, everything
 * else addresses the record payload under `data.`.
 */
export function prefixField(field: string): string {
  if (META_FIELDS.has(field) || field.startsWith("data.")) return field;
  return `data.${field}`;
}

/**
 * Rewrite a model-supplied filter so field names address `data.*`,
 * recursing through $and/$or/$nor. Operator objects on a field
 * ({price: {$gte: 5}}) pass through untouched.
 */
export function prefixFilter(
  filter: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (LOGICAL_OPERATORS.has(k) && Array.isArray(v)) {
      out[k] = v.map((sub) =>
        sub && typeof sub === "object" && !Array.isArray(sub)
          ? prefixFilter(sub as Record<string, unknown>)
          : sub,
      );
    } else if (k.startsWith("$")) {
      out[k] = v;
    } else {
      out[prefixField(k)] = v;
    }
  }
  return out;
}

/**
 * Validate a model-supplied aggregation pipeline: array of single-stage
 * objects, whitelisted stages only, no forbidden operators anywhere.
 * Returns an error string or null.
 */
export function validatePipeline(pipeline: unknown): string | null {
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    return "'pipeline' must be a non-empty array of aggregation stages";
  }
  if (pipeline.length > MAX_PIPELINE_STAGES) {
    return `'pipeline' exceeds the maximum of ${MAX_PIPELINE_STAGES} stages`;
  }
  for (const stage of pipeline) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      return "Each pipeline stage must be an object with a single $-stage key";
    }
    const keys = Object.keys(stage);
    if (keys.length !== 1) {
      return `Each pipeline stage must have exactly one key, got: ${keys.join(", ")}`;
    }
    if (!ALLOWED_PIPELINE_STAGES.has(keys[0])) {
      return `Pipeline stage '${keys[0]}' is not allowed. Allowed stages: ${[...ALLOWED_PIPELINE_STAGES].join(", ")}`;
    }
  }
  const forbidden = assertNoForbiddenOperators(pipeline);
  if (forbidden) {
    return `Operator '${forbidden}' is not allowed`;
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function sanitizeRecord(doc: DatastoreRecord): SanitizedDatastoreRecord {
  return {
    id: doc._id ? doc._id.toString() : null,
    key: doc.key ?? null,
    data: doc.data,
    agent: doc.agent ?? null,
    username: doc.username ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ────────────────────────────────────────────────────────────
// Write
// ────────────────────────────────────────────────────────────

/**
 * Insert or upsert records into a namespace. When `keyField` is given,
 * each record's value at that field becomes its unique key within the
 * namespace and existing records with the same key are replaced.
 */
export async function datastoreWrite(
  project: string,
  namespace: unknown,
  records: unknown,
  keyField: unknown,
  provenance: DatastoreProvenance,
) {
  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }
  if (!isValidNamespace(namespace)) {
    return {
      error:
        "'namespace' is required: lowercase letters, digits, hyphens or underscores, max 64 chars (e.g. 'workout-logs')",
    };
  }
  if (!Array.isArray(records) || records.length === 0) {
    return { error: "'records' must be a non-empty array of objects" };
  }
  if (records.length > MAX_BATCH_SIZE) {
    return { error: `'records' exceeds the maximum batch size of ${MAX_BATCH_SIZE}` };
  }
  if (keyField !== undefined && keyField !== null && typeof keyField !== "string") {
    return { error: "'keyField' must be a string (the name of a field within each record)" };
  }

  const keyed: { key: string | null; data: Record<string, unknown> }[] = [];
  for (const [index, record] of records.entries()) {
    if (!isPlainObject(record)) {
      return { error: `records[${index}] is not a plain object` };
    }
    if (JSON.stringify(record).length > MAX_RECORD_BYTES) {
      return {
        error: `records[${index}] exceeds the maximum record size of ${MAX_RECORD_BYTES / 1024}KB`,
      };
    }
    let key: string | null = null;
    if (keyField) {
      const keyValue = record[keyField];
      if (keyValue === undefined || keyValue === null) {
        return {
          error: `records[${index}] is missing keyField '${keyField}'`,
        };
      }
      if (typeof keyValue === "object") {
        return {
          error: `records[${index}].${keyField} must be a string, number, or boolean to be used as a key`,
        };
      }
      key = String(keyValue);
    }
    keyed.push({ key, data: record });
  }

  const database = getDatabase();
  const collection = database.collection<DatastoreRecord>(COLLECTION);

  const existing = await collection.countDocuments({ project, namespace });
  if (existing + keyed.length > MAX_RECORDS_PER_NAMESPACE) {
    return {
      error: `Namespace '${namespace}' would exceed ${MAX_RECORDS_PER_NAMESPACE} records (currently ${existing}). Delete old records first.`,
    };
  }

  const now = new Date();
  const stamp = {
    agent: provenance.agent ?? null,
    username: provenance.username ?? null,
  };

  let inserted: number;
  let updated = 0;

  if (keyField) {
    const result = await collection.bulkWrite(
      keyed.map(({ key, data }) => ({
        updateOne: {
          filter: { project, namespace, key: key as string },
          update: {
            $set: { data, updatedAt: now, ...stamp },
            $setOnInsert: { project, namespace, key, createdAt: now },
          },
          upsert: true,
        },
      })),
    );
    inserted = result.upsertedCount;
    updated = result.modifiedCount;
  } else {
    const result = await collection.insertMany(
      keyed.map(({ data }) => ({
        project,
        namespace,
        key: null,
        data,
        ...stamp,
        createdAt: now,
        updatedAt: now,
      })) as DatastoreRecord[],
    );
    inserted = result.insertedCount;
  }

  const total = await collection.countDocuments({ project, namespace });
  return { namespace, inserted, updated, totalInNamespace: total };
}

// ────────────────────────────────────────────────────────────
// Query
// ────────────────────────────────────────────────────────────

/**
 * Query records in a namespace with Mongo-style filter/sort/projection,
 * or run a whitelisted aggregation pipeline. Called without a namespace,
 * lists all namespaces in the project with counts and sample fields.
 */
export async function datastoreQuery(
  project: string,
  namespace: unknown,
  options: DatastoreQueryOptions,
) {
  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }

  const database = getDatabase();
  const collection = database.collection<DatastoreRecord>(COLLECTION);

  // ── Namespace discovery mode ──
  if (namespace === undefined || namespace === null || namespace === "") {
    const namespaces = await collection
      .aggregate([
        { $match: { project } },
        {
          $group: {
            _id: "$namespace",
            count: { $sum: 1 },
            lastUpdated: { $max: "$updatedAt" },
          },
        },
        { $sort: { lastUpdated: -1 } },
        { $limit: 100 },
      ])
      .toArray();

    const described = await Promise.all(
      namespaces.map(async (ns) => {
        const sample = await collection.findOne(
          { project, namespace: ns._id as string },
          { sort: { updatedAt: -1 } },
        );
        return {
          namespace: ns._id as string,
          count: ns.count as number,
          lastUpdated: ns.lastUpdated as Date,
          fields: sample ? Object.keys(sample.data).slice(0, 25) : [],
        };
      }),
    );
    return { namespaces: described };
  }

  if (!isValidNamespace(namespace)) {
    return { error: `Invalid namespace '${String(namespace)}'` };
  }

  const forbidden = assertNoForbiddenOperators(options.filter ?? null);
  if (forbidden) {
    return { error: `Operator '${forbidden}' is not allowed in 'filter'` };
  }

  // ── Aggregation mode ──
  if (options.pipeline !== undefined) {
    const pipelineError = validatePipeline(options.pipeline);
    if (pipelineError) return { error: pipelineError };

    const pipeline = [
      { $match: { project, namespace } },
      { $project: { project: 0, namespace: 0 } },
      ...(options.pipeline as Record<string, unknown>[]),
    ];
    const hasLimit = (options.pipeline as Record<string, unknown>[]).some(
      (stage) => "$limit" in stage || "$count" in stage,
    );
    if (!hasLimit) pipeline.push({ $limit: MAX_QUERY_LIMIT });

    const results = await collection
      .aggregate(pipeline, { allowDiskUse: false })
      .toArray();
    return { namespace, results, count: results.length };
  }

  // ── Find mode ──
  if (options.filter !== undefined && !isPlainObject(options.filter)) {
    return { error: "'filter' must be an object (Mongo-style query)" };
  }
  const filter = {
    project,
    namespace,
    ...(options.filter ? prefixFilter(options.filter) : {}),
  };

  let sort: Record<string, 1 | -1> = { updatedAt: -1 };
  if (options.sort !== undefined) {
    if (!isPlainObject(options.sort)) {
      return { error: "'sort' must be an object like {\"date\": -1}" };
    }
    sort = {};
    for (const [field, direction] of Object.entries(options.sort)) {
      if (direction !== 1 && direction !== -1) {
        return { error: `sort.${field} must be 1 (ascending) or -1 (descending)` };
      }
      sort[prefixField(field)] = direction;
    }
  }

  const limit = Math.min(
    Math.max(1, Math.trunc(Number(options.limit) || DEFAULT_QUERY_LIMIT)),
    MAX_QUERY_LIMIT,
  );
  const skip = Math.max(0, Math.trunc(Number(options.skip) || 0));

  let projection: Record<string, 1> | undefined;
  if (options.fields !== undefined) {
    if (
      !Array.isArray(options.fields) ||
      options.fields.some((f) => typeof f !== "string")
    ) {
      return { error: "'fields' must be an array of field-name strings" };
    }
    projection = {};
    for (const field of options.fields) {
      projection[prefixField(field)] = 1;
    }
    projection["key"] = 1;
    projection["createdAt"] = 1;
    projection["updatedAt"] = 1;
  }

  const [records, total] = await Promise.all([
    collection
      .find(filter, { projection })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  return {
    namespace,
    records: records.map(sanitizeRecord),
    count: records.length,
    total,
    skip,
  };
}

// ────────────────────────────────────────────────────────────
// Delete
// ────────────────────────────────────────────────────────────

/**
 * Delete records from a namespace by ids, by filter, or (with the
 * explicit all flag) the entire namespace.
 */
export async function datastoreDelete(
  project: string,
  namespace: unknown,
  options: DatastoreDeleteOptions,
) {
  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }
  if (!isValidNamespace(namespace)) {
    return { error: "'namespace' is required (string)" };
  }

  const database = getDatabase();
  const collection = database.collection<DatastoreRecord>(COLLECTION);

  if (Array.isArray(options.ids) && options.ids.length > 0) {
    const objectIds: ObjectId[] = [];
    for (const id of options.ids) {
      if (typeof id !== "string" || !ObjectId.isValid(id)) {
        return { error: `'${String(id)}' is not a valid record id` };
      }
      objectIds.push(new ObjectId(id));
    }
    const result = await collection.deleteMany({
      project,
      namespace,
      _id: { $in: objectIds },
    });
    return { namespace, deleted: result.deletedCount };
  }

  if (isPlainObject(options.filter) && Object.keys(options.filter).length > 0) {
    const forbidden = assertNoForbiddenOperators(options.filter);
    if (forbidden) {
      return { error: `Operator '${forbidden}' is not allowed in 'filter'` };
    }
    const result = await collection.deleteMany({
      project,
      namespace,
      ...prefixFilter(options.filter),
    });
    return { namespace, deleted: result.deletedCount };
  }

  if (options.all === true) {
    const result = await collection.deleteMany({ project, namespace });
    return { namespace, deleted: result.deletedCount };
  }

  return {
    error:
      "Provide 'ids', a non-empty 'filter', or 'all: true' to delete an entire namespace",
  };
}
