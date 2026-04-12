// ============================================================
// Agentic Task Service — Persistent Task State Management
// ============================================================
// Provides a MongoDB-backed scratchpad for AI agents to track
// multi-step work items across context window boundaries.
//
// Tasks survive context truncation and memory consolidation,
// giving agents a reliable "working memory" for complex,
// multi-stage coding workflows.
//
// Schema is pre-wired for future multi-agent (swarm) support
// with owner/blocks/blockedBy fields, but single-agent CRUD
// is the current scope.
//
// Collection: agent_tasks
// ============================================================

import { getDB } from "../db.js";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const COLLECTION = "agent_tasks";
const COUNTER_COLLECTION = "agent_task_counters";

const VALID_STATUSES = ["pending", "in_progress", "completed"];

const MAX_TASKS_PER_PROJECT = 200;

// ────────────────────────────────────────────────────────────
// Collection Setup (called at server start)
// ────────────────────────────────────────────────────────────

export async function setupAgenticTaskCollection() {
  const db = getDB();
  const col = db.collection(COLLECTION);

  await col.createIndex({ project: 1, taskId: 1 }, { unique: true });
  await col.createIndex({ project: 1, status: 1 });
  await col.createIndex({ project: 1, createdAt: -1 });

  console.log(`   ✅ ${COLLECTION} indexes ensured`);
}

// ────────────────────────────────────────────────────────────
// Monotonic ID Generator (per-project)
// ────────────────────────────────────────────────────────────

async function nextTaskId(project) {
  const db = getDB();
  const result = await db.collection(COUNTER_COLLECTION).findOneAndUpdate(
    { _id: `task_${project}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return result.seq;
}

// ────────────────────────────────────────────────────────────
// CRUD Operations
// ────────────────────────────────────────────────────────────

/**
 * Create a new task.
 *
 * @param {string} project - Project scope (e.g. "retina", "prism")
 * @param {object} data
 * @param {string} data.subject - Brief title
 * @param {string} data.description - What needs to be done
 * @param {string} [data.status="pending"] - Initial status
 * @param {string} [data.activeForm] - Present continuous form for in_progress spinner (e.g. "Running tests")
 * @param {string} [data.conversationId] - Conversation that created this task
 * @param {object} [data.metadata] - Arbitrary key/value metadata
 * @returns {Promise<object>} Created task document
 */
export async function agenticTaskCreate(project, data) {
  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }
  if (!data.subject || typeof data.subject !== "string") {
    return { error: "'subject' is required (string)" };
  }
  if (!data.description || typeof data.description !== "string") {
    return { error: "'description' is required (string)" };
  }

  const status = data.status || "pending";
  if (!VALID_STATUSES.includes(status)) {
    return { error: `Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(", ")}` };
  }

  const db = getDB();
  const col = db.collection(COLLECTION);

  // Guard: cap tasks per project
  const count = await col.countDocuments({ project });
  if (count >= MAX_TASKS_PER_PROJECT) {
    return { error: `Task limit reached (${MAX_TASKS_PER_PROJECT}). Complete or delete existing tasks first.` };
  }

  const taskId = await nextTaskId(project);
  const now = new Date();

  const task = {
    project,
    taskId,
    subject: data.subject,
    description: data.description,
    status,
    // Present-continuous form shown in spinner when in_progress
    activeForm: data.activeForm || null,
    // Traceability — which conversation created/last touched this task
    conversationId: data.conversationId || null,
    // Swarm-ready fields (unused in single-agent mode)
    owner: data.owner || null,
    blocks: [],
    blockedBy: [],
    metadata: data.metadata || {},
    createdAt: now,
    updatedAt: now,
  };

  await col.insertOne(task);

  return {
    task: sanitize(task),
    message: `Task #${taskId} created: ${data.subject}`,
  };
}

/**
 * List tasks for a project, optionally filtered by status.
 *
 * @param {string} project
 * @param {object} [options]
 * @param {string} [options.status] - Filter by status
 * @param {number} [options.limit=50]
 * @returns {Promise<object>}
 */
export async function agenticTaskList(project, { status, limit = 50 } = {}) {
  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }

  if (status && !VALID_STATUSES.includes(status)) {
    return { error: `Invalid status filter '${status}'. Must be one of: ${VALID_STATUSES.join(", ")}` };
  }

  const db = getDB();
  const col = db.collection(COLLECTION);

  const filter = { project };
  if (status) filter.status = status;

  const tasks = await col
    .find(filter)
    .sort({ taskId: 1 })
    .limit(Math.min(limit, MAX_TASKS_PER_PROJECT))
    .toArray();

  // Summary counts
  const allTasks = await col.find({ project }).toArray();
  const summary = {
    total: allTasks.length,
    pending: allTasks.filter((t) => t.status === "pending").length,
    in_progress: allTasks.filter((t) => t.status === "in_progress").length,
    completed: allTasks.filter((t) => t.status === "completed").length,
  };

  return {
    project,
    tasks: tasks.map(sanitize),
    summary,
  };
}

