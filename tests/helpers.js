// ============================================================
// Test Helpers — Shared test utilities
// ============================================================

/**
 * Base URL for the tools-service under test.
 * Override via TOOLS_TEST_URL env var for remote testing.
 */
export const BASE_URL = process.env.TOOLS_TEST_URL || "http://localhost:5590";
