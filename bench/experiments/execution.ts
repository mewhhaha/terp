// Candidate backends stay outside the library. Run: deno run bench/experiments/execution.ts
import { compile, make_grammar } from "../../src/runtime.ts";
import {
  type Node,
  type Plan,
  prepare_execution,
} from "../../src/execution.ts";
import { standard_operators } from "../../src/operators.ts";

type Read = (values: readonly unknown[]) => unknown;
const grammar = make_grammar(standard_operators, {}, []);

// Array-free tree walker: low compilation cost, runtime kind dispatch.
function walk(node: Node, values: readonly unknown[]): unknown {
  if (node.kind === "literal") return node.value;
  if (node.kind === "reference") {
    if (node.key !== undefined) {
      return (values[node.slot] as Record<string, unknown>)[node.key];
    }
    return values[node.slot];
  }
  if (node.kind !== "operator") {
    throw new Error("eager operator experiment only");
  }
  if (node.operator.definition.arity === 1) {
    return node.operator.definition.apply(walk(node.operands[0], values));
  }
  return node.operator.definition.apply(
    walk(node.operands[0], values),
    walk(node.operands[1], values),
  );
}

// Compact postfix instructions avoid recursive tree dispatch, but allocate a per-call stack.
function compact(plan: Plan): Read {
  const instructions: number[] = [];
  const data: unknown[] = [];
  const emit = (node: Node) => {
    if (node.kind === "literal") {
      instructions.push(0, data.length);
      data.push(node.value);
    } else if (node.kind === "reference") {
      instructions.push(1, data.length);
      data.push(node);
    } else if (node.kind === "operator") {
      for (const child of node.operands) emit(child);
      instructions.push(node.operator.definition.arity + 1, data.length);
      data.push(node.operator.definition);
    } else throw new Error("eager operator experiment only");
  };
  emit(plan.root);
  const code = new Uint32Array(instructions);
  return (values) => {
    const stack: unknown[] = [];
    let top = 0;
    for (let pc = 0; pc < code.length; pc += 2) {
      const operand = data[code[pc + 1]];
      if (code[pc] === 0) stack[top++] = operand;
      else if (code[pc] === 1) {
        const ref = operand as Extract<Node, { kind: "reference" }>;
        let value = values[ref.slot];
        if (ref.key !== undefined) {
          value = (value as Record<string, unknown>)[ref.key];
        }
        stack[top++] = value;
      } else {
        const definition = operand as typeof standard_operators["+"];
        const right = stack[--top];
        if (code[pc] === 2) {
          stack[top++] = (definition.apply as (value: unknown) => unknown)(
            right,
          );
        } else {
          const left = stack[--top];
          stack[top++] =
            (definition.apply as (left: unknown, right: unknown) => unknown)(
              left,
              right,
            );
        }
      }
    }
    return stack[0];
  };
}

// Only proven built-ins may fold. Application callbacks are never assumed pure.
function fold(plan: Plan): Plan {
  const pure = new Set([
    grammar.operators["+"],
    grammar.operators["*"],
    grammar.operators["-"],
  ]);
  const rewrite = (node: Node): Node => {
    if (node.kind !== "operator") return node;
    const operands = node.operands.map(rewrite);
    if (
      pure.has(node.operator.definition as typeof grammar.operators["+"]) &&
      operands.every((child) =>
        child.kind === "literal" && typeof child.value === "number"
      )
    ) {
      const value = walk({ ...node, operands }, []);
      return {
        kind: "literal",
        value,
        start: node.start,
        end: node.end,
        height: 1,
      };
    }
    return { ...node, operands };
  };
  return { ...plan, root: rewrite(plan.root) };
}

