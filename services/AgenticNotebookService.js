// ============================================================
// Agentic Notebook Service — Jupyter .ipynb Editing
// ============================================================
// Provides structured editing of Jupyter Notebook files:
//   - list_cells: enumerate all cells with type/content preview
//   - get_cell: read a specific cell's full content
//   - insert_cell: add a new cell at a position
//   - replace_cell: update an existing cell's content/type
//   - delete_cell: remove a cell
//
// All operations respect the same ALLOWED_ROOTS sandbox as
// AgenticFileService. Notebooks are JSON (nbformat v4).
// ============================================================

import { readFile, writeFile } from "node:fs/promises";
import { validatePath } from "./AgenticFileService.js";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const VALID_ACTIONS = ["list_cells", "get_cell", "insert_cell", "replace_cell", "delete_cell"];
const VALID_CELL_TYPES = ["code", "markdown", "raw"];
const MAX_NOTEBOOK_SIZE = 10_485_760; // 10 MB

// ────────────────────────────────────────────────────────────
// Main Entry Point
// ────────────────────────────────────────────────────────────

/**
 * Edit a Jupyter notebook file.
 *
 * @param {string} path - Absolute path to .ipynb file
 * @param {object} options
 * @param {string} options.action - One of VALID_ACTIONS
 * @param {number} [options.cellIndex] - 0-based cell index (required for get/replace/delete/insert)
 * @param {string} [options.content] - Cell source content (for insert/replace)
 * @param {string} [options.cellType] - Cell type: "code", "markdown", "raw" (for insert/replace)
 * @returns {Promise<object>}
 */
export async function agenticNotebookEdit(path, { action, cellIndex, content, cellType } = {}) {
  // Validate path
  const validation = validatePath(path);
  if (!validation.safe) {
    return { error: validation.error };
  }
  const resolved = validation.resolved;

  // Validate file extension
  if (!resolved.endsWith(".ipynb")) {
    return { error: `File must be a .ipynb notebook. Got: ${resolved}` };
  }

  // Validate action
  if (!action || !VALID_ACTIONS.includes(action)) {
    return { error: `Invalid action '${action}'. Must be one of: ${VALID_ACTIONS.join(", ")}` };
  }

  // Read and parse notebook
  let notebook;
  try {
    const raw = await readFile(resolved, "utf-8");
    if (Buffer.byteLength(raw) > MAX_NOTEBOOK_SIZE) {
      return { error: `Notebook is too large (max ${MAX_NOTEBOOK_SIZE / 1024 / 1024} MB)` };
    }
    notebook = JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      // For insert_cell on a non-existent file, create a blank notebook
      if (action === "insert_cell") {
        notebook = createBlankNotebook();
      } else {
        return { error: `Notebook not found: ${resolved}` };
      }
    } else {
      return { error: `Failed to parse notebook: ${err.message}` };
    }
  }

  // Validate notebook structure
  if (!notebook.cells || !Array.isArray(notebook.cells)) {
    return { error: "Invalid notebook format — missing 'cells' array" };
  }

  const nbformat = notebook.nbformat || 4;
  if (nbformat < 4) {
    return { error: `Unsupported notebook format version ${nbformat}. Only nbformat 4+ is supported.` };
  }

  // Dispatch by action
  switch (action) {
    case "list_cells":
      return listCells(resolved, notebook);

    case "get_cell":
      return getCell(resolved, notebook, cellIndex);

    case "insert_cell":
      return insertCell(resolved, notebook, { cellIndex, content, cellType });

    case "replace_cell":
      return replaceCell(resolved, notebook, { cellIndex, content, cellType });

    case "delete_cell":
      return deleteCell(resolved, notebook, cellIndex);

    default:
      return { error: `Unknown action: ${action}` };
  }
}

// ────────────────────────────────────────────────────────────
// Actions
// ────────────────────────────────────────────────────────────

function listCells(filePath, notebook) {
  const cells = notebook.cells.map((cell, index) => {
    const source = Array.isArray(cell.source)
      ? cell.source.join("")
      : (cell.source || "");
    const lines = source.split("\n");

    return {
      index,
      cellType: cell.cell_type,
      lineCount: lines.length,
      // Show first 3 lines as preview
      preview: lines.slice(0, 3).join("\n").slice(0, 200),
      hasOutputs: (cell.outputs && cell.outputs.length > 0) || false,
    };
  });

  return {
    filePath,
    totalCells: cells.length,
    kernelSpec: notebook.metadata?.kernelspec?.display_name || null,
    language: notebook.metadata?.kernelspec?.language || null,
    cells,
  };
}

function getCell(filePath, notebook, cellIndex) {
  if (cellIndex == null || typeof cellIndex !== "number") {
    return { error: "'cellIndex' is required (number, 0-based)" };
  }
  if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
    return { error: `Cell index ${cellIndex} out of range (0–${notebook.cells.length - 1})` };
  }

  const cell = notebook.cells[cellIndex];
  const source = Array.isArray(cell.source)
    ? cell.source.join("")
    : (cell.source || "");

  const result = {
    filePath,
    cellIndex,
    cellType: cell.cell_type,
    source,
    lineCount: source.split("\n").length,
  };

  // Include outputs for code cells
  if (cell.cell_type === "code" && cell.outputs && cell.outputs.length > 0) {
    result.outputs = cell.outputs.map(summarizeOutput);
  }

  return result;
}

