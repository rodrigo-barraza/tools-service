// ─────────────────────────────────────────────────────────────
// Re-export shared MongoDB singleton from utilities library.
// ─────────────────────────────────────────────────────────────

export { connectDB, getDB, setDBForTesting } from "@rodrigo-barraza/utilities-library/mongo";
