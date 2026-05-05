/**
 * Shared test helpers for tools-service unit tests.
 *
 * NOTE: The old `BASE_URL` constant (pointing to localhost:5590) has been
 * removed. Tests now use supertest to mount routers in-process, or import
 * fetcher functions directly. See testApp.js for the app factory.
 */

/**
 * For backward compat with any remaining live tests in tests/live/.
 * @deprecated Use supertest + createTestApp() instead for unit tests.
 */
export const BASE_URL =
  process.env.TOOLS_TEST_URL || "http://localhost:5590";
