import { failure } from "./errors.ts";
import {
  type OperatorDefinition,
  type OperatorEntry,
  type OperatorRegistry,
  validate_operator_definition,
  validate_operator_token,
} from "./operators.ts";

import type { Node, Plan, Reference, RuntimeOperator } from "./execution.ts";
export type {
  InterpreterApplyOperator,
  Plan,
  RuntimeOperator,
  TraceStep,
} from "./execution.ts";

interface TokenOperators {
  readonly token: string;
  readonly word: boolean;
  readonly first: RuntimeOperator;
  readonly unary?: RuntimeOperator;
  readonly binary?: RuntimeOperator;
}
interface OperatorTable {
  readonly operators: OperatorRegistry;
  readonly tokens: readonly string[];
  readonly buckets: ReadonlyMap<string, readonly TokenOperators[]>;
}
export interface Grammar extends OperatorTable {
  readonly values: Readonly<Record<string, unknown>>;
  readonly prefixes: readonly string[];
}

// Only snapshots prepared here are trusted. Mutable application tables are never cached.
const tables = new WeakMap<OperatorRegistry, OperatorTable>();

const MAX_DEPTH = 128;
const identifier = /[A-Za-z_$][A-Za-z0-9_$]*/y;
const digits = /\d+/y;
const number =
  /(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|[+-]?(?:(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?))/y;
const symbols = /^[!#$%&*+./:<=>@\\^|~-]$/;
const escapes: Readonly<Record<string, string>> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  n: "\n",
  r: "\r",
  t: "\t",
};

function scan(
  pattern: RegExp,
  source: string,
  index: number,
): RegExpExecArray | null {
  pattern.lastIndex = index;
  return pattern.exec(source);
}
function identifier_start(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
    code === 95 || code === 36;
}

function prepare_table(operators: OperatorRegistry): OperatorTable {
  const known = tables.get(operators);
  if (known !== undefined) return known;
  const registry: Record<string, OperatorEntry> = Object.create(null);
  const buckets = new Map<string, TokenOperators[]>();
  const tokens = Object.keys(operators);
  for (const token of tokens) {
    validate_operator_token(token);
    const entry = operators[token];
    let definitions: readonly OperatorDefinition[];
    if (Array.isArray(entry)) definitions = entry;
    else definitions = [entry as OperatorDefinition];
    if (definitions.length === 0) {
      throw new TypeError(
        "operator `" + token + "` must have at least one definition",
      );
    }
    let arities = 0;
    let unary: RuntimeOperator | undefined;
    let binary: RuntimeOperator | undefined;
    const copy: OperatorDefinition[] = [];
    for (const definition of definitions) {
      validate_operator_definition(token, definition);
      const bit = 1 << definition.arity;
      if (arities & bit) {
        throw new TypeError(
          "operator `" + token + "` has more than one arity `" +
            definition.arity + "` definition",
        );
      }
      arities |= bit;
      // One final object, including inherited metadata and bound prototype methods.
      const snapshot = { ...definition } as unknown as Record<string, unknown>;
      snapshot.kind = definition.kind;
      snapshot.arity = definition.arity;
      snapshot.precedence = definition.precedence;
      snapshot.apply = definition.apply;
      if (!Object.hasOwn(definition, "apply")) {
        snapshot.apply = definition.apply.bind(definition);
      }
      if (definition.arity === 2) {
        snapshot.direction = definition.direction;
        if (definition.lazy !== undefined) {
          snapshot.lazy = definition.lazy;
          if (!Object.hasOwn(definition, "lazy")) {
            snapshot.lazy = definition.lazy.bind(definition);
          }
        }
      }
      const frozen = Object.freeze(snapshot) as unknown as OperatorDefinition;
      copy.push(frozen);
      const descriptor = Object.freeze({ token, definition: frozen });
      if (definition.arity === 1) unary = descriptor;
      else binary = descriptor;
    }
    if (Array.isArray(entry)) {
      registry[token] = Object.freeze(copy) as unknown as OperatorEntry;
    } else registry[token] = copy[0];
    let first = unary;
    if (copy[0].arity === 2) first = binary;
    const prepared = {
      token,
      word: /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token),
      first: first!,
      unary,
      binary,
    };
    let bucket = buckets.get(token[0]);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(token[0], bucket);
    }
    bucket.push(prepared);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => b.token.length - a.token.length);
  }
  const table = { operators: Object.freeze(registry), tokens, buckets };
  tables.set(table.operators, table);
  return table;
}

