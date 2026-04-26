// ============================================================
// Tools API — Boot Sequence
// ============================================================
import { createVaultClient } from "./utils/vault-client.js";

const vault = createVaultClient({
  fallbackEnvFile: "../vault/.env",
});

const secrets = await vault.fetch();

for (const [key, value] of Object.entries(secrets)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

await import("./server.js");
