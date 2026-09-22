// ─── LOGO Language Interpreter for Turtle Graphics ─────────────────
//
// A self-contained UCBLogo-compatible interpreter that tokenizes, parses,
// and executes LOGO source code, recording turtle drawing commands as
// a JSON command log for animated Canvas replay in the browser.
//
// Supports: turtle movement, pen control, drawing primitives, control
// flow (repeat, for, if/ifelse, to/end procedures with recursion),
// variables (make/thing/:var), math functions, and the standard 16-color
// LOGO palette.

import { getErrorMessage } from "@rodrigo-barraza/utilities-library";

// ─── Types ──────────────────────────────────────────────────────────

export interface LogoExecutionResult {
  success: boolean;
  commands: Record<string, unknown>[];
  canvasWidth: number;
  canvasHeight: number;
  background: string;
  error?: string;
  executionTimeMs: number;
}

interface LogoCommand {
  [key: string]: unknown;
  action: string;
  value?: string;
  value2?: string;
  x?: number;
  y?: number;
  color?: string;
  text?: string;
  fontSize?: number;
}

interface LogoProcedure {
  name: string;
  parameters: string[];
  body: LogoToken[];
}

// ─── Constants ──────────────────────────────────────────────────────

const MAX_EXECUTION_STEPS = 500_000;
const MAX_COMMAND_LOG_SIZE = 50_000;
export const DEFAULT_CANVAS_WIDTH = 800;
export const DEFAULT_CANVAS_HEIGHT = 600;

const LOGO_COLOR_PALETTE: Record<number, string> = {
  0: "#000000",   // black
  1: "#0000ff",   // blue
  2: "#00c000",   // green
  3: "#00ffff",   // cyan
  4: "#ff0000",   // red
  5: "#ff00ff",   // magenta
  6: "#ffff00",   // yellow
  7: "#ffffff",   // white
  8: "#a0522d",   // brown
  9: "#d2b48c",   // tan
  10: "#228b22",  // forest
  11: "#00ced1",  // aqua
  12: "#fa8072",  // salmon
  13: "#800080",  // purple
  14: "#ffa500",  // orange
  15: "#808080",  // grey
};

// ─── Tokenizer ──────────────────────────────────────────────────────

const LogoTokenType = {
  Word: "word",
  Number: "number",
  Variable: "variable",       // :varname
  QuotedWord: "quoted",       // "word
  OpenBracket: "open_bracket",
  CloseBracket: "close_bracket",
  OpenParen: "open_paren",
  CloseParen: "close_paren",
  Operator: "operator",       // + - * / = < > <= >= <>
  Newline: "newline",
} as const;
type LogoTokenType = (typeof LogoTokenType)[keyof typeof LogoTokenType];

interface LogoToken {
  type: LogoTokenType;
  value: string;
  line: number;
}

function tokenizeLogoSource(source: string): LogoToken[] {
  const tokens: LogoToken[] = [];
  let position = 0;
  let lineNumber = 1;

  // Normalize line endings
  const normalizedSource = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (position < normalizedSource.length) {
    const character = normalizedSource[position];

    // Skip whitespace (but not newlines)
    if (character === " " || character === "\t") {
      position++;
      continue;
    }

    // Newline
    if (character === "\n") {
      tokens.push({ type: LogoTokenType.Newline, value: "\n", line: lineNumber });
      lineNumber++;
      position++;
      continue;
    }

    // Line continuation with tilde
    if (character === "~" && position + 1 < normalizedSource.length && normalizedSource[position + 1] === "\n") {
      lineNumber++;
      position += 2;
      continue;
    }

    // Comments (semicolon to end of line)
    if (character === ";") {
      while (position < normalizedSource.length && normalizedSource[position] !== "\n") {
        position++;
      }
      continue;
    }

    // Brackets
    if (character === "[") {
      tokens.push({ type: LogoTokenType.OpenBracket, value: "[", line: lineNumber });
      position++;
      continue;
    }
    if (character === "]") {
      tokens.push({ type: LogoTokenType.CloseBracket, value: "]", line: lineNumber });
      position++;
      continue;
    }

    // Parentheses
    if (character === "(") {
      tokens.push({ type: LogoTokenType.OpenParen, value: "(", line: lineNumber });
      position++;
      continue;
    }
    if (character === ")") {
      tokens.push({ type: LogoTokenType.CloseParen, value: ")", line: lineNumber });
      position++;
      continue;
    }

    // Two-character operators: <= >= <>
    if (position + 1 < normalizedSource.length) {
      const twoCharacter = normalizedSource.slice(position, position + 2);
      if (twoCharacter === "<=" || twoCharacter === ">=" || twoCharacter === "<>") {
        tokens.push({ type: LogoTokenType.Operator, value: twoCharacter, line: lineNumber });
        position += 2;
        continue;
      }
    }

    // Single-character operators
    if ("+-*/=<>%".includes(character)) {
      // UCBLogo whitespace rule for negative numbers: a minus sign preceded
      // by whitespace or a delimiter and immediately followed by a digit is
      // a negative number literal, not the infix subtraction operator.
      //   setxy -150 -20   →  two negative number literals
      //   5 - 3            →  subtraction (space on both sides of -)
      //   5-3              →  subtraction (no space before -)
      //   [-2 3]           →  negative number after bracket delimiter
      if (character === "-" && position + 1 < normalizedSource.length) {
        const nextCharacter = normalizedSource[position + 1];
        if (nextCharacter >= "0" && nextCharacter <= "9" || nextCharacter === ".") {
          const characterBefore = position > 0 ? normalizedSource[position - 1] : " ";
          const isDelimiterOrWhitespaceBefore = " \t\n[(".includes(characterBefore);

          if (isDelimiterOrWhitespaceBefore) {
            let numberString = "-";
            position++;
            let hasDecimalPoint = false;
            while (position < normalizedSource.length) {
              const digitCharacter = normalizedSource[position];
              if (digitCharacter >= "0" && digitCharacter <= "9") {
                numberString += digitCharacter;
                position++;
              } else if (digitCharacter === "." && !hasDecimalPoint) {
                hasDecimalPoint = true;
                numberString += digitCharacter;
                position++;
              } else if (digitCharacter === "e" || digitCharacter === "E") {
                numberString += digitCharacter;
                position++;
                if (position < normalizedSource.length && (normalizedSource[position] === "+" || normalizedSource[position] === "-")) {
                  numberString += normalizedSource[position];
                  position++;
                }
              } else {
                break;
              }
            }
            tokens.push({ type: LogoTokenType.Number, value: numberString, line: lineNumber });
            continue;
          }
        }
      }

      tokens.push({ type: LogoTokenType.Operator, value: character, line: lineNumber });
      position++;
      continue;
    }

    // Variable reference: :varname
    if (character === ":") {
      position++;
      let variableName = "";
      while (position < normalizedSource.length && isWordCharacter(normalizedSource[position])) {
        variableName += normalizedSource[position];
        position++;
      }
      if (variableName.length === 0) {
        throw new LogoSyntaxError(`Expected variable name after ':'`, lineNumber);
      }
      tokens.push({ type: LogoTokenType.Variable, value: variableName, line: lineNumber });
      continue;
    }

    // Quoted word: "word
    if (character === "\"") {
      position++;
      let quotedWord = "";
      while (position < normalizedSource.length && !isDelimiterCharacter(normalizedSource[position])) {
        quotedWord += normalizedSource[position];
        position++;
      }
      tokens.push({ type: LogoTokenType.QuotedWord, value: quotedWord, line: lineNumber });
      continue;
    }

    // Number (starts with digit or dot-digit)
    if ((character >= "0" && character <= "9") || (character === "." && position + 1 < normalizedSource.length && normalizedSource[position + 1] >= "0" && normalizedSource[position + 1] <= "9")) {
      let numberString = "";
      let hasDecimalPoint = false;
      while (position < normalizedSource.length) {
        const digitCharacter = normalizedSource[position];
        if (digitCharacter >= "0" && digitCharacter <= "9") {
          numberString += digitCharacter;
          position++;
        } else if (digitCharacter === "." && !hasDecimalPoint) {
          hasDecimalPoint = true;
          numberString += digitCharacter;
          position++;
        } else if (digitCharacter === "e" || digitCharacter === "E") {
          numberString += digitCharacter;
          position++;
          if (position < normalizedSource.length && (normalizedSource[position] === "+" || normalizedSource[position] === "-")) {
            numberString += normalizedSource[position];
            position++;
          }
        } else {
          break;
        }
      }
      tokens.push({ type: LogoTokenType.Number, value: numberString, line: lineNumber });
      continue;
    }

    // Word (procedure name, keyword, etc.)
    if (isWordCharacter(character)) {
      let word = "";
      while (position < normalizedSource.length && isWordCharacter(normalizedSource[position])) {
        word += normalizedSource[position];
        position++;
      }
      tokens.push({ type: LogoTokenType.Word, value: word, line: lineNumber });
      continue;
    }

    // Unknown character — skip it
    position++;
  }

  return tokens;
}

