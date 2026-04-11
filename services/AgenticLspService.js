import { spawn } from "child_process";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import { pathToFileURL, fileURLToPath } from "url";
import { extname, dirname, basename, resolve } from "path";
import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { validatePath } from "./AgenticFileService.js";
import logger from "../logger.js";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

class LspClient {
  constructor(directory, command, args) {
    this.directory = directory;
    this.command = command;
    this.args = args;
    this.process = null;
    this.connection = null;
    this.isInitialized = false;
    this.openFiles = new Set();
    this.lastUsed = Date.now();
    this.idleTimer = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      logger.info(`Starting LSP server: ${this.command} ${this.args.join(" ")} in ${this.directory}`);
      try {
        this.process = spawn(this.command, this.args, {
          cwd: this.directory,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });

        if (!this.process.stdout || !this.process.stdin) {
          throw new Error("LSP server process stdio not available");
        }

        this.process.on("error", (err) => {
          logger.error(`LSP process error: ${err.message}`);
          reject(err);
        });

        this.process.on("exit", (code) => {
          logger.info(`LSP process exited with code ${code}`);
          this.isInitialized = false;
        });

        if (this.process.stderr) {
          this.process.stderr.on("data", (data) => {
            const output = data.toString().trim();
            if (output && !output.includes("Debugger attached")) logger.info(`[LSP ${this.command}] ${output}`);
          });
        }

        const reader = new StreamMessageReader(this.process.stdout);
        const writer = new StreamMessageWriter(this.process.stdin);
        this.connection = createMessageConnection(reader, writer);

        this.connection.onClose(() => {
          this.isInitialized = false;
        });

        this.connection.listen();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  async initialize() {
    if (!this.connection) throw new Error("LSP client not started");

    const params = {
      processId: process.pid,
      rootUri: pathToFileURL(this.directory).href,
      capabilities: {},
      workspaceFolders: [
        { uri: pathToFileURL(this.directory).href, name: basename(this.directory) },
      ],
    };

    await this.connection.sendRequest("initialize", params);
    await this.connection.sendNotification("initialized", {});
    this.isInitialized = true;
    this.resetIdleTimer();
    logger.success(`LSP server initialized for ${this.directory}`);
  }

  resetIdleTimer() {
    this.lastUsed = Date.now();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), IDLE_TIMEOUT_MS);
  }

  getLanguageId(filePath) {
    const ext = extname(filePath).toLowerCase();
    const map = {
      ".js": "javascript",
      ".ts": "typescript",
      ".jsx": "javascriptreact",
      ".tsx": "typescriptreact",
      ".py": "python",
    };
    return map[ext] || "plaintext";
  }

  async ensureFileOpen(filePath) {
    this.resetIdleTimer();
    const uri = pathToFileURL(filePath).href;
    if (!this.openFiles.has(uri)) {
      const content = await readFile(filePath, "utf-8");
      await this.connection.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: this.getLanguageId(filePath),
          version: 1,
          text: content,
        },
      });
      this.openFiles.add(uri);
    }
  }

  async sendRequest(method, params) {
    this.resetIdleTimer();
    if (!this.isInitialized) throw new Error("LSP not initialized");
    return this.connection.sendRequest(method, params);
  }

  async stop() {
    logger.info(`Stopping LSP server for ${this.directory}`);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.connection) {
      try {
        await this.connection.sendRequest("shutdown");
        await this.connection.sendNotification("exit");
      } catch (e) {}
      this.connection.dispose();
      this.connection = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.isInitialized = false;
  }
}

class LspServerManager {
  constructor() {
    this.servers = new Map(); // "root_dir|lang" -> LspClient
  }

  getLanguageConfig(filePath) {
    const ext = extname(filePath).toLowerCase();
    if ([".js", ".ts", ".jsx", ".tsx"].includes(ext)) {
      // NOTE: typescript-language-server usually expects `--stdio` parameter
      return { lang: "ts", command: "npx", args: ["typescript-language-server", "--stdio"] };
    }
    if ([".py"].includes(ext)) {
      return { lang: "py", command: "npx", args: ["pyright-langserver", "--stdio"] }; 
      // pyright npm wrapper allows executing via npx
    }
    return null;
  }

  async getClientForFile(filePath, rootDir) {
    const config = this.getLanguageConfig(filePath);
    if (!config) {
      throw new Error(`No language server configured for file extension ${extname(filePath)}`);
    }

    const key = `${rootDir}|${config.lang}`;
    if (this.servers.has(key)) {
      const client = this.servers.get(key);
      if (client.isInitialized) return client;
      this.servers.delete(key);
    }

    const client = new LspClient(rootDir, config.command, config.args);
    await client.start();
    await client.initialize();
    this.servers.set(key, client);
    return client;
  }
  