async function insertCell(filePath, notebook, { cellIndex, content, cellType }) {
  if (!content || typeof content !== "string") {
    return { error: "'content' is required for insert_cell (string)" };
  }

  const type = cellType || "code";
  if (!VALID_CELL_TYPES.includes(type)) {
    return { error: `Invalid cellType '${type}'. Must be one of: ${VALID_CELL_TYPES.join(", ")}` };
  }

  // Default: append at end
  const index = cellIndex != null ? cellIndex : notebook.cells.length;
  if (index < 0 || index > notebook.cells.length) {
    return { error: `Cell index ${index} out of range for insert (0–${notebook.cells.length})` };
  }

  const newCell = createCell(type, content);
  notebook.cells.splice(index, 0, newCell);

  await writeNotebook(filePath, notebook);

  return {
    filePath,
    action: "insert_cell",
    cellIndex: index,
    cellType: type,
    totalCells: notebook.cells.length,
    message: `Inserted ${type} cell at index ${index}`,
  };
}

async function replaceCell(filePath, notebook, { cellIndex, content, cellType }) {
  if (cellIndex == null || typeof cellIndex !== "number") {
    return { error: "'cellIndex' is required for replace_cell (number, 0-based)" };
  }
  if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
    return { error: `Cell index ${cellIndex} out of range (0–${notebook.cells.length - 1})` };
  }

  const existingCell = notebook.cells[cellIndex];
  const type = cellType || existingCell.cell_type;

  if (!VALID_CELL_TYPES.includes(type)) {
    return { error: `Invalid cellType '${type}'. Must be one of: ${VALID_CELL_TYPES.join(", ")}` };
  }

  // Update the cell in place
  if (content != null) {
    existingCell.source = content.split("\n").map(
      (line, i, arr) => (i < arr.length - 1 ? line + "\n" : line),
    );
  }
  if (cellType) {
    existingCell.cell_type = type;
    // Clear outputs when converting to non-code cell
    if (type !== "code") {
      delete existingCell.outputs;
      delete existingCell.execution_count;
    } else if (!existingCell.outputs) {
      existingCell.outputs = [];
      existingCell.execution_count = null;
    }
  }

  await writeNotebook(filePath, notebook);

  return {
    filePath,
    action: "replace_cell",
    cellIndex,
    cellType: type,
    totalCells: notebook.cells.length,
    message: `Replaced cell ${cellIndex} (${type})`,
  };
}

async function deleteCell(filePath, notebook, cellIndex) {
  if (cellIndex == null || typeof cellIndex !== "number") {
    return { error: "'cellIndex' is required for delete_cell (number, 0-based)" };
  }
  if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
    return { error: `Cell index ${cellIndex} out of range (0–${notebook.cells.length - 1})` };
  }

  const removed = notebook.cells.splice(cellIndex, 1)[0];

  await writeNotebook(filePath, notebook);

  return {
    filePath,
    action: "delete_cell",
    cellIndex,
    deletedCellType: removed.cell_type,
    totalCells: notebook.cells.length,
    message: `Deleted ${removed.cell_type} cell at index ${cellIndex}`,
  };
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function createCell(type, content) {
  const source = content.split("\n").map(
    (line, i, arr) => (i < arr.length - 1 ? line + "\n" : line),
  );

  if (type === "code") {
    return {
      cell_type: "code",
      execution_count: null,
      metadata: {},
      outputs: [],
      source,
    };
  }

  return {
    cell_type: type,
    metadata: {},
    source,
  };
}

function createBlankNotebook() {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
        version: "3.11.0",
      },
    },
    cells: [],
  };
}

/**
 * Summarize a cell output for the tool response.
 * Strips large binary data (images, etc.) and truncates long text.
 */
function summarizeOutput(output) {
  const summary = { output_type: output.output_type };

  if (output.output_type === "stream") {
    const text = Array.isArray(output.text) ? output.text.join("") : (output.text || "");
    summary.text = text.length > 2000 ? text.slice(0, 2000) + "\n... (truncated)" : text;
  } else if (output.output_type === "execute_result" || output.output_type === "display_data") {
    if (output.data?.["text/plain"]) {
      const text = Array.isArray(output.data["text/plain"])
        ? output.data["text/plain"].join("")
        : output.data["text/plain"];
      summary.text = text.length > 2000 ? text.slice(0, 2000) + "... (truncated)" : text;
    }
    if (output.data?.["image/png"]) {
      summary.hasImage = true;
    }
  } else if (output.output_type === "error") {
    summary.ename = output.ename;
    summary.evalue = output.evalue;
    const traceback = (output.traceback || []).join("\n");
    summary.traceback = traceback.length > 2000 ? traceback.slice(0, 2000) + "... (truncated)" : traceback;
  }

  return summary;
}

async function writeNotebook(filePath, notebook) {
  // Write with 1-space indentation (Jupyter standard) and trailing newline
  const json = JSON.stringify(notebook, null, 1) + "\n";
  await writeFile(filePath, json, "utf-8");
}