function isWordCharacter(character: string): boolean {
  const wordCharacterPattern = /[a-zA-Z0-9_.?]/;
  return wordCharacterPattern.test(character);
}

function isDelimiterCharacter(character: string): boolean {
  return " \t\n[]()+-*/=<>%;:\"".includes(character);
}



// ─── Errors ─────────────────────────────────────────────────────────

class LogoSyntaxError extends Error {
  public readonly line: number;
  constructor(message: string, line: number) {
    super(`Syntax error on line ${line}: ${message}`);
    this.name = "LogoSyntaxError";
    this.line = line;
  }
}

class LogoRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogoRuntimeError";
  }
}

class LogoStopSignal {
  // Used to implement STOP (early exit from procedure)
}

class LogoOutputSignal {
  public readonly value: number | string;
  constructor(value: number | string) {
    this.value = value;
  }
}

// ─── Executor ───────────────────────────────────────────────────────

class LogoExecutor {
  // Turtle state
  private positionX: number;
  private positionY: number;
  private headingAngle: number;  // degrees, 0 = north, clockwise
  private isPenDown: boolean = true;
  private penColorHex: string = "#38bdf8";
  private penWidth: number = 2;
  private fillColorHex: string = "#38bdf8";
  private isFilling: boolean = false;
  private isTurtleVisible: boolean = true;

  // Canvas
  private canvasWidth: number;
  private canvasHeight: number;
  private backgroundColorHex: string = "#000000";

  // Command log (output for Canvas replay)
  private commandLog: LogoCommand[] = [];

  // Variables (stack of scopes)
  private variableScopes: Map<string, number | string>[] = [new Map()];

  // User-defined procedures
  private procedures: Map<string, LogoProcedure> = new Map();

  // Execution safety
  private executionStepCount: number = 0;
  private maxSteps: number = MAX_EXECUTION_STEPS;
  private executionStartTime: number = 0;
  private timeoutMs: number = 30_000;