/**
 * Get a single task by ID.
 *
 * @param {string} project
 * @param {number} taskId
 * @returns {Promise<object>}
 */
export async function agenticTaskGet(project, taskId) {
  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }

  const id = parseInt(taskId, 10);
  if (isNaN(id)) {
    return { error: "'taskId' must be a number" };
  }

  const db = getDB();
  const task = await db.collection(COLLECTION).findOne({ project, taskId: id });

  if (!task) {
    return { error: `Task #${id} not found in project '${project}'` };
  }

  return { task: sanitize(task) };
}

/**
 * Update a task's status, description, or metadata.
 *
 * @param {string} project
 * @param {number} taskId
 * @param {object} updates
 * @param {string} [updates.status]
 * @param {string} [updates.subject]
 * @param {string} [updates.description]
 * @param {string} [updates.activeForm] - Present continuous form for spinner
 * @param {string} [updates.conversationId] - Conversation performing the update
 * @param {object} [updates.metadata] - Merged with existing metadata
 * @returns {Promise<object>}
 */
export async function agenticTaskUpdate(project, taskId, updates) {
  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }

  const id = parseInt(taskId, 10);
  if (isNaN(id)) {
    return { error: "'taskId' must be a number" };
  }

  if (!updates || typeof updates !== "object") {
    return { error: "'updates' is required (object)" };
  }

  if (updates.status && updates.status !== "deleted" && !VALID_STATUSES.includes(updates.status)) {
    return { error: `Invalid status '${updates.status}'. Must be one of: ${VALID_STATUSES.join(", ")}, deleted` };
  }

  const db = getDB();
  const col = db.collection(COLLECTION);

  const existing = await col.findOne({ project, taskId: id });
  if (!existing) {
    return { error: `Task #${id} not found in project '${project}'` };
  }

  // Handle "deleted" as a special status — remove the task entirely
  if (updates.status === "deleted") {
    await col.deleteOne({ project, taskId: id });
    return {
      task: sanitize(existing),
      message: `Task #${id} deleted`,
      statusChange: { from: existing.status, to: "deleted" },
    };
  }

  const $set = { updatedAt: new Date() };

  if (updates.status) $set.status = updates.status;
  if (updates.subject) $set.subject = updates.subject;
  if (updates.description) $set.description = updates.description;
  if (updates.activeForm !== undefined) $set.activeForm = updates.activeForm;
  if (updates.conversationId) $set.conversationId = updates.conversationId;

  // Merge metadata (don't replace entirely)
  if (updates.metadata && typeof updates.metadata === "object") {
    for (const [key, value] of Object.entries(updates.metadata)) {
      $set[`metadata.${key}`] = value;
    }
  }

  await col.updateOne({ project, taskId: id }, { $set });

  const updated = await col.findOne({ project, taskId: id });

  return {
    task: sanitize(updated),
    message: `Task #${id} updated`,
    ...(updates.status && updates.status !== existing.status
      ? { statusChange: { from: existing.status, to: updates.status } }
      : {}),
  };
}

/**
 * Delete a task.
 *
 * @param {string} project
 * @param {number} taskId
 * @returns {Promise<object>}
 */
export async function agenticTaskDelete(project, taskId) {
  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }

  const id = parseInt(taskId, 10);
  if (isNaN(id)) {
    return { error: "'taskId' must be a number" };
  }

  const db = getDB();
  const col = db.collection(COLLECTION);

  const existing = await col.findOne({ project, taskId: id });
  if (!existing) {
    return { error: `Task #${id} not found in project '${project}'` };
  }

  // Clean up references in other tasks
  await col.updateMany(
    { project, blocks: id },
    { $pull: { blocks: id } },
  );
  await col.updateMany(
    { project, blockedBy: id },
    { $pull: { blockedBy: id } },
  );

  await col.deleteOne({ project, taskId: id });

  return {
    deleted: true,
    taskId: id,
    message: `Task #${id} deleted`,
  };
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** Strip MongoDB _id from API responses */
function sanitize(task) {
  if (!task) return null;
  const { _id, ...rest } = task;
  return rest;
}
