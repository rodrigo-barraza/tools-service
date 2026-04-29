// ============================================================
// Tools API — Boot Sequence
// ============================================================
import { createVaultClient } from "@rodrigo-barraza/utilities/vault";

const vault = createVaultClient({
  localEnvFile: "./.env",
  fallbackEnvFile: "../vault-service/.env",
});

const secrets = await vault.fetch();

for (const [key, value] of Object.entries(secrets)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

await import("./server.js");
