/**
 * tools-service reads two global settings from prism-service's database: the
 * workspace agent secret and `allowEnvFiles`. Both must come from the database
 * prism-service is configured with, so a live test that boots both services
 * on test databases never reads production's.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const requestedDatabases: string[] = [];

vi.mock("@rodrigo-barraza/utilities-library/service/mongo", () => ({
  getDatabase: () => ({
    client: {
      db: (name: string) => {
        requestedDatabases.push(name);
        return {
          collection: () => ({
            findOne: async () => ({
              data: { workspace: { agentSecret: `secret-of-${name}` }, security: { allowEnvFiles: false } },
            }),
          }),
        };
      },
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  requestedDatabases.length = 0;
});

describe("prism settings database", () => {
  it("reads the agent secret from prism-service's configured database", async () => {
    vi.stubEnv("PRISM_SERVICE_MONGO_DB_NAME", "prism_test_example");
    const { resolveAgentSecret } = await import("../AgentConnectionManager.ts");
    expect(await resolveAgentSecret()).toBe("secret-of-prism_test_example");
    expect(requestedDatabases).toEqual(["prism_test_example"]);
  });

  it("reads production's prism database when nothing names another", async () => {
    vi.stubEnv("PRISM_SERVICE_MONGO_DB_NAME", "");
    const { resolveAgentSecret } = await import("../AgentConnectionManager.ts");
    expect(await resolveAgentSecret()).toBe("secret-of-prism");
  });

  it("reads the file-security settings from the same database", async () => {
    vi.stubEnv("PRISM_SERVICE_MONGO_DB_NAME", "prism_test_example");
    const { agenticReadFile } = await import("../AgenticFileService.ts");
    // Any path refreshes the settings in the background, allowed or not.
    await agenticReadFile("/nonexistent/prism-settings-probe.txt");
    await vi.waitFor(() => expect(requestedDatabases).toContain("prism_test_example"));
    expect(requestedDatabases).not.toContain("prism");
  });
});