export function make_grammar(
  operators: OperatorRegistry,
  values: Readonly<Record<string, unknown>>,
  prefixes: readonly string[],
): Grammar {
  const table = prepare_table(operators);
  const vocabulary = Object.freeze({ ...values });
  for (const name of Object.keys(vocabulary)) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      throw new TypeError(
        "interpreter value name `" + name + "` must be a valid identifier",
      );
    }
    if (name === "true" || name === "false") {
      throw new TypeError(
        "interpreter value name `" + name +
          "` is reserved for boolean literals",
      );
    }
    if (Object.hasOwn(table.operators, name)) {
      throw new TypeError(
        "interpreter value name `" + name +
          "` must not conflict with an operator token",
      );
    }
  }
  if (
    prefixes.some((prefix) =>
      typeof prefix !== "string" || prefix.length === 0 || /\s/.test(prefix)
    )
  ) {
    throw new TypeError(
      "word prefixes must be nonempty strings without whitespace",
    );
  }
  return {
    ...table,
    values: vocabulary,
    prefixes: Object.freeze([...prefixes].sort((a, b) => b.length - a.length)),
  };
}

class Parser {
  index = 0;
  references: Reference[] = [];
  indexed = 0;
  anonymous = 0;
  named = false;
  needsValue = false;
  acceptsWord = false;
  completionNode?: { node: Node; grouped: boolean };
  constructor(
    readonly grammar: Grammar,
    readonly source: string,
    readonly completionAt = -1,
  ) {}

  fail(message: string, start = this.index, end = start + 1): never {
    throw failure("syntax", message, this.source, {
      start,
      end: Math.min(end, this.source.length),
    });
  }

