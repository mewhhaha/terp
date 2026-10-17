import { failure, InterpreterError, type SourceSpan } from "./errors.ts";
import type {
  OperatorDefinition,
  OperatorEntry,
  OperatorRegistry,
} from "./operators.ts";

/** Operator metadata supplied to application hooks. */
export interface RuntimeOperator {
  /** Registered token. */
  readonly token: string;
  /** Immutable operator metadata and callbacks. */
  readonly definition: OperatorDefinition;
}

/** Replace operator application. Overrides the operator's lazy behavior too. */
export type InterpreterApplyOperator = (
  operator: RuntimeOperator,
  ...operands: readonly unknown[]
) => unknown;

/** One completed operation in an execution trace, in execution order. */
export interface TraceStep {
  /** Operation category. */
  readonly kind: "operator" | "function";
  /** Registered function or operator name. */
  readonly name: string;
  /** Source range of the operation. */
  readonly span: SourceSpan;
  /** Evaluated operands; lazy branches may leave empty slots. */
  readonly operands: readonly unknown[];
  /** Returned value. */
  readonly result: unknown;
}

type Base = { start: number; end: number; height: number; grouped?: boolean };
type Literal = Base & { kind: "literal"; value: unknown };
type Reference = Base & {
  kind: "reference";
  slot: number;
  key?: string;
  label: string;
  anonymous?: number;
};
type Operation = Base & {
  kind: "operator";
  operator: RuntimeOperator;
  operands: Node[];
  operatorSpan: SourceSpan;
};
type Call = Base & {
  kind: "function";
  name: string;
  fn: (...args: unknown[]) => unknown;
  operands: Node[];
};
type Node = Literal | Reference | Operation | Call;

export interface Plan {
  readonly source: string;
  readonly root: Node;
  readonly references: readonly Reference[];
  readonly argumentCount: number;
  readonly composed?: true;
}

export interface Grammar {
  readonly operators: OperatorRegistry;
  readonly values: Readonly<Record<string, unknown>>;
  readonly prefixes: readonly string[];
  readonly tokens: readonly string[];
  readonly buckets: ReadonlyMap<string, readonly string[]>;
}

const MAX_DEPTH = 128;
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/;
const number =
  /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|[+-]?(?:(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?))/;
const symbols = /^[!#$%&*+./:<=>@\\^|~-]$/;
const escapes: Readonly<Record<string, string>> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  n: "\n",
  r: "\r",
  t: "\t",
};

function definitions(entry: OperatorEntry): readonly OperatorDefinition[] {
  if (Array.isArray(entry)) return entry;
  return [entry as OperatorDefinition];
}

export function make_grammar(
  operators: OperatorRegistry,
  values: Readonly<Record<string, unknown>>,
  prefixes: readonly string[],
): Grammar {
  const registry: Record<string, OperatorEntry> = Object.create(null);
  for (const [token, entry] of Object.entries(operators)) {
    const copy = definitions(entry).map((definition) => {
      let apply = definition.apply;
      if (!Object.hasOwn(definition, "apply")) apply = apply.bind(definition);
      const copied = {
        ...definition,
        kind: definition.kind,
        arity: definition.arity,
        precedence: definition.precedence,
        apply,
      };
      if (definition.arity === 2) {
        const binary = {
          ...copied,
          arity: 2 as const,
          direction: definition.direction,
          apply: apply as typeof definition.apply,
          lazy: definition.lazy,
        };
        if (binary.lazy === undefined) {
          const { lazy: _unused, ...eager } = binary;
          return Object.freeze(eager);
        }
        if (binary.lazy !== undefined && !Object.hasOwn(definition, "lazy")) {
          binary.lazy = binary.lazy.bind(definition);
        }
        return Object.freeze(binary);
      }
      return Object.freeze({
        ...copied,
        arity: 1 as const,
        apply: apply as typeof definition.apply,
      });
    });
    if (Array.isArray(entry)) {
      registry[token] = Object.freeze(copy) as unknown as OperatorEntry;
    } else registry[token] = copy[0];
  }
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
    if (Object.hasOwn(registry, name)) {
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
  const tokens = Object.keys(registry).sort((a, b) => b.length - a.length);
  const buckets = new Map<string, string[]>();
  for (const token of tokens) {
    let bucket = buckets.get(token[0]);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(token[0], bucket);
    }
    bucket.push(token);
  }
  return {
    operators: Object.freeze(registry),
    values: vocabulary,
    prefixes: Object.freeze([...prefixes].sort((a, b) => b.length - a.length)),
    tokens: Object.freeze(tokens),
    buckets,
  };
}

class Parser {
  index = 0;
  references: Reference[] = [];
  indexed = 0;
  anonymous = 0;
  named = false;
  constructor(readonly grammar: Grammar, readonly source: string) {}

  fail(message: string, start = this.index, end = start + 1): never {
    throw failure("syntax", message, this.source, {
      start,
      end: Math.min(end, this.source.length),
    });
  }

  skip(): void {
    while (
      this.index < this.source.length && /\s/.test(this.source[this.index])
    ) this.index++;
  }

