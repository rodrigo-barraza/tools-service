// ─── Standalone Workspace Agent Compiler Service ────────────────

import { execSync } from "node:child_process";
import { getErrorMessage } from "@rodrigo-barraza/utilities-library";
import { existsSync } from "node:fs";
import { readFile, writeFile, copyFile, rm, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import crypto from "node:crypto";
import CONFIG from "../config.ts";
import logger from "../logger.ts";
import MinioService from "./MinioService.ts";
import { resolveAgentSecret } from "./AgentConnectionManager.ts";

export type CompilationTarget = "win-x64" | "mac-x64" | "mac-arm64" | "linux-x64";

const CACHE_DIRECTORY = resolve("/tmp/prism-sea");
const BASE_BINARIES_DIRECTORY = join(CACHE_DIRECTORY, "base");
const TEMPORARY_BUILD_DIRECTORY = join(CACHE_DIRECTORY, "build");
const NODE_VERSION = "26.1.0";
const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const AGENT_BUCKET = "artifacts";
const AGENT_WRAPPER_OBJECT_KEY = "workspace-service/workspace-agent.mjs";
const AGENT_CORE_OBJECT_KEY = "workspace-service/workspace-agent-core.mjs";

const DOWNLOAD_URLS: Record<CompilationTarget, string> = {
  "win-x64": `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`,
  "linux-x64": `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`,
  "mac-x64": `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`,
  "mac-arm64": `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
};

function transpileMjsToCjs(mjsCode: string): string {
  let cjsCode = mjsCode;
  cjsCode = cjsCode.replace(/export\s+(class|function|const|let|var)\s+/g, '$1 ');
  cjsCode = cjsCode.replace(/export\s+\{\s*[^}]+\s*\};?/g, '');
  cjsCode = cjsCode.replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, 'var $1 = require("$2")');
  cjsCode = cjsCode.replace(/import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/g, 'var { $1 } = require("$2")');
  return cjsCode;
}

async function ensureDirectoryExists(directoryPath: string) {
  if (!existsSync(directoryPath)) {
    await mkdir(directoryPath, { recursive: true });
  }
}

async function downloadBaseBinary(target: CompilationTarget, destinationPath: string): Promise<void> {
  const url = DOWNLOAD_URLS[target];
  logger.info(`[AgentCompiler] Downloading base Node.js binary for ${target} from ${url}…`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download base binary: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (target === "win-x64") {
    await writeFile(destinationPath, buffer);
  } else {
    const tarPath = `${destinationPath}.tar.gz`;
    await writeFile(tarPath, buffer);
    logger.info(`[AgentCompiler] Extracting bin/node from ${tarPath}…`);

    const extractDirectory = join(CACHE_DIRECTORY, `extract-${target}`);
    await ensureDirectoryExists(extractDirectory);

    try {
      execSync(`tar -xzf "${tarPath}" -C "${extractDirectory}"`);
      const extractedNodePath = join(
        extractDirectory,
        `node-v${NODE_VERSION}-${target === "linux-x64" ? "linux" : "darwin"}-${target === "mac-arm64" ? "arm64" : "x64"}`,
        "bin",
        "node"
      );
      await copyFile(extractedNodePath, destinationPath);
    } finally {
      await rm(tarPath, { force: true });
      await rm(extractDirectory, { recursive: true, force: true });
    }
  }

  logger.success(`[AgentCompiler] Base Node.js binary for ${target} cached successfully.`);
}

async function getBaseBinary(target: CompilationTarget): Promise<string> {
  await ensureDirectoryExists(BASE_BINARIES_DIRECTORY);
  const binaryFileName = target === "win-x64" ? "node.exe" : "node";
  const binaryPath = join(BASE_BINARIES_DIRECTORY, `${target}-${binaryFileName}`);

  if (!existsSync(binaryPath)) {
    await downloadBaseBinary(target, binaryPath);
  }

  return binaryPath;
}

/**
 * Reads agent source code, attempting MinIO first (works in Docker),
 * then falling back to the local filesystem (works in local dev).
 */
async function loadAgentSourceCode(): Promise<{ wrapperSource: string; coreSource: string }> {
  let wrapperSource: string | null = null;
  let coreSource: string | null = null;

  // Strategy 1: Fetch from MinIO (works in Docker / production)
  try {
    const wrapperStream = await MinioService.getObject(AGENT_BUCKET, AGENT_WRAPPER_OBJECT_KEY);
    wrapperSource = await streamToString(wrapperStream);

    const coreStream = await MinioService.getObject(AGENT_BUCKET, AGENT_CORE_OBJECT_KEY);
    coreSource = await streamToString(coreStream);

    logger.info("[AgentCompiler] Loaded agent source from MinIO.");
  } catch (minioError: unknown) {
    const minioErrorMessage = getErrorMessage(minioError);
    logger.warn(`[AgentCompiler] MinIO fetch failed (${minioErrorMessage}), falling back to local filesystem.`);
  }

  // Strategy 2: Fallback to local filesystem (vendor/ in Docker, or dev sibling)
  if (!wrapperSource || !coreSource) {
    const candidateDirectories = [
      resolve(process.cwd(), "vendor/workspace-agent"),
      resolve(process.cwd(), "../workspace-service/standalone"),
    ];

    for (const candidateDirectory of candidateDirectories) {
      try {
        const wrapperPath = join(candidateDirectory, "workspace-agent.mjs");
        const corePath = join(candidateDirectory, "workspace-agent-core.mjs");

        wrapperSource = await readFile(wrapperPath, "utf-8");
        coreSource = await readFile(corePath, "utf-8");

        logger.info(`[AgentCompiler] Loaded agent source from local filesystem: ${candidateDirectory}`);
        break;
      } catch {
        // Try next candidate
      }
    }

    if (!wrapperSource || !coreSource) {
      throw new Error(
        "Could not load workspace-agent source files from MinIO or any local filesystem path. " +
        "Ensure workspace-agent files are seeded to MinIO or available in vendor/workspace-agent/."
      );
    }
  }

  return { wrapperSource, coreSource };
}

function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

export default class AgentCompilerService {
  /**
   * Generates a pre-configured standalone workspace agent binary on-the-fly.
   * Resolves with the absolute path of the generated executable.
   * The caller is responsible for deleting the file after streaming.
   */
  static async compile(target: CompilationTarget): Promise<{ executablePath: string; fileName: string }> {
    // The socket refuses every agent while no secret is set, so build none
    // without it.
    const apiSecret = await resolveAgentSecret();
    if (!apiSecret) {
      throw new Error(
        "No workspace agent secret is configured (prism settings.workspace.agentSecret); an agent built without one could never connect.",
      );
    }

    const buildId = crypto.randomUUID();
    const buildPath = join(TEMPORARY_BUILD_DIRECTORY, buildId);
    await ensureDirectoryExists(buildPath);

    logger.info(`[AgentCompiler] Initiating compilation for target ${target} (Build ID: ${buildId})`);

    const baseBinaryPath = await getBaseBinary(target);
    const outputFileName = target === "win-x64" ? "workspace-agent.exe" : "workspace-agent";
    const finalExecutablePath = join(buildPath, outputFileName);

    // 1. Resolve the backend public WebSocket URL
    let publicBackendUrl = CONFIG.TOOLS_SERVICE_PUBLIC_URL || CONFIG.TOOLS_SERVICE_URL || "";
    if (publicBackendUrl.startsWith("http://")) {
      publicBackendUrl = publicBackendUrl.replace("http://", "ws://");
    } else if (publicBackendUrl.startsWith("https://")) {
      publicBackendUrl = publicBackendUrl.replace("https://", "wss://");
    }
    if (!publicBackendUrl.includes("/ws/agent")) {
      publicBackendUrl = publicBackendUrl.replace(/\/+$/, "") + "/ws/agent";
    }

    // 2. Load standalone workspace-agent.mjs & core source code
    const { wrapperSource, coreSource } = await loadAgentSourceCode();

    // Remove the core import line from the CLI wrapper and strip its shebang
    let agentSourceCode = wrapperSource
      .replace(/^#!.*\n/, "")
      .replace(
        /import\s+\{\s*WorkspaceAgent,\s*hostname\s*\}\s+from\s+['"]\.\/workspace-agent-core\.mjs['"];?/,
        ""
      );

    // Strip shebang from core and concatenate them
    const cleanCoreSource = coreSource.replace(/^#!.*\n/, "");
    agentSourceCode = cleanCoreSource + "\n" + agentSourceCode;

    // 3. Pre-bake credentials and backend connection parameters
    logger.info(`[AgentCompiler] Injecting backend: ${publicBackendUrl}`);
    agentSourceCode = agentSourceCode.replace(
      'let backendUrl = cliOptions.backend || process.env.WORKSPACE_BACKEND;',
      `let backendUrl = cliOptions.backend || process.env.WORKSPACE_BACKEND || "${publicBackendUrl}";`
    );
    agentSourceCode = agentSourceCode.replace(
      'let secret = cliOptions.secret;',
      `let secret = cliOptions.secret || "${apiSecret}";`
    );

    // 4. Transpile source code to CommonJS
    const transpiledCommonJsCode = transpileMjsToCjs(agentSourceCode);
    const tempCjsPath = join(buildPath, "workspace-agent.cjs");
    await writeFile(tempCjsPath, transpiledCommonJsCode, "utf-8");

    // 5. Write sea-config.json
    const prepBlobPath = join(buildPath, "sea-prep.blob");
    const seaConfig = {
      main: tempCjsPath,
      output: prepBlobPath,
      disableExperimentalSEAWarning: true,
    };
    const seaConfigPath = join(buildPath, "sea-config.json");
    await writeFile(seaConfigPath, JSON.stringify(seaConfig, null, 2), "utf-8");

    // 6. Generate preparation blob
    logger.info("[AgentCompiler] Compiling prep blob…");
    execSync(`node --experimental-sea-config "${seaConfigPath}"`, { cwd: buildPath });

    // 7. Inject blob into Node.js binary
    logger.info(`[AgentCompiler] Copying base binary and injecting SEA blob into ${outputFileName}…`);
    await copyFile(baseBinaryPath, finalExecutablePath);

    const prepBlobData = await readFile(prepBlobPath);
    // postject does not ship TypeScript declarations; use createRequire for CJS interop
    const { createRequire } = await import("node:module");
    const requireFromHere = createRequire(import.meta.url);
    const postject = requireFromHere("postject") as { inject: (filename: string, resourceName: string, resource: Buffer, options?: { sentinelFuse?: string }) => Promise<void> };
    await postject.inject(finalExecutablePath, "NODE_SEA_BLOB", prepBlobData, {
      sentinelFuse: SENTINEL_FUSE,
    });

    // 8. Re-sign macOS binary if applicable
    if (target.startsWith("mac")) {
      try {
        execSync(`codesign --sign - "${finalExecutablePath}"`);
      } catch (error: unknown) {
        const codesignError = getErrorMessage(error);
        logger.warn(`[AgentCompiler] Codesign skipped/failed: ${codesignError}`);
      }
    }

    // 9. Clean up build artifacts (keep final executable only)
    await rm(tempCjsPath, { force: true });
    await rm(seaConfigPath, { force: true });
    await rm(prepBlobPath, { force: true });

    logger.success(`[AgentCompiler] Completed compilation: ${finalExecutablePath}`);
    return { executablePath: finalExecutablePath, fileName: outputFileName };
  }

  static async cleanBuild(executablePath: string): Promise<void> {
    try {
      const buildDirectory = dirname(executablePath);
      if (buildDirectory.startsWith(TEMPORARY_BUILD_DIRECTORY)) {
        await rm(buildDirectory, { recursive: true, force: true });
      }
    } catch (error: unknown) {
      const cleanupError = getErrorMessage(error);
      logger.error(`[AgentCompiler] Clean build failed: ${cleanupError}`);
    }
  }
}