  skip(): void {
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code === 32 || (code >= 9 && code <= 13)) this.index++;
      else if (code > 127 && /\s/.test(this.source[this.index])) this.index++;
      else break;
    }
  }

  operator(arity?: 1 | 2): RuntimeOperator | undefined {
    const bucket = this.grammar.buckets.get(this.source[this.index]);
    if (bucket === undefined) return undefined;
    for (const entry of bucket) {
      let descriptor = entry.first;
      if (arity === 1) {
        if (entry.unary === undefined) continue;
        descriptor = entry.unary;
      } else if (arity === 2) {
        if (entry.binary === undefined) continue;
        descriptor = entry.binary;
      }
      const token = entry.token;
      if (!this.source.startsWith(token, this.index)) continue;
      const after = this.source[this.index + token.length];
      if (entry.word) {
        if (after !== undefined && /[A-Za-z0-9_$]/.test(after)) continue;
      } else if (arity === 2 && after !== undefined && symbols.test(after)) {
        const saved = this.index;
        this.index += token.length;
        const unary = this.operator(1);
        this.index = saved;
        if (
          unary === undefined &&
          scan(number, this.source, saved + token.length) === null
        ) continue;
      }
      return descriptor;
    }
    return undefined;
  }

  expression(depth = 0, minimum = -Infinity, exclusive = false): Node {
    if (depth >= MAX_DEPTH) {
      throw failure(
        "limit",
        "expression exceeds maximum nesting of " + MAX_DEPTH,
        this.source,
        { start: this.index, end: this.index },
      );
    }
    this.skip();
    const start = this.index;
    const prefix = this.operator(1);
    let left: Node;
    if (prefix !== undefined) {
      this.index += prefix.token.length;
      const operatorSpan = { start, end: this.index };
      const operand = this.expression(
        depth + 1,
        prefix.definition.precedence,
        true,
      );
      left = {
        kind: "operator",
        operator: prefix,
        operands: [operand],
        operatorSpan,
        start,
        end: operand.end,
        height: operand.height + 1,
      };
    } else left = this.atom(depth, false);
    let previous: RuntimeOperator | undefined;
    while (true) {
      this.skip();
      const next = this.operator(2);
      if (next === undefined) break;
      const definition = next.definition;
      if (definition.arity !== 2) break;
      if (
        definition.precedence < minimum ||
        (exclusive && definition.precedence === minimum)
      ) break;
      if (
        previous !== undefined && previous.definition.arity === 2 &&
        previous.definition.precedence === definition.precedence
      ) {
        if (previous.definition.direction !== definition.direction) {
          this.fail(
            "operators `" + previous.token + "` and `" + next.token +
              "` share precedence but have different associativity",
          );
        }
        if (definition.direction === "none") {
          this.fail(
            "operator `" + next.token +
              "` is non-associative and cannot be chained at the same precedence",
          );
        }
      }
      const operatorSpan = {
        start: this.index,
        end: this.index + next.token.length,
      };
      this.index = operatorSpan.end;
      this.skip();
      const rightStart = this.index;
      const right = this.expression(
        depth + 1,
        definition.precedence,
        definition.direction !== "right",
      );
      // Right-associative recursion must also reject mixed directions at its boundary.
      if (
        right.kind === "operator" && !right.grouped &&
        right.operator.definition.arity === 2 &&
        right.operator.definition.precedence === definition.precedence &&
        right.start === rightStart
      ) {
        if (right.operator.definition.direction !== definition.direction) {
          this.fail(
            "operators `" + next.token + "` and `" + right.operator.token +
              "` share precedence but have different associativity",
            operatorSpan.start,
            operatorSpan.end,
          );
        }
      }
      left = {
        kind: "operator",
        operator: next,
        operands: [left, right],
        operatorSpan,
        start: left.start,
        end: right.end,
        height: Math.max(left.height, right.height) + 1,
      };
      previous = next;
    }
    if (left.height > MAX_DEPTH) {
      throw failure(
        "limit",
        "expression exceeds maximum tree depth of " + MAX_DEPTH,
        this.source,
        { start: left.start, end: left.end },
      );
    }
    if (this.index === this.completionAt) {
      this.completionNode = { node: left, grouped: left.grouped === true };
    }
    return left;
  }

  atom(depth: number, word: boolean): Node {
    this.skip();
    const start = this.index;
    const char = this.source[start];
    if (char === undefined || char === ")") {
      if (start === this.completionAt) {
        this.needsValue = true;
        return {
          kind: "literal",
          value: undefined,
          start,
          end: start,
          height: 1,
        };
      }
      this.fail("expression is missing a value", start, start);
    }
    if (char === "?") {
      this.index++;
      const indexDigits = scan(digits, this.source, this.index);
      const name = scan(identifier, this.source, this.index);
      const ref: Reference = {
        kind: "reference",
        slot: 0,
        label: "",
        start,
        end: start,
        height: 1,
      };
      if (indexDigits !== null) {
        const value = Number(indexDigits[0]);
        if (!Number.isSafeInteger(value)) {
          this.fail(
            "placeholder index `" + indexDigits[0] + "` is too large",
            start,
            this.index + indexDigits[0].length,
          );
        }
        ref.slot = value;
        ref.label = "?" + indexDigits[0];
        this.index += indexDigits[0].length;
        this.indexed = Math.max(this.indexed, value + 1);
      } else if (name !== null) {
        ref.key = name[0];
        this.named = true;
        this.index += name[0].length;
      } else {
        ref.anonymous = this.anonymous++;
      }
      ref.end = this.index;
      this.references.push(ref);
      return ref;
    }
    if (char === "(") {
      this.index++;
      this.skip();
      const op = this.operator();
      if (op !== undefined) {
        const saved = this.index;
        this.index += op.token.length;
        this.skip();
        if (
          this.source[this.index] === ")" && this.index !== this.completionAt
        ) {
          this.index++;
          return {
            kind: "literal",
            value: this.grammar.operators[op.token],
            start,
            end: this.index,
            height: 1,
          };
        }
        this.index = saved;
      }
      if (this.source[this.index] === ")" && this.index !== this.completionAt) {
        this.fail(
          "expected an expression inside parentheses",
          start,
          this.index + 1,
        );
      }
      const inner = this.expression(depth + 1);
      this.skip();
      if (this.source[this.index] !== ")") {
        this.fail("expression is missing `)`", start, this.index);
      }
      this.index++;
      // Group spans prevent outer associativity checks from inspecting through parentheses.
      inner.start = start;
      inner.end = this.index;
      inner.grouped = true;
      return inner;
    }
    if (char === "'" || char === '"') {
      this.index++;
      let segment = this.index;
      let value = "";
      let end = this.source.indexOf(char, this.index);
      while (true) {
        const escapeAt = this.source.indexOf("\\", this.index);
        if (end < 0 && escapeAt < 0) {
          this.fail(
            "string literal is missing closing quote",
            start,
            this.source.length,
          );
        }
        if (end >= 0 && (escapeAt < 0 || escapeAt > end)) {
          value += this.source.slice(segment, end);
          this.index = end + 1;
          return { kind: "literal", value, start, end: this.index, height: 1 };
        }
        value += this.source.slice(segment, escapeAt);
        this.index = escapeAt + 2;
        const escape = this.source[escapeAt + 1];
        if (escape === undefined) {
          this.fail(
            "string literal has an incomplete escape",
            start,
            this.index,
          );
        }
        if (!Object.hasOwn(escapes, escape)) {
          this.fail(
            "string literal has unsupported escape `" + escape + "`",
            escapeAt,
            this.index,
          );
        }
        value += escapes[escape];
        segment = this.index;
        if (end >= 0 && this.index > end) {
          end = this.source.indexOf(char, this.index);
        }
      }
    }
    if (word) {
      for (const prefix of this.grammar.prefixes) {
        if (!this.source.startsWith(prefix, start)) continue;
        const name = scan(identifier, this.source, start + prefix.length);
        if (name !== null) {
          this.index += prefix.length + name[0].length;
          return {
            kind: "literal",
            value: prefix + name[0],
            start,
            end: this.index,
            height: 1,
          };
        }
      }
    }
    const numeric = scan(number, this.source, start);
    if (numeric !== null) {
      const value = Number(numeric[0]);
      this.index += numeric[0].length;
      if (!Number.isFinite(value)) {
        this.fail("number literal must be finite", start, this.index);
      }
      return { kind: "literal", value, start, end: this.index, height: 1 };
    }
    const name = scan(identifier, this.source, start);
    if (name !== null) {
      this.index += name[0].length;
      if (name[0] === "true" || name[0] === "false") {
        return {
          kind: "literal",
          value: name[0] === "true",
          start,
          end: this.index,
          height: 1,
        };
      }
      if (!Object.hasOwn(this.grammar.values, name[0])) {
        if (word) {
          return {
            kind: "literal",
            value: name[0],
            start,
            end: this.index,
            height: 1,
          };
        }
        throw failure(
          "unknown_value",
          "value `" + name[0] + "` is not defined",
          this.source,
          { start, end: this.index },
        );
      }
      const value = this.grammar.values[name[0]];
      if (!word && typeof value === "function") {
        const operands: Node[] = [];
        let height = 0;
        while (this.index < this.source.length) {
          const before = this.index;
          this.skip();
          if (before !== this.index && this.index === this.completionAt) {
            this.acceptsWord = true;
          }
          if (
            before === this.index || this.index >= this.source.length ||
            this.source[this.index] === ")" || this.operator(2) !== undefined
          ) break;
          const next = this.source[this.index];
          if (
            next !== "?" && next !== "(" && next !== "'" && next !== '"' &&
            !identifier_start(this.source.charCodeAt(this.index)) &&
            scan(number, this.source, this.index) === null &&
            !this.grammar.prefixes.some((prefix) =>
              this.source.startsWith(prefix, this.index)
            )
          ) break;
          const operand = this.atom(depth + 1, true);
          operands.push(operand);
          height = Math.max(height, operand.height);
        }
        if (operands.length > 0) {
          return {
            kind: "function",
            name: name[0],
            fn: value as (...args: unknown[]) => unknown,
            operands,
            start,
            end: operands[operands.length - 1].end,
            height: height + 1,
          };
        }
      }
      return { kind: "literal", value, start, end: this.index, height: 1 };
    }
    this.fail("expected a value at `" + this.source.slice(start).trim() + "`");
  }
}