  async ensureFileReady(filePath, rootDir) {
     const client = await this.getClientForFile(filePath, rootDir);
     await client.ensureFileOpen(filePath);
     return client;
  }
}

const manager = new LspServerManager();

async function findProjectRoot(filePath) {
  let current = dirname(filePath);
  while (current && current !== "/") {
    if (existsSync(resolve(current, "package.json")) || existsSync(resolve(current, ".git")) || existsSync(resolve(current, "requirements.txt"))) {
      return current;
    }
    current = dirname(current);
  }
  return dirname(filePath);
}

function processLspLocations(result) {
  if (!result) return [];
  const locations = Array.isArray(result) ? result : [result];
  return locations.map(loc => {
    const uri = loc.targetUri || loc.uri;
    const range = loc.targetSelectionRange || loc.range;
    return {
      file: fileURLToPath(uri),
      line: range.start.line + 1, // LSP is 0-indexed, UI is 1-indexed
      character: range.start.character + 1
    };
  });
}

function parseParams(reqBody) {
  const { path, line, character } = reqBody;
  const validation = validatePath(path);
  if (!validation.safe) {
    throw new Error(validation.error);
  }
  return {
    resolved: validation.resolved,
    line: line ? parseInt(line, 10) : 1,
    character: character ? parseInt(character, 10) : 1
  };
}

export async function agenticLspDefinition(reqBody) {
  try {
    const { resolved, line, character } = parseParams(reqBody);
    const root = await findProjectRoot(resolved);
    const client = await manager.ensureFileReady(resolved, root);
    
    const result = await client.sendRequest("textDocument/definition", {
      textDocument: { uri: pathToFileURL(resolved).href },
      position: { line: line - 1, character: character - 1 }
    });
    
    return { results: processLspLocations(result) };
  } catch (err) {
    return { error: `LSP Definition failed: ${err.message}` };
  }
}

export async function agenticLspReferences(reqBody) {
  try {
    const { resolved, line, character } = parseParams(reqBody);
    const root = await findProjectRoot(resolved);
    const client = await manager.ensureFileReady(resolved, root);
    
    const result = await client.sendRequest("textDocument/references", {
      textDocument: { uri: pathToFileURL(resolved).href },
      position: { line: line - 1, character: character - 1 },
      context: { includeDeclaration: true }
    });
    
    return { results: processLspLocations(result) };
  } catch (err) {
    return { error: `LSP References failed: ${err.message}` };
  }
}

export async function agenticLspHover(reqBody) {
  try {
    const { resolved, line, character } = parseParams(reqBody);
    const root = await findProjectRoot(resolved);
    const client = await manager.ensureFileReady(resolved, root);
    
    const result = await client.sendRequest("textDocument/hover", {
      textDocument: { uri: pathToFileURL(resolved).href },
      position: { line: line - 1, character: character - 1 }
    });
    
    if (!result || !result.contents) return { contents: null };
    
    let contentStr = "";
    if (typeof result.contents === "string") {
      contentStr = result.contents;
    } else if (result.contents.value) {
      contentStr = result.contents.value;
    } else if (Array.isArray(result.contents)) {
      contentStr = result.contents.map(c => typeof c === "string" ? c : c.value).join("\n");
    }
    
    return { contents: contentStr };
  } catch (err) {
    return { error: `LSP Hover failed: ${err.message}` };
  }
}

export async function agenticLspDocumentSymbols(reqBody) {
  try {
    const validation = validatePath(reqBody.path);
    if (!validation.safe) throw new Error(validation.error);
    const resolved = validation.resolved;
    
    const root = await findProjectRoot(resolved);
    const client = await manager.ensureFileReady(resolved, root);
    
    const result = await client.sendRequest("textDocument/documentSymbol", {
      textDocument: { uri: pathToFileURL(resolved).href }
    });
    
    const items = [];
    const walk = (symbols, prefix = "") => {
      for (const sym of symbols) {
        if (!sym) continue;
        const kindMap = {
          1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
          6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
          11: "Interface", 12: "Function", 13: "Variable", 14: "Constant", 15: "String",
          16: "Number", 17: "Boolean", 18: "Array", 19: "Object", 20: "Key",
          21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event", 25: "Operator",
          26: "TypeParameter"
        };
        const kind = kindMap[sym.kind] || "Symbol";
        const line = sym.selectionRange ? sym.selectionRange.start.line + 1 : (sym.range ? sym.range.start.line + 1 : "?");
        items.push(`[Line ${line}] ${kind}: ${prefix}${sym.name}`);
        if (sym.children && sym.children.length > 0) {
          walk(sym.children, `${prefix}${sym.name}.`);
        }
      }
    };
    
    if (result) walk(result);
    return { symbols: items };
  } catch (err) {
    return { error: `LSP DocumentSymbols failed: ${err.message}` };
  }
}