const source = "?0 + ?1 * 3";
const constantSource = "1 + 2 * 3 + ?0";
const plan = compile(grammar, source);
const constants = compile(grammar, constantSource);
const closure = prepare_execution(plan);
const folded = prepare_execution(fold(constants));
const unfolded = prepare_execution(constants);
const vm = compact(plan);
const values = [4, 5];
const duplicate = compile(grammar, "?amount + ?amount * ?amount");
const named = [{ amount: 4 }];
const duplicateRun = prepare_execution(duplicate);
const unique = compile(grammar, "?a + ?b * ?c");
const uniqueRun = prepare_execution(unique);
const namedUnique = [{ a: 4, b: 4, c: 4 }];
const cache = new Map<string, Plan>();
function cached(source: string): Plan {
  const hit = cache.get(source);
  if (hit !== undefined) return hit;
  const plan = compile(grammar, source);
  if (cache.size === 64) cache.delete(cache.keys().next().value!);
  cache.set(source, plan);
  return plan;
}
let last: Plan | undefined;
function lastCached(source: string): Plan {
  if (last !== undefined && last.source === source) return last;
  const plan = compile(grammar, source);
  if (source.length <= 1024) last = plan;
  return plan;
}
let cycleIndex = 0;
const cycle = Array.from({ length: 65 }, (_, index) => "?0 + " + index);
let preparedLast: { source: string; run: Read } | undefined;
function direct(source: string, cache: boolean): unknown {
  if (cache && preparedLast !== undefined && preparedLast.source === source) {
    return preparedLast.run(values);
  }
  const run = prepare_execution(compile(grammar, source));
  if (cache && source.length <= 1024) preparedLast = { source, run };
  return run(values);
}
const lazyDefinition = grammar.operators["&&"] as unknown as {
  lazy(left: () => unknown, right: () => unknown): unknown;
};
const booleans = [true, false];
const leftRead: Read = (values) => values[0];
const rightRead: Read = (values) => values[1];
function memo(read: () => unknown): () => unknown {
  let done = false;
  let value: unknown;
  return () => {
    if (!done) {
      value = read();
      done = true;
    }
    return value;
  };
}
function singleThunk(read: Read, values: readonly unknown[]): () => unknown {
  let done = false;
  let value: unknown;
  return () => {
    if (!done) {
      value = read(values);
      done = true;
    }
    return value;
  };
}
let sourceIndex = 0;
let sink: unknown;
const cases: Record<string, () => unknown> = {
  "lazy/double-closure": () =>
    lazyDefinition.lazy!(
      memo(() => leftRead(booleans)),
      memo(() => rightRead(booleans)),
    ),
  "lazy/single-closure": () =>
    lazyDefinition.lazy!(
      singleThunk(leftRead, booleans),
      singleThunk(rightRead, booleans),
    ),
  "tree/array-free": () => walk(plan.root, values),
  "closure/validated": () => closure(values),
  "compact/no-validation": () => vm(values),
  "constants/unfolded": () => unfolded(values.slice(0, 1)),
  "constants/folded": () => folded(values.slice(0, 1)),
  "bindings/duplicate": () => duplicateRun(named),
  "bindings/unique": () => uniqueRun(namedUnique),
  "direct/uncached-repeat": () => direct(source, false),
  "direct/last-repeat": () => direct(source, true),
  "direct/uncached-unique": () => direct("?0 + ?1 * " + sourceIndex++, false),
  "direct/last-unique": () => direct("?0 + ?1 * " + sourceIndex++, true),
  "direct/uncached-cycle65": () =>
    direct(cycle[cycleIndex++ % 65] + " + ?1", false),
  "direct/last-cycle65": () => direct(cycle[cycleIndex++ % 65] + " + ?1", true),
  "compile/uncached-repeat": () => compile(grammar, source),
  "compile/cached-repeat": () => cached(source),
  "compile/last-repeat": () => lastCached(source),
  "compile/last-unique": () => lastCached("?0 + " + sourceIndex++),
  "compile/uncached-cycle65": () => compile(grammar, cycle[cycleIndex++ % 65]),
  "compile/cached-cycle65": () => cached(cycle[cycleIndex++ % 65]),
  "compile/last-cycle65": () => lastCached(cycle[cycleIndex++ % 65]),
  "compile/uncached-unique": () => compile(grammar, "?0 + " + sourceIndex++),
  "compile/cached-unique": () => cached("?0 + " + sourceIndex++),
};
for (
  const name of [
    "tree/array-free",
    "closure/validated",
    "compact/no-validation",
  ]
) {
  if (cases[name]() !== 19) throw new Error("bad workload " + name);
}
const results: Record<string, number[]> = {};
for (let round = 0; round < 5; round++) {
  for (const [name, run] of Object.entries(cases)) {
    const count = 100_000;
    for (let i = 0; i < 10_000; i++) sink = run();
    const start = performance.now();
    for (let i = 0; i < count; i++) sink = run();
    const ns = (performance.now() - start) * 1e6 / count;
    (results[name] ??= []).push(ns);
  }
}
const median = (samples: number[]) => samples.sort((a, b) => a - b)[2];
console.log(
  JSON.stringify(
    {
      ns: Object.fromEntries(
        Object.entries(results).map((
          [name, samples],
        ) => [name, median(samples)]),
      ),
      sink: typeof sink,
    },
    null,
    2,
  ),
);