export function compile(grammar: Grammar, source: string): Plan {
  if (typeof source !== "string") {
    throw failure("syntax", "expression must be a string");
  }
  if (source.length > 100_000) {
    throw failure(
      "limit",
      "expression exceeds maximum length of 100000",
      source,
      { start: 100_000, end: source.length },
    );
  }
  if (source.trim() === "") {
    throw failure("syntax", "expression did not reduce to one value", source, {
      start: 0,
      end: source.length,
    });
  }
  const parser = new Parser(grammar, source);
  const root = parser.expression();
  parser.skip();
  if (parser.index !== source.length) {
    parser.fail(
      "expected a registered operator at `" +
        source.slice(parser.index).trim() + "`",
      parser.index,
      source.length,
    );
  }
  let offset = 0;
  if (parser.named) offset = 1;
  for (const ref of parser.references) {
    if (ref.key !== undefined) {
      ref.slot = 0;
      continue;
    }
    if (ref.anonymous !== undefined) {
      ref.slot = parser.indexed + ref.anonymous;
      ref.label = String(ref.slot + 1);
    }
    ref.slot += offset;
  }
  return {
    source,
    root,
    references: parser.references,
    argumentCount: parser.indexed + parser.anonymous + offset,
  };
}

/** One vocabulary suggestion replacing a source range. */
export interface Completion {
  /** Suggested vocabulary token. */
  readonly text: string;
  /** Vocabulary category. */
  readonly kind: "operator" | "value";
  /** Start of the text to replace. */
  readonly start: number;
  /** End of the text to replace. */
  readonly end: number;
}