  operator(arity?: 1 | 2): RuntimeOperator | undefined {
    for (
      const token of this.grammar.buckets.get(this.source[this.index]) ?? []
    ) {
      if (!this.source.startsWith(token, this.index)) continue;
      const after = this.source[this.index + token.length];
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token)) {
        if (after !== undefined && /[A-Za-z0-9_$]/.test(after)) continue;
      } else if (arity === 2 && after !== undefined && symbols.test(after)) {
        const saved = this.index;
        this.index += token.length;
        const unary = this.operator(1);
        this.index = saved;
        if (
          unary === undefined &&
          !number.test(this.source.slice(saved + token.length))
        ) continue;
      }
      const entry = this.grammar.operators[token];
      for (const definition of definitions(entry)) {
        if (arity === undefined || definition.arity === arity) {
          return Object.freeze({ token, definition });
        }
      }
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
        right.start ===
          operatorSpan.end + this.source.slice(operatorSpan.end).search(/\S/)
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
    return left;
  }

  atom(depth: number, word: boolean): Node {
    this.skip();
    const start = this.index;
    const char = this.source[start];
    if (char === undefined || char === ")") {
      this.fail("expression is missing a value", start, start);
    }
    if (char === "?") {
      this.index++;
      const digits = /^\d+/.exec(this.source.slice(this.index));
      const name = identifier.exec(this.source.slice(this.index));
      const ref: Reference = {
        kind: "reference",
        slot: 0,
        label: "",
        start,
        end: start,
        height: 1,
      };
      if (digits !== null) {
        const value = Number(digits[0]);
        if (!Number.isSafeInteger(value)) {
          this.fail(
            "placeholder index `" + digits[0] + "` is too large",
            start,
            this.index + digits[0].length,
          );
        }
        ref.slot = value;
        ref.label = "?" + digits[0];
        this.index += digits[0].length;
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
        if (this.source[this.index] === ")") {
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
      if (this.source[this.index] === ")") {
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
      Object.assign(inner, { start, end: this.index, grouped: true });
      return inner;
    }
    if (char === "'" || char === '"') {
      this.index++;
      let value = "";
      while (
        this.index < this.source.length && this.source[this.index] !== char
      ) {
        const part = this.source[this.index++];
        if (part !== "\\") value += part;
        else {
          const escape = this.source[this.index++];
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
              this.index - 2,
              this.index,
            );
          }
          value += escapes[escape];
        }
      }
      if (this.source[this.index] !== char) {
        this.fail("string literal is missing closing quote", start, this.index);
      }
      this.index++;
      return { kind: "literal", value, start, end: this.index, height: 1 };
    }
    if (word) {
      for (const prefix of this.grammar.prefixes) {
        if (!this.source.startsWith(prefix, start)) continue;
        const name = identifier.exec(this.source.slice(start + prefix.length));
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
    const numeric = number.exec(this.source.slice(start));
    if (numeric !== null) {
      const value = Number(numeric[0]);
      this.index += numeric[0].length;
      if (!Number.isFinite(value)) {
        this.fail("number literal must be finite", start, this.index);
      }
      return { kind: "literal", value, start, end: this.index, height: 1 };
    }
    const name = identifier.exec(this.source.slice(start));
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
        while (this.index < this.source.length) {
          const before = this.index;
          this.skip();
          if (
            before === this.index || this.index >= this.source.length ||
            this.source[this.index] === ")" || this.operator(2) !== undefined
          ) break;
          const next = this.source[this.index];
          if (
            next !== "?" && next !== "(" && next !== "'" && next !== '"' &&
            !identifier.test(this.source.slice(this.index)) &&
            !number.test(this.source.slice(this.index)) &&
            !this.grammar.prefixes.some((prefix) =>
              this.source.startsWith(prefix, this.index)
            )
          ) break;
          operands.push(this.atom(depth + 1, true));
        }
        if (operands.length > 0) {
          return {
            kind: "function",
            name: name[0],
            fn: value as (...args: unknown[]) => unknown,
            operands,
            start,
            end: operands[operands.length - 1].end,
            height: Math.max(...operands.map((node) => node.height)) + 1,
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

function validate(plan: Plan, values: readonly unknown[]): void {
  for (const ref of plan.references) {
    if (ref.key !== undefined) {
      const scope = values[ref.slot];
      if (typeof scope !== "object" || scope === null) {
        throw failure(
          "arguments",
          "expression expected a scope object",
          plan.source,
          ref,
        );
      }
      if (!Object.hasOwn(scope, ref.key)) {
        throw failure(
          "arguments",
          "expression scope is missing `" + ref.key + "`",
          plan.source,
          ref,
        );
      }
    } else if (ref.slot >= values.length) {
      throw failure(
        "arguments",
        "expression is missing a value for placeholder `" + ref.label + "`",
        plan.source,
        ref,
      );
    }
  }
  if (values.length > plan.argumentCount) {
    throw failure(
      "arguments",
      "expression received too many values",
      plan.source,
      { start: 0, end: plan.source.length },
    );
  }
}

export function execute(
  plan: Plan,
  values: readonly unknown[],
  hook?: InterpreterApplyOperator,
  trace?: TraceStep[],
): unknown {
  validate(plan, values);
  const evaluate = (node: Node): unknown => {
    if (node.kind === "literal") return node.value;
    if (node.kind === "reference") {
      if (node.key !== undefined) {
        return (values[node.slot] as Record<string, unknown>)[node.key];
      }
      return values[node.slot];
    }
    const operands: unknown[] = [];
    let result: unknown;
    let name: string;
    let span: SourceSpan = node;
    if (node.kind === "function") name = node.name;
    else {
      name = node.operator.token;
      span = node.operatorSpan;
    }
    try {
      if (
        node.kind === "operator" && hook === undefined &&
        node.operator.definition.arity === 2 &&
        node.operator.definition.lazy !== undefined
      ) {
        const read = (index: number): () => unknown => {
          let done = false;
          let value: unknown;
          return () => {
            if (!done) {
              value = evaluate(node.operands[index]);
              operands[index] = value;
              done = true;
            }
            return value;
          };
        };
        result = node.operator.definition.lazy(read(0), read(1));
      } else {
        for (const operand of node.operands) operands.push(evaluate(operand));
        if (node.kind === "function") {
          const fn = node.fn;
          result = fn(...operands);
        } else if (hook !== undefined) {
          result = hook(node.operator, ...operands);
        } else if (node.operator.definition.arity === 1) {
          result = node.operator.definition.apply(operands[0]);
        } else {
          result = node.operator.definition.apply(
            operands[0],
            operands[1],
          );
        }
      }
    } catch (cause) {
      if (cause instanceof InterpreterError) {
        throw cause;
      }
      let message = String(cause);
      if (cause instanceof Error) message = cause.message;
      throw failure(
        node.kind,
        node.kind + " `" + name + "` failed: " + message,
        plan.source,
        span,
        cause,
      );
    }
    if (trace !== undefined) {
      trace.push({
        kind: node.kind,
        name,
        span: { start: span.start, end: span.end },
        operands,
        result,
      });
    }
    return result;
  };
  return evaluate(plan.root);
}

export function combine_plans(
  operator: RuntimeOperator,
  plans: readonly Plan[],
): Plan {
  const sources = plans.map((plan) => "(" + plan.source + ")");
  let source: string;
  if (plans.length === 1) source = operator.token + " " + sources[0];
  else source = sources[0] + " " + operator.token + " " + sources[1];
  let slotOffset = 0;
  let sourceOffset = 1;
  if (plans.length === 1) sourceOffset += operator.token.length + 1;
  const references: Reference[] = [];
  const operands: Node[] = [];
  const clone = (node: Node): Node => {
    const base = {
      ...node,
      start: node.start + sourceOffset,
      end: node.end + sourceOffset,
    };
    if (node.kind === "reference") {
      const ref = {
        ...base,
        kind: "reference",
        slot: node.slot + slotOffset,
      } as Reference;
      references.push(ref);
      return ref;
    }
    if (node.kind === "literal") return base as Literal;
    const children = node.operands.map(clone);
    if (node.kind === "function") {
      return { ...base, operands: children } as Call;
    }
    return {
      ...base,
      operands: children,
      operatorSpan: {
        start: node.operatorSpan.start + sourceOffset,
        end: node.operatorSpan.end + sourceOffset,
      },
    } as Operation;
  };
  for (const plan of plans) {
    operands.push(clone(plan.root));
    slotOffset += plan.argumentCount;
    sourceOffset += plan.source.length + operator.token.length + 4;
  }
  let opStart = 0;
  if (plans.length === 2) opStart = sources[0].length + 1;
  const root: Operation = {
    kind: "operator",
    operator: Object.freeze(operator),
    operands,
    operatorSpan: { start: opStart, end: opStart + operator.token.length },
    start: 0,
    end: source.length,
    height: Math.max(...operands.map((n) => n.height)) + 1,
  };
  if (root.height > MAX_DEPTH) {
    throw failure(
      "limit",
      "expression exceeds maximum tree depth of " + MAX_DEPTH,
      source,
      root,
    );
  }
  return {
    source,
    root,
    references,
    argumentCount: slotOffset,
    composed: true,
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

export function completions(
  grammar: Grammar,
  source: string,
  cursor = source.length,
): readonly Completion[] {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > source.length) {
    throw new RangeError("completion cursor is outside the expression");
  }
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
  const candidates: Completion[] = [];
  for (const text of [...grammar.tokens, ...Object.keys(grammar.values)]) {
    if (!text.startsWith(prefix)) continue;
    let kind: "operator" | "value" = "value";
    if (Object.hasOwn(grammar.operators, text)) kind = "operator";
    const candidate = source.slice(0, start) + text;
    let valid = false;
    for (const suffix of ["", " ?"]) {
      try {
        compile(grammar, candidate + suffix + ")".repeat(depth));
        valid = true;
        break;
      } catch { /* An incomplete candidate is not a suggestion. */ }
    }
    if (valid) candidates.push({ text, kind, start, end: cursor });
  }
  return candidates;
}