  constructor(canvasWidth: number = DEFAULT_CANVAS_WIDTH, canvasHeight: number = DEFAULT_CANVAS_HEIGHT) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.positionX = 0;
    this.positionY = 0;
    this.headingAngle = 0; // north
  }

  setMaxSteps(maximumSteps: number): void {
    this.maxSteps = maximumSteps;
  }

  setTimeout(timeoutMilliseconds: number): void {
    this.timeoutMs = timeoutMilliseconds;
  }

  // Execute a full LOGO program from tokens
  execute(tokens: LogoToken[]): void {
    this.executionStartTime = performance.now();

    // First pass: extract procedure definitions
    const executableTokens = this.extractProcedureDefinitions(tokens);

    // Second pass: execute remaining tokens
    this.executeTokenSequence(executableTokens, 0, executableTokens.length);
  }

  getResult(): LogoExecutionResult {
    return {
      success: true,
      commands: this.commandLog,
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
      background: this.backgroundColorHex,
      executionTimeMs: Math.round(performance.now() - this.executionStartTime),
    };
  }

  // ── Procedure Definition Extraction ─────────────────────────────

  private extractProcedureDefinitions(tokens: LogoToken[]): LogoToken[] {
    const remainingTokens: LogoToken[] = [];
    let index = 0;

    while (index < tokens.length) {
      const currentToken = tokens[index];

      if (currentToken.type === LogoTokenType.Word && currentToken.value.toLowerCase() === "to") {
        index = this.parseProcedureDefinition(tokens, index);
        continue;
      }

      remainingTokens.push(currentToken);
      index++;
    }

    return remainingTokens;
  }

  private parseProcedureDefinition(tokens: LogoToken[], startIndex: number): number {
    let index = startIndex + 1; // skip "to"

    // Skip newlines after TO
    while (index < tokens.length && tokens[index].type === LogoTokenType.Newline) {
      index++;
    }

    // Procedure name
    if (index >= tokens.length || tokens[index].type !== LogoTokenType.Word) {
      throw new LogoSyntaxError("Expected procedure name after TO", tokens[startIndex].line);
    }
    const procedureName = tokens[index].value.toLowerCase();
    index++;

    // Parameters (words prefixed with : or bare words on the same line)
    const parameters: string[] = [];
    while (index < tokens.length && tokens[index].type !== LogoTokenType.Newline) {
      const parameterToken = tokens[index];
      if (parameterToken.type === LogoTokenType.Variable) {
        parameters.push(parameterToken.value.toLowerCase());
      } else if (parameterToken.type === LogoTokenType.Word) {
        parameters.push(parameterToken.value.toLowerCase());
      }
      index++;
    }

    // Skip newline after parameter list
    if (index < tokens.length && tokens[index].type === LogoTokenType.Newline) {
      index++;
    }

    // Body tokens until END
    const bodyTokens: LogoToken[] = [];
    let foundEnd = false;
    while (index < tokens.length) {
      const bodyToken = tokens[index];
      if (bodyToken.type === LogoTokenType.Word && bodyToken.value.toLowerCase() === "end") {
        foundEnd = true;
        index++;
        break;
      }
      bodyTokens.push(bodyToken);
      index++;
    }

    if (!foundEnd) {
      throw new LogoSyntaxError(`Procedure '${procedureName}' is missing END`, tokens[startIndex].line);
    }

    this.procedures.set(procedureName, {
      name: procedureName,
      parameters,
      body: bodyTokens,
    });

    return index;
  }

  // ── Token Sequence Execution ────────────────────────────────────

  private executeTokenSequence(tokens: LogoToken[], startIndex: number, endIndex: number): void {
    let index = startIndex;

    while (index < endIndex) {
      this.checkExecutionLimits();

      const currentToken = tokens[index];

      // Skip newlines
      if (currentToken.type === LogoTokenType.Newline) {
        index++;
        continue;
      }

      // Must be a command word
      if (currentToken.type !== LogoTokenType.Word) {
        index++;
        continue;
      }

      const commandName = currentToken.value.toLowerCase();
      const advancedResult = this.executeCommand(commandName, tokens, index + 1, endIndex);
      index = advancedResult;
    }
  }

  // Execute a command and return the new token index after consuming arguments
  private executeCommand(commandName: string, tokens: LogoToken[], argumentStartIndex: number, endIndex: number): number {
    this.executionStepCount++;

    switch (commandName) {
      // ── Turtle Movement ──────────────────────────
      case "forward":
      case "fd": {
        const [distance, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.turtleForward(Number(distance));
        return nextIndex;
      }
      case "back":
      case "bk": {
        const [distance, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.turtleBackward(Number(distance));
        return nextIndex;
      }
      case "right":
      case "rt": {
        const [angle, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.turtleRight(Number(angle));
        return nextIndex;
      }
      case "left":
      case "lt": {
        const [angle, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.turtleLeft(Number(angle));
        return nextIndex;
      }
      case "home": {
        this.turtleHome();
        return argumentStartIndex;
      }
      case "setxy": {
        const [targetX, indexAfterX] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        const [targetY, indexAfterY] = this.evaluateExpression(tokens, indexAfterX, endIndex);
        this.turtleSetXY(Number(targetX), Number(targetY));
        return indexAfterY;
      }
      case "setx": {
        const [targetX, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.turtleSetX(Number(targetX));
        return nextIndex;
      }
      case "sety": {
        const [targetY, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.turtleSetY(Number(targetY));
        return nextIndex;
      }
      case "setheading":
      case "seth": {
        const [heading, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.turtleSetHeading(Number(heading));
        return nextIndex;
      }
      case "arc": {
        const [angle, indexAfterAngle] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        const [radius, indexAfterRadius] = this.evaluateExpression(tokens, indexAfterAngle, endIndex);
        this.turtleArc(Number(angle), Number(radius));
        return indexAfterRadius;
      }
      case "circle": {
        const [radius, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.turtleArc(360, Number(radius));
        return nextIndex;
      }

      // ── Pen Control ──────────────────────────────
      case "penup":
      case "pu": {
        this.isPenDown = false;
        this.logCommand({ action: "penup" });
        return argumentStartIndex;
      }
      case "pendown":
      case "pd": {
        this.isPenDown = true;
        this.logCommand({ action: "pendown" });
        return argumentStartIndex;
      }
      case "setpencolor":
      case "setpc": {
        // Check if next token is a bracket (RGB list)
        if (argumentStartIndex < endIndex && tokens[argumentStartIndex].type === LogoTokenType.OpenBracket) {
          const [bracketTokens, indexAfterBracket] = this.collectBracketedList(tokens, argumentStartIndex, endIndex);
          const rgbValues = this.evaluateListAsNumbers(bracketTokens);
          if (rgbValues.length >= 3) {
            const redChannel = Math.max(0, Math.min(255, Math.round(rgbValues[0])));
            const greenChannel = Math.max(0, Math.min(255, Math.round(rgbValues[1])));
            const blueChannel = Math.max(0, Math.min(255, Math.round(rgbValues[2])));
            this.penColorHex = `#${redChannel.toString(16).padStart(2, "0")}${greenChannel.toString(16).padStart(2, "0")}${blueChannel.toString(16).padStart(2, "0")}`;
          }
          this.logCommand({ action: "color", value: this.penColorHex });
          return indexAfterBracket;
        }
        const [colorValue, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.penColorHex = this.resolveLogoColor(colorValue);
        this.logCommand({ action: "color", value: this.penColorHex });
        return nextIndex;
      }
      case "setpensize": {
        // setpensize accepts either a number or a [width height] list
        if (argumentStartIndex < endIndex && tokens[argumentStartIndex].type === LogoTokenType.OpenBracket) {
          const [bracketTokens, indexAfterBracket] = this.collectBracketedList(tokens, argumentStartIndex, endIndex);
          const sizeValues = this.evaluateListAsNumbers(bracketTokens);
          this.penWidth = Math.max(1, Math.round(sizeValues[0] || 2));
          this.logCommand({ action: "width", value: String(this.penWidth) });
          return indexAfterBracket;
        }
        const [sizeValue, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.penWidth = Math.max(1, Math.round(Number(sizeValue)));
        this.logCommand({ action: "width", value: String(this.penWidth) });
        return nextIndex;
      }
      case "setbackground":
      case "setbg": {
        if (argumentStartIndex < endIndex && tokens[argumentStartIndex].type === LogoTokenType.OpenBracket) {
          const [bracketTokens, indexAfterBracket] = this.collectBracketedList(tokens, argumentStartIndex, endIndex);
          const rgbValues = this.evaluateListAsNumbers(bracketTokens);
          if (rgbValues.length >= 3) {
            const redChannel = Math.max(0, Math.min(255, Math.round(rgbValues[0])));
            const greenChannel = Math.max(0, Math.min(255, Math.round(rgbValues[1])));
            const blueChannel = Math.max(0, Math.min(255, Math.round(rgbValues[2])));
            this.backgroundColorHex = `#${redChannel.toString(16).padStart(2, "0")}${greenChannel.toString(16).padStart(2, "0")}${blueChannel.toString(16).padStart(2, "0")}`;
          }
          return indexAfterBracket;
        }
        const [colorValue, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.backgroundColorHex = this.resolveLogoColor(colorValue);
        return nextIndex;
      }

      // ── Drawing ──────────────────────────────────
      case "label": {
        // label accepts a quoted word or a bracketed list
        if (argumentStartIndex < endIndex && tokens[argumentStartIndex].type === LogoTokenType.OpenBracket) {
          const [bracketTokens, indexAfterBracket] = this.collectBracketedList(tokens, argumentStartIndex, endIndex);
          const labelText = bracketTokens.map(token => token.value).join(" ");
          this.logCommand({ action: "write", text: labelText, value: labelText });
          return indexAfterBracket;
        }
        const [textValue, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.logCommand({ action: "write", text: String(textValue), value: String(textValue) });
        return nextIndex;
      }
      case "dot": {
        const [radius, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.logCommand({ action: "dot", value: String(Number(radius) * 2) });
        return nextIndex;
      }
      case "stamp": {
        this.logCommand({ action: "stamp" });
        return argumentStartIndex;
      }

      // ── Fill ─────────────────────────────────────
      case "setfillcolor":
      case "setfc": {
        if (argumentStartIndex < endIndex && tokens[argumentStartIndex].type === LogoTokenType.OpenBracket) {
          const [bracketTokens, indexAfterBracket] = this.collectBracketedList(tokens, argumentStartIndex, endIndex);
          const rgbValues = this.evaluateListAsNumbers(bracketTokens);
          if (rgbValues.length >= 3) {
            const redChannel = Math.max(0, Math.min(255, Math.round(rgbValues[0])));
            const greenChannel = Math.max(0, Math.min(255, Math.round(rgbValues[1])));
            const blueChannel = Math.max(0, Math.min(255, Math.round(rgbValues[2])));
            this.fillColorHex = `#${redChannel.toString(16).padStart(2, "0")}${greenChannel.toString(16).padStart(2, "0")}${blueChannel.toString(16).padStart(2, "0")}`;
          }
          this.logCommand({ action: "fillcolor", value: this.fillColorHex });
          return indexAfterBracket;
        }
        const [colorValue, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.fillColorHex = this.resolveLogoColor(colorValue);
        this.logCommand({ action: "fillcolor", value: this.fillColorHex });
        return nextIndex;
      }
      case "fill": {
        // Simple fill at current position
        this.logCommand({ action: "dot", value: "4" });
        return argumentStartIndex;
      }
      case "filled": {
        // filled color [commands] — fill operations are complex, simplify for now
        if (argumentStartIndex < endIndex && tokens[argumentStartIndex].type === LogoTokenType.OpenBracket) {
          // Skip past the color list
          const [, indexAfterColor] = this.collectBracketedList(tokens, argumentStartIndex, endIndex);
          if (indexAfterColor < endIndex && tokens[indexAfterColor].type === LogoTokenType.OpenBracket) {
            const [bodyTokens, indexAfterBody] = this.collectBracketedList(tokens, indexAfterColor, endIndex);
            this.logCommand({ action: "begin_fill" });
            this.executeTokenSequence(bodyTokens, 0, bodyTokens.length);
            this.logCommand({ action: "end_fill" });
            return indexAfterBody;
          }
        }
        return argumentStartIndex;
      }

      // ── Canvas Control ───────────────────────────
      case "clean": {
        this.logCommand({ action: "clear" });
        return argumentStartIndex;
      }
      case "clearscreen":
      case "cs": {
        this.logCommand({ action: "clear" });
        this.turtleHome();
        return argumentStartIndex;
      }
      case "hideturtle":
      case "ht": {
        this.isTurtleVisible = false;
        this.logCommand({ action: "hideturtle" });
        return argumentStartIndex;
      }
      case "showturtle":
      case "st": {
        this.isTurtleVisible = true;
        this.logCommand({ action: "showturtle" });
        return argumentStartIndex;
      }
      case "wrap":
      case "window":
      case "fence": {
        // Screen mode commands — acknowledged but not enforced in Canvas replay
        return argumentStartIndex;
      }

      // ── Control Flow ─────────────────────────────
      case "repeat": {
        const [countValue, indexAfterCount] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        const count = Math.floor(Number(countValue));
        const repeatBracketIndex = this.skipNewlines(tokens, indexAfterCount, endIndex);
        if (repeatBracketIndex >= endIndex || tokens[repeatBracketIndex].type !== LogoTokenType.OpenBracket) {
          throw new LogoRuntimeError("REPEAT requires a bracketed instruction list");
        }
        const [bodyTokens, indexAfterBody] = this.collectBracketedList(tokens, repeatBracketIndex, endIndex);
        // Push a local scope so nested repeats each get their own repcount
        this.variableScopes.push(new Map());
        try {
          for (let iteration = 0; iteration < count; iteration++) {
            this.checkExecutionLimits();
            this.setLocalVariable("repcount", iteration + 1);
            try {
              this.executeTokenSequence(bodyTokens, 0, bodyTokens.length);
            } catch (signal) {
              if (signal instanceof LogoStopSignal) break;
              if (signal instanceof LogoOutputSignal) throw signal;
              throw signal;
            }
          }
        } finally {
          this.variableScopes.pop();
        }
        return indexAfterBody;
      }

      case "for": {
        // for [var start end step] [body]
        const forControlIndex = this.skipNewlines(tokens, argumentStartIndex, endIndex);
        if (forControlIndex >= endIndex || tokens[forControlIndex].type !== LogoTokenType.OpenBracket) {
          throw new LogoRuntimeError("FOR requires a bracketed control variable list");
        }
        const [controlTokens, indexAfterControl] = this.collectBracketedList(tokens, forControlIndex, endIndex);

        const forBodyIndex = this.skipNewlines(tokens, indexAfterControl, endIndex);
        if (forBodyIndex >= endIndex || tokens[forBodyIndex].type !== LogoTokenType.OpenBracket) {
          throw new LogoRuntimeError("FOR requires a bracketed instruction list");
        }
        const [bodyTokens, indexAfterBody] = this.collectBracketedList(tokens, forBodyIndex, endIndex);

        // Parse control: variable name, start, end, step
        const controlValues = this.parseForControl(controlTokens);
        const variableName = controlValues.variableName;
        const startValue = controlValues.startValue;
        const endValue = controlValues.endValue;
        const stepValue = controlValues.stepValue;

        if (stepValue > 0) {
          for (let currentValue = startValue; currentValue <= endValue; currentValue += stepValue) {
            this.checkExecutionLimits();
            this.setVariable(variableName, currentValue);
            try {
              this.executeTokenSequence(bodyTokens, 0, bodyTokens.length);
            } catch (signal) {
              if (signal instanceof LogoStopSignal) break;
              if (signal instanceof LogoOutputSignal) throw signal;
              throw signal;
            }
          }
        } else if (stepValue < 0) {
          for (let currentValue = startValue; currentValue >= endValue; currentValue += stepValue) {
            this.checkExecutionLimits();
            this.setVariable(variableName, currentValue);
            try {
              this.executeTokenSequence(bodyTokens, 0, bodyTokens.length);
            } catch (signal) {
              if (signal instanceof LogoStopSignal) break;
              if (signal instanceof LogoOutputSignal) throw signal;
              throw signal;
            }
          }
        }
        return indexAfterBody;
      }

      case "if": {
        const [condition, indexAfterCondition] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        const ifBracketIndex = this.skipNewlines(tokens, indexAfterCondition, endIndex);
        if (ifBracketIndex >= endIndex || tokens[ifBracketIndex].type !== LogoTokenType.OpenBracket) {
          throw new LogoRuntimeError("IF requires a bracketed instruction list");
        }
        const [trueBodyTokens, indexAfterTrueBody] = this.collectBracketedList(tokens, ifBracketIndex, endIndex);
        if (this.isTruthy(condition)) {
          this.executeTokenSequence(trueBodyTokens, 0, trueBodyTokens.length);
        }
        return indexAfterTrueBody;
      }

      case "ifelse": {
        const [condition, indexAfterCondition] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        const ifelseTrueIndex = this.skipNewlines(tokens, indexAfterCondition, endIndex);
        if (ifelseTrueIndex >= endIndex || tokens[ifelseTrueIndex].type !== LogoTokenType.OpenBracket) {
          throw new LogoRuntimeError("IFELSE requires two bracketed instruction lists");
        }
        const [trueBodyTokens, indexAfterTrueBody] = this.collectBracketedList(tokens, ifelseTrueIndex, endIndex);
        const ifelseFalseIndex = this.skipNewlines(tokens, indexAfterTrueBody, endIndex);
        if (ifelseFalseIndex >= endIndex || tokens[ifelseFalseIndex].type !== LogoTokenType.OpenBracket) {
          throw new LogoRuntimeError("IFELSE requires a false-branch instruction list");
        }
        const [falseBodyTokens, indexAfterFalseBody] = this.collectBracketedList(tokens, ifelseFalseIndex, endIndex);
        if (this.isTruthy(condition)) {
          this.executeTokenSequence(trueBodyTokens, 0, trueBodyTokens.length);
        } else {
          this.executeTokenSequence(falseBodyTokens, 0, falseBodyTokens.length);
        }
        return indexAfterFalseBody;
      }

      case "stop": {
        throw new LogoStopSignal();
      }

      case "output":
      case "op": {
        const [returnValue] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        throw new LogoOutputSignal(returnValue);
      }

      // ── Variables ────────────────────────────────
      case "make": {
        // make "varname value
        const [nameValue, indexAfterName] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        const [assignedValue, indexAfterValue] = this.evaluateExpression(tokens, indexAfterName, endIndex);
        this.setVariable(String(nameValue).toLowerCase(), assignedValue);
        return indexAfterValue;
      }

      case "local":
      case "localmake": {
        if (commandName === "localmake") {
          const [nameValue, indexAfterName] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
          const [assignedValue, indexAfterValue] = this.evaluateExpression(tokens, indexAfterName, endIndex);
          this.setLocalVariable(String(nameValue).toLowerCase(), assignedValue);
          return indexAfterValue;
        }
        // local just declares without value
        const [nameValue, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        this.setLocalVariable(String(nameValue).toLowerCase(), 0);
        return nextIndex;
      }

      // ── No-op commands ───────────────────────────
      case "wait": {
        const [, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        return nextIndex;
      }
      case "print":
      case "pr":
      case "show":
      case "type": {
        // Consume and discard the argument (LOGO print to stdout — not applicable in canvas)
        const [, nextIndex] = this.evaluateExpression(tokens, argumentStartIndex, endIndex);
        return nextIndex;
      }

      default: {
        // Check user-defined procedures
        const procedure = this.procedures.get(commandName);
        if (procedure) {
          return this.callProcedure(procedure, tokens, argumentStartIndex, endIndex);
        }

        // Unknown command — skip
        return argumentStartIndex;
      }
    }
  }

  // ── Expression Evaluator ────────────────────────────────────────

  // Evaluates an expression starting at `index` and returns [value, nextIndex]
  private evaluateExpression(tokens: LogoToken[], index: number, endIndex: number): [number | string, number] {
    let [leftValue, currentIndex] = this.evaluateAtom(tokens, index, endIndex);

    // Check for infix operators
    while (currentIndex < endIndex) {
      const operatorToken = tokens[currentIndex];
      if (operatorToken.type === LogoTokenType.Operator) {
        const operator = operatorToken.value;
        const [rightValue, indexAfterRight] = this.evaluateAtom(tokens, currentIndex + 1, endIndex);
        leftValue = this.applyInfixOperator(operator, leftValue, rightValue);
        currentIndex = indexAfterRight;
      } else {
        break;
      }
    }

    return [leftValue, currentIndex];
  }

  // Evaluates a single atomic value (number, variable, function call, parenthesized expression)
  private evaluateAtom(tokens: LogoToken[], index: number, endIndex: number): [number | string, number] {
    // Skip newlines
    while (index < endIndex && tokens[index].type === LogoTokenType.Newline) {
      index++;
    }

    if (index >= endIndex) {
      throw new LogoRuntimeError("Expected a value but reached end of input");
    }

    const currentToken = tokens[index];

    switch (currentToken.type) {
      case LogoTokenType.Number:
        return [parseFloat(currentToken.value), index + 1];

      case LogoTokenType.Variable: {
        const variableValue = this.getVariable(currentToken.value.toLowerCase());
        return [variableValue, index + 1];
      }

      case LogoTokenType.QuotedWord:
        return [currentToken.value, index + 1];

      case LogoTokenType.OpenParen: {
        // Parenthesized expression or multi-arg procedure call
        const [result, closingIndex] = this.evaluateExpression(tokens, index + 1, endIndex);
        if (closingIndex < endIndex && tokens[closingIndex].type === LogoTokenType.CloseParen) {
          return [result, closingIndex + 1];
        }
        // If no close paren found, just return what we have
        return [result, closingIndex];
      }

      case LogoTokenType.Operator: {
        // Unary minus
        if (currentToken.value === "-") {
          const [operandValue, nextIndex] = this.evaluateAtom(tokens, index + 1, endIndex);
          return [-Number(operandValue), nextIndex];
        }
        throw new LogoRuntimeError(`Unexpected operator '${currentToken.value}'`);
      }

      case LogoTokenType.Word: {
        // Could be a reporter (function that outputs a value)
        const wordName = currentToken.value.toLowerCase();
        return this.evaluateReporter(wordName, tokens, index + 1, endIndex);
      }

      default:
        throw new LogoRuntimeError(`Unexpected token '${currentToken.value}'`);
    }
  }

  // Evaluate a "reporter" — a word that produces a value
  private evaluateReporter(reporterName: string, tokens: LogoToken[], argumentIndex: number, endIndex: number): [number | string, number] {
    this.executionStepCount++;

    switch (reporterName) {
      // ── Math Functions ───────────────────────────
      case "sum": {
        const [valueA, indexAfterA] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        const [valueB, indexAfterB] = this.evaluateExpression(tokens, indexAfterA, endIndex);
        return [Number(valueA) + Number(valueB), indexAfterB];
      }
      case "difference": {
        const [valueA, indexAfterA] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        const [valueB, indexAfterB] = this.evaluateExpression(tokens, indexAfterA, endIndex);
        return [Number(valueA) - Number(valueB), indexAfterB];
      }
      case "product": {
        const [valueA, indexAfterA] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        const [valueB, indexAfterB] = this.evaluateExpression(tokens, indexAfterA, endIndex);
        return [Number(valueA) * Number(valueB), indexAfterB];
      }
      case "quotient": {
        const [valueA, indexAfterA] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        const [valueB, indexAfterB] = this.evaluateExpression(tokens, indexAfterA, endIndex);
        const divisor = Number(valueB);
        if (divisor === 0) throw new LogoRuntimeError("Division by zero");
        return [Number(valueA) / divisor, indexAfterB];
      }
      case "remainder":
      case "modulo": {
        const [valueA, indexAfterA] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        const [valueB, indexAfterB] = this.evaluateExpression(tokens, indexAfterA, endIndex);
        return [Number(valueA) % Number(valueB), indexAfterB];
      }
      case "minus": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [-Number(value), nextIndex];
      }
      case "abs": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [Math.abs(Number(value)), nextIndex];
      }
      case "int": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [Math.trunc(Number(value)), nextIndex];
      }
      case "round": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [Math.round(Number(value)), nextIndex];
      }
      case "sqrt": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [Math.sqrt(Number(value)), nextIndex];
      }
      case "power": {
        const [base, indexAfterBase] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        const [exponent, indexAfterExponent] = this.evaluateExpression(tokens, indexAfterBase, endIndex);
        return [Math.pow(Number(base), Number(exponent)), indexAfterExponent];
      }
      case "exp": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [Math.exp(Number(value)), nextIndex];
      }
      case "log10": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [Math.log10(Number(value)), nextIndex];
      }
      case "ln": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [Math.log(Number(value)), nextIndex];
      }
      case "sin": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [Math.sin(this.degreesToRadians(Number(value))), nextIndex];
      }
      case "cos": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [Math.cos(this.degreesToRadians(Number(value))), nextIndex];
      }
      case "tan": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [Math.tan(this.degreesToRadians(Number(value))), nextIndex];
      }
      case "arctan":
      case "atan": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [this.radiansToDegrees(Math.atan(Number(value))), nextIndex];
      }
      case "pi": {
        return [Math.PI, argumentIndex];
      }

      // ── Random ───────────────────────────────────
      case "random": {
        const [maxValue, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [Math.floor(Math.random() * Number(maxValue)), nextIndex];
      }

      // ── Turtle State Queries ─────────────────────
      case "xcor": {
        return [this.positionX, argumentIndex];
      }
      case "ycor": {
        return [this.positionY, argumentIndex];
      }
      case "heading": {
        return [this.headingAngle, argumentIndex];
      }
      case "pos": {
        // Returns position as a list — for simplicity return X coordinate
        // In full LOGO this would be a list, but we use it in numeric contexts
        return [this.positionX, argumentIndex];
      }
      case "towards": {
        const [targetX, indexAfterX] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        const [targetY, indexAfterY] = this.evaluateExpression(tokens, indexAfterX, endIndex);
        const deltaX = Number(targetX) - this.positionX;
        const deltaY = Number(targetY) - this.positionY;
        const angleRadians = Math.atan2(deltaX, deltaY);
        let angleDegrees = this.radiansToDegrees(angleRadians);
        if (angleDegrees < 0) angleDegrees += 360;
        return [angleDegrees, indexAfterY];
      }
      case "distance": {
        // Unary: distance to origin; or with args: distance to a point
        // Check if next token looks like a value
        if (argumentIndex < endIndex && this.isValueToken(tokens[argumentIndex])) {
          const [targetX, indexAfterX] = this.evaluateExpression(tokens, argumentIndex, endIndex);
          const [targetY, indexAfterY] = this.evaluateExpression(tokens, indexAfterX, endIndex);
          return [Math.sqrt((Number(targetX) - this.positionX) ** 2 + (Number(targetY) - this.positionY) ** 2), indexAfterY];
        }
        return [Math.sqrt(this.positionX ** 2 + this.positionY ** 2), argumentIndex];
      }
      case "pendownp":
      case "pendown?": {
        return [this.isPenDown ? 1 : 0, argumentIndex];
      }
      case "shownp":
      case "shown?": {
        return [this.isTurtleVisible ? 1 : 0, argumentIndex];
      }

      // ── Logic ────────────────────────────────────
      case "true": {
        return [1, argumentIndex];
      }
      case "false": {
        return [0, argumentIndex];
      }
      case "and": {
        const [valueA, indexAfterA] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        const [valueB, indexAfterB] = this.evaluateExpression(tokens, indexAfterA, endIndex);
        return [this.isTruthy(valueA) && this.isTruthy(valueB) ? 1 : 0, indexAfterB];
      }
      case "or": {
        const [valueA, indexAfterA] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        const [valueB, indexAfterB] = this.evaluateExpression(tokens, indexAfterA, endIndex);
        return [this.isTruthy(valueA) || this.isTruthy(valueB) ? 1 : 0, indexAfterB];
      }
      case "not": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [this.isTruthy(value) ? 0 : 1, nextIndex];
      }

      // ── Variable Access ──────────────────────────
      case "thing": {
        const [nameValue, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [this.getVariable(String(nameValue).toLowerCase()), nextIndex];
      }

      // ── String/Word Functions ────────────────────
      case "word": {
        const [wordA, indexAfterA] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        const [wordB, indexAfterB] = this.evaluateExpression(tokens, indexAfterA, endIndex);
        return [String(wordA) + String(wordB), indexAfterB];
      }
      case "count": {
        const [value, nextIndex] = this.evaluateExpression(tokens, argumentIndex, endIndex);
        return [String(value).length, nextIndex];
      }

      // ── REPCOUNT ─────────────────────────────────
      case "repcount": {
        return [this.getVariableOrDefault("repcount", 0), argumentIndex];
      }

      default: {
        // Check user-defined procedure (as reporter)
        const procedure = this.procedures.get(reporterName);
        if (procedure) {
          const [returnValue, nextIndex] = this.callProcedureAsReporter(procedure, tokens, argumentIndex, endIndex);
          return [returnValue, nextIndex];
        }

        // Unknown reporter — try as a variable (LOGO getter/setter syntax)
        try {
          const variableValue = this.getVariable(reporterName);
          return [variableValue, argumentIndex];
        } catch {
          throw new LogoRuntimeError(`I don't know how to ${reporterName}`);
        }
      }
    }
  }

  // ── Procedure Calls ─────────────────────────────────────────────

  private callProcedure(procedure: LogoProcedure, tokens: LogoToken[], argumentIndex: number, endIndex: number): number {
    // Evaluate arguments
    let currentIndex = argumentIndex;
    const argumentValues: (number | string)[] = [];
    for (let parameterIndex = 0; parameterIndex < procedure.parameters.length; parameterIndex++) {
      if (currentIndex >= endIndex) {
        throw new LogoRuntimeError(`Not enough inputs to ${procedure.name}`);
      }
      const [argumentValue, nextIndex] = this.evaluateExpression(tokens, currentIndex, endIndex);
      argumentValues.push(argumentValue);
      currentIndex = nextIndex;
    }

    // Create new scope
    this.variableScopes.push(new Map());
    for (let parameterIndex = 0; parameterIndex < procedure.parameters.length; parameterIndex++) {
      this.setLocalVariable(procedure.parameters[parameterIndex], argumentValues[parameterIndex]);
    }

    try {
      this.executeTokenSequence(procedure.body, 0, procedure.body.length);
    } catch (signal) {
      if (signal instanceof LogoStopSignal) {
        // Normal procedure exit
      } else if (signal instanceof LogoOutputSignal) {
        // Procedure returned a value but it was called as a command — discard
      } else {
        this.variableScopes.pop();
        throw signal;
      }
    }

    this.variableScopes.pop();
    return currentIndex;
  }

  private callProcedureAsReporter(procedure: LogoProcedure, tokens: LogoToken[], argumentIndex: number, endIndex: number): [number | string, number] {
    let currentIndex = argumentIndex;
    const argumentValues: (number | string)[] = [];
    for (let parameterIndex = 0; parameterIndex < procedure.parameters.length; parameterIndex++) {
      if (currentIndex >= endIndex) {
        throw new LogoRuntimeError(`Not enough inputs to ${procedure.name}`);
      }
      const [argumentValue, nextIndex] = this.evaluateExpression(tokens, currentIndex, endIndex);
      argumentValues.push(argumentValue);
      currentIndex = nextIndex;
    }

    this.variableScopes.push(new Map());
    for (let parameterIndex = 0; parameterIndex < procedure.parameters.length; parameterIndex++) {
      this.setLocalVariable(procedure.parameters[parameterIndex], argumentValues[parameterIndex]);
    }

    let returnValue: number | string = 0;
    try {
      this.executeTokenSequence(procedure.body, 0, procedure.body.length);
    } catch (signal) {
      if (signal instanceof LogoOutputSignal) {
        returnValue = signal.value;
      } else if (signal instanceof LogoStopSignal) {
        // Procedure stopped without OUTPUT
      } else {
        this.variableScopes.pop();
        throw signal;
      }
    }

    this.variableScopes.pop();
    return [returnValue, currentIndex];
  }

  // ── Turtle Primitives ───────────────────────────────────────────

  private turtleForward(distance: number): void {
    const headingRadians = this.degreesToRadians(this.headingAngle);
    const newX = this.positionX + Math.sin(headingRadians) * distance;
    const newY = this.positionY + Math.cos(headingRadians) * distance;
    this.positionX = newX;
    this.positionY = newY;
    this.logCommand({ action: "forward", value: String(distance) });
  }

  private turtleBackward(distance: number): void {
    this.logCommand({ action: "backward", value: String(distance) });
    const headingRadians = this.degreesToRadians(this.headingAngle);
    this.positionX -= Math.sin(headingRadians) * distance;
    this.positionY -= Math.cos(headingRadians) * distance;
  }

  private turtleRight(angle: number): void {
    this.headingAngle = (this.headingAngle + angle) % 360;
    if (this.headingAngle < 0) this.headingAngle += 360;
    this.logCommand({ action: "right", value: String(angle) });
  }

  private turtleLeft(angle: number): void {
    this.headingAngle = (this.headingAngle - angle) % 360;
    if (this.headingAngle < 0) this.headingAngle += 360;
    this.logCommand({ action: "left", value: String(angle) });
  }

  private turtleHome(): void {
    this.positionX = 0;
    this.positionY = 0;
    this.headingAngle = 0;
    this.logCommand({ action: "home" });
  }

  private turtleSetXY(targetX: number, targetY: number): void {
    this.positionX = targetX;
    this.positionY = targetY;
    this.logCommand({ action: "goto", x: targetX, y: targetY });
  }

  private turtleSetX(targetX: number): void {
    this.positionX = targetX;
    this.logCommand({ action: "goto", x: targetX, y: this.positionY });
  }

  private turtleSetY(targetY: number): void {
    this.positionY = targetY;
    this.logCommand({ action: "goto", x: this.positionX, y: targetY });
  }

  private turtleSetHeading(heading: number): void {
    this.headingAngle = heading % 360;
    if (this.headingAngle < 0) this.headingAngle += 360;
    this.logCommand({ action: "setheading", value: String(heading) });
  }

  private turtleArc(angleDegrees: number, radius: number): void {
    // ARC in LOGO: the turtle stays in place, draws an arc centered at distance=radius
    // perpendicular to heading
    this.logCommand({ action: "arc", value: String(radius), value2: String(angleDegrees) });
    // Update turtle position to end of arc
    const steps = Math.max(12, Math.floor(Math.abs(angleDegrees) / 10));
    const stepAngle = angleDegrees / steps;
    const stepLength = 2 * Math.abs(radius) * Math.sin(this.degreesToRadians(Math.abs(stepAngle) / 2));
    for (let stepIndex = 0; stepIndex < steps; stepIndex++) {
      const headingRadians = this.degreesToRadians(this.headingAngle);
      this.positionX += Math.sin(headingRadians) * stepLength;
      this.positionY += Math.cos(headingRadians) * stepLength;
      if (radius >= 0) {
        this.headingAngle += stepAngle;
      } else {
        this.headingAngle -= stepAngle;
      }
    }
    this.headingAngle = this.headingAngle % 360;
    if (this.headingAngle < 0) this.headingAngle += 360;
  }

  // ── Helper Methods ──────────────────────────────────────────────

  private skipNewlines(tokens: LogoToken[], index: number, endIndex: number): number {
    while (index < endIndex && tokens[index].type === LogoTokenType.Newline) {
      index++;
    }
    return index;
  }

  private logCommand(command: LogoCommand): void {
    if (this.commandLog.length < MAX_COMMAND_LOG_SIZE) {
      this.commandLog.push(command);
    }
  }

  private checkExecutionLimits(): void {
    if (this.executionStepCount > this.maxSteps) {
      throw new LogoRuntimeError(
        `Execution limit exceeded (${this.maxSteps} steps). Simplify the program or reduce iterations.`
      );
    }
    if (performance.now() - this.executionStartTime > this.timeoutMs) {
      throw new LogoRuntimeError(
        `Execution timed out after ${this.timeoutMs}ms`
      );
    }
  }

  private resolveLogoColor(colorValue: number | string): string {
    if (typeof colorValue === "number") {
      const paletteIndex = Math.floor(colorValue) % 16;
      return LOGO_COLOR_PALETTE[paletteIndex < 0 ? paletteIndex + 16 : paletteIndex] || "#ffffff";
    }
    const stringValue = String(colorValue);
    if (stringValue.startsWith("#")) return stringValue;
    // Try parsing as number
    const parsed = parseFloat(stringValue);
    if (!isNaN(parsed)) {
      const paletteIndex = Math.floor(parsed) % 16;
      return LOGO_COLOR_PALETTE[paletteIndex < 0 ? paletteIndex + 16 : paletteIndex] || "#ffffff";
    }
    // Named color
    const namedColors: Record<string, string> = {
      black: "#000000", blue: "#0000ff", green: "#00c000", cyan: "#00ffff",
      red: "#ff0000", magenta: "#ff00ff", yellow: "#ffff00", white: "#ffffff",
      brown: "#a0522d", tan: "#d2b48c", forest: "#228b22", aqua: "#00ced1",
      salmon: "#fa8072", purple: "#800080", orange: "#ffa500", grey: "#808080",
      gray: "#808080",
    };
    return namedColors[stringValue.toLowerCase()] || "#ffffff";
  }

  private degreesToRadians(degrees: number): number {
    return degrees * Math.PI / 180;
  }

  private radiansToDegrees(radians: number): number {
    return radians * 180 / Math.PI;
  }

  private isTruthy(value: number | string): boolean {
    if (typeof value === "number") return value !== 0;
    const lowerValue = String(value).toLowerCase();
    if (lowerValue === "true") return true;
    if (lowerValue === "false") return false;
    return value !== "";
  }

  private isValueToken(token: LogoToken): boolean {
    return token.type === LogoTokenType.Number ||
      token.type === LogoTokenType.Variable ||
      token.type === LogoTokenType.QuotedWord ||
      token.type === LogoTokenType.OpenParen ||
      (token.type === LogoTokenType.Operator && token.value === "-") ||
      (token.type === LogoTokenType.Word && this.isReporterWord(token.value.toLowerCase()));
  }

  private isReporterWord(word: string): boolean {
    const reporters = new Set([
      "sum", "difference", "product", "quotient", "remainder", "modulo",
      "minus", "abs", "int", "round", "sqrt", "power", "exp", "log10", "ln",
      "sin", "cos", "tan", "arctan", "atan", "pi",
      "random", "xcor", "ycor", "heading", "pos", "towards", "distance",
      "pendownp", "pendown?", "shownp", "shown?",
      "true", "false", "and", "or", "not", "thing",
      "word", "count", "repcount",
    ]);
    if (reporters.has(word)) return true;
    if (this.procedures.has(word)) return true;
    // Check if it's a known variable (getter/setter syntax)
    try {
      this.getVariable(word);
      return true;
    } catch {
      return false;
    }
  }

  // ── Variable Management ─────────────────────────────────────────

  private setVariable(name: string, value: number | string): void {
    // Set in the global scope (bottom of stack)
    this.variableScopes[0].set(name, value);
  }

  private setLocalVariable(name: string, value: number | string): void {
    // Set in the current (top) scope
    this.variableScopes[this.variableScopes.length - 1].set(name, value);
  }

  private getVariable(name: string): number | string {
    // Search scopes from top (most local) to bottom (global)
    for (let scopeIndex = this.variableScopes.length - 1; scopeIndex >= 0; scopeIndex--) {
      const scope = this.variableScopes[scopeIndex];
      if (scope.has(name)) {
        return scope.get(name)!;
      }
    }
    throw new LogoRuntimeError(`Variable '${name}' has no value`);
  }

  private getVariableOrDefault(name: string, defaultValue: number | string): number | string {
    try {
      return this.getVariable(name);
    } catch {
      return defaultValue;
    }
  }

  // ── Bracket Collection ──────────────────────────────────────────

  private collectBracketedList(tokens: LogoToken[], index: number, endIndex: number): [LogoToken[], number] {
    if (index >= endIndex || tokens[index].type !== LogoTokenType.OpenBracket) {
      throw new LogoRuntimeError("Expected '['");
    }

    const bodyTokens: LogoToken[] = [];
    let bracketDepth = 1;
    let currentIndex = index + 1;

    while (currentIndex < endIndex && bracketDepth > 0) {
      const currentToken = tokens[currentIndex];
      if (currentToken.type === LogoTokenType.OpenBracket) {
        bracketDepth++;
      } else if (currentToken.type === LogoTokenType.CloseBracket) {
        bracketDepth--;
        if (bracketDepth === 0) break;
      }
      bodyTokens.push(currentToken);
      currentIndex++;
    }

    if (bracketDepth !== 0) {
      throw new LogoRuntimeError("Unmatched bracket — expected ']'");
    }

    return [bodyTokens, currentIndex + 1]; // +1 to skip the closing bracket
  }

  private evaluateListAsNumbers(tokens: LogoToken[]): number[] {
    const numbers: number[] = [];
    let index = 0;
    while (index < tokens.length) {
      if (tokens[index].type === LogoTokenType.Newline) {
        index++;
        continue;
      }
      const [value, nextIndex] = this.evaluateExpression(tokens, index, tokens.length);
      numbers.push(Number(value));
      index = nextIndex;
    }
    return numbers;
  }

  // ── FOR Control Parsing ─────────────────────────────────────────

  private parseForControl(controlTokens: LogoToken[]): {
    variableName: string;
    startValue: number;
    endValue: number;
    stepValue: number;
  } {
    // Filter out newlines
    const meaningfulTokens = controlTokens.filter(
      token => token.type !== LogoTokenType.Newline
    );

    if (meaningfulTokens.length < 3) {
      throw new LogoRuntimeError("FOR control list must have at least [variable start end]");
    }

    // First token is the variable name
    const variableToken = meaningfulTokens[0];
    let variableName: string;
    if (variableToken.type === LogoTokenType.Word) {
      variableName = variableToken.value.toLowerCase();
    } else if (variableToken.type === LogoTokenType.Variable) {
      variableName = variableToken.value.toLowerCase();
    } else if (variableToken.type === LogoTokenType.QuotedWord) {
      variableName = variableToken.value.toLowerCase();
    } else {
      throw new LogoRuntimeError("FOR control list must start with a variable name");
    }

    // Evaluate remaining tokens as expressions for start, end, step
    const remainingTokens = meaningfulTokens.slice(1);
    let index = 0;

    const [startValue, indexAfterStart] = this.evaluateExpression(remainingTokens, index, remainingTokens.length);
    index = indexAfterStart;

    const [endValue, indexAfterEnd] = this.evaluateExpression(remainingTokens, index, remainingTokens.length);
    index = indexAfterEnd;

    let stepValue: number;
    if (index < remainingTokens.length) {
      const [parsedStep] = this.evaluateExpression(remainingTokens, index, remainingTokens.length);
      stepValue = Number(parsedStep);
    } else {
      // Auto-determine step direction
      stepValue = Number(startValue) <= Number(endValue) ? 1 : -1;
    }

    return {
      variableName,
      startValue: Number(startValue),
      endValue: Number(endValue),
      stepValue,
    };
  }

  // ── Infix Operators ─────────────────────────────────────────────

  private applyInfixOperator(operator: string, left: number | string, right: number | string): number | string {
    const leftNumber = Number(left);
    const rightNumber = Number(right);

    switch (operator) {
      case "+": return leftNumber + rightNumber;
      case "-": return leftNumber - rightNumber;
      case "*": return leftNumber * rightNumber;
      case "/":
        if (rightNumber === 0) throw new LogoRuntimeError("Division by zero");
        return leftNumber / rightNumber;
      case "%": return leftNumber % rightNumber;
      case "=": return leftNumber === rightNumber || String(left) === String(right) ? 1 : 0;
      case "<": return leftNumber < rightNumber ? 1 : 0;
      case ">": return leftNumber > rightNumber ? 1 : 0;
      case "<=": return leftNumber <= rightNumber ? 1 : 0;
      case ">=": return leftNumber >= rightNumber ? 1 : 0;
      case "<>": return (leftNumber !== rightNumber && String(left) !== String(right)) ? 1 : 0;
      default:
        throw new LogoRuntimeError(`Unknown operator '${operator}'`);
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export interface LogoExecutionOptions {
  timeout?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}

export function executeLogoProgram(
  sourceCode: string,
  options: LogoExecutionOptions = {},
): LogoExecutionResult {
  const {
    timeout = 30_000,
    canvasWidth = DEFAULT_CANVAS_WIDTH,
    canvasHeight = DEFAULT_CANVAS_HEIGHT,
  } = options;

  const startTime = performance.now();

  try {
    const tokens = tokenizeLogoSource(sourceCode);
    const executor = new LogoExecutor(canvasWidth, canvasHeight);
    executor.setTimeout(timeout);
    executor.execute(tokens);
    return executor.getResult();
  } catch (error: unknown) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    const errorMessage = getErrorMessage(error);
    return {
      success: false,
      commands: [],
      canvasWidth,
      canvasHeight,
      background: "#000000",
      error: errorMessage,
      executionTimeMs,
    };
  }
}