interface Suggestion {
  text: string;
  kind: "operator" | "value";
  order: number;
  operator?: TokenOperators;
}
const completionVocabularies = new WeakMap<Grammar, readonly Suggestion[]>();

function vocabulary(grammar: Grammar): readonly Suggestion[] {
  const known = completionVocabularies.get(grammar);
  if (known !== undefined) return known;
  const entries: Suggestion[] = [];
  const descriptors = new Map<string, TokenOperators>();
  for (const bucket of grammar.buckets.values()) {
    for (const entry of bucket) descriptors.set(entry.token, entry);
  }
  for (const text of grammar.tokens.toSorted((a, b) => b.length - a.length)) {
    const operator = descriptors.get(text)!;
    entries.push({ text, kind: "operator", order: entries.length, operator });
  }
  for (const text of Object.keys(grammar.values)) {
    entries.push({ text, kind: "value", order: entries.length });
  }
  entries.sort((a, b) => {
    if (a.text < b.text) return -1;
    if (a.text > b.text) return 1;
    return 0;
  });
  completionVocabularies.set(grammar, entries);
  return entries;
}

// Inserting an operator first visits the innermost pending precedence boundary.
function accepts_binary(
  context: NonNullable<Parser["completionNode"]>,
  candidate: RuntimeOperator,
): boolean {
  const path: RuntimeOperator[] = [];
  let node = context.node;
  let grouped = context.grouped;
  while (!grouped && node.kind === "operator") {
    path.push(node.operator);
    node = node.operands[node.operands.length - 1];
    grouped = node.grouped === true;
  }
  const next = candidate.definition;
  for (let index = path.length - 1; index >= 0; index--) {
    const previous = path[index].definition;
    if (next.precedence > previous.precedence) return true;
    if (next.precedence < previous.precedence || previous.arity === 1) continue;
    if (next.arity !== 2) return false;
    return next.direction === previous.direction && next.direction !== "none";
  }
  return true;
}

export function completions(
  grammar: Grammar,
  source: string,
  cursor = source.length,
): readonly Completion[] {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > source.length) {
    throw new RangeError("completion cursor is outside the expression");
  }
  if (cursor > 100_000) return [];
  const before = source.slice(0, cursor);
  const match = /(?:[A-Za-z_$][A-Za-z0-9_$]*|[!#$%&*+./:<=>@\\^|~-]+)$/.exec(
    before,
  );
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (const character of before) {
    if (quote !== "") {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth++;
    else if (character === ")") depth--;
    if (depth < 0 || depth >= MAX_DEPTH) return [];
  }
  if (quote !== "") return [];
  let prefix = "";
  let start = cursor;
  if (match !== null) {
    prefix = match[0];
    start -= prefix.length;
  }
  const head = source.slice(0, start);
  const closing = ")".repeat(depth);
  const parser = new Parser(grammar, head + closing, start);
  let complete = false;
  try {
    parser.expression();
    parser.skip();
    complete = parser.index === parser.source.length;
  } catch { /* Missing operands identify the next grammatical position. */ }
  const entries = vocabulary(grammar);
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle].text < prefix) low = middle + 1;
    else high = middle;
  }
  const accepted: Suggestion[] = [];
  const operatorValue = parser.needsValue && head.trimEnd().endsWith("(");
  for (let index = low; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry.text.startsWith(prefix)) break;
    let valid = false;
    if (entry.operator === undefined) {
      valid = parser.needsValue || parser.acceptsWord;
    } else if (operatorValue) valid = true;
    else if (parser.needsValue) valid = entry.operator.unary !== undefined;
    else if (
      complete && entry.operator.binary !== undefined &&
      parser.completionNode !== undefined
    ) {
      valid = accepts_binary(parser.completionNode, entry.operator.binary);
    } else if (parser.acceptsWord && entry.operator.word) valid = true;
    // Long sources retain the parser's exact depth/length bounds. Unusual tokens
    // can also be parsed as shorter operators or numeric/function arguments.
    const unusual = entry.operator !== undefined && !entry.operator.word &&
      grammar.buckets.get(entry.text[0])!.some((other) =>
        other.token !== entry.text && entry.text.startsWith(other.token)
      );
    if (
      !complete || head.length > 256 || head.endsWith("?") || unusual ||
      (entry.operator !== undefined && scan(number, entry.text, 0) !== null) ||
      (parser.acceptsWord && !entry.operator?.word &&
        entry.operator !== undefined)
    ) {
      valid = false;
      for (const suffix of ["", " ?"]) {
        try {
          compile(grammar, head + entry.text + suffix + closing);
          valid = true;
          break;
        } catch { /* Keep exact behavior for uncommon lexical ambiguities. */ }
      }
    }
    if (valid) accepted.push(entry);
  }
  accepted.sort((a, b) => a.order - b.order);
  return accepted.map(({ text, kind }) => ({ text, kind, start, end: cursor }));
}
