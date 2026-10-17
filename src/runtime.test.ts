import { assert_equals, assert_true } from "./assert.ts";
import {
  interpreter,
  InterpreterError,
  number_operator,
  number_unary_operator,
  op,
  standard_operators,
  terp,
} from "../mod.ts";

function ok<T>(value: T | InterpreterError): T {
  if (value instanceof InterpreterError) throw value;
  return value;
}
function error(fn: () => unknown): InterpreterError {
  try {
    fn();
  } catch (e) {
    if (e instanceof InterpreterError) return e;
    throw e;
  }
  throw new Error("expected located interpreter error");
}

Deno.test("compiled runners isolate registry metadata and retain live input values", () => {
  const definition = {
    kind: "math",
    precedence: 6,
    direction: "left" as const,
    arity: 2 as const,
    apply: (a: number, b: number) => a + b,
  };
  const registry: Record<string, typeof definition> = { add: definition };
  const values = { amount: 1 };
  const calc = interpreter(registry, { values });
  const run = ok(calc.raw("amount add ?"));
  definition.apply = () => 999;
  definition.precedence = -5;
  values.amount = 100;
  delete registry.add;
  registry.mul = definition;
  assert_equals(run(2), 3);
  assert_equals(run(5), 6);
  assert_equals(calc.get("mul"), undefined);
  assert_true(Object.isFrozen(calc.operators), "registry is frozen");
  assert_true(Object.isFrozen(calc.get("add")), "metadata is frozen");
});

Deno.test("syntax and argument validation complete before callbacks", () => {
  let calls = 0;
  const calc = interpreter(standard_operators, {
    values: {
      tick(n: number) {
        calls++;
        return n;
      },
    },
  });
  const invalid: string = "tick 1 +";
  assert_equals(error(() => calc(invalid)).code, "syntax");
  assert_equals(error(() => ok(calc.raw("tick 1"))(2)).code, "arguments");
  assert_equals(
    error(() => ok(calc.raw("tick 1 + ?missing"))({})).code,
    "arguments",
  );
  assert_equals(calls, 0);
});

Deno.test("prefixes and named functions execute in source order", () => {
  const log: string[] = [];
  const calc = interpreter({
    bang: number_unary_operator(8, (n) => {
      log.push("bang");
      return n;
    }),
    "+": number_operator(6, "left", (a, b) => a + b),
  }, {
    values: {
      call(n: number) {
        log.push("call");
        return n;
      },
    },
  });
  assert_equals(calc("bang 1 + call 2"), 3);
  assert_equals(log, ["bang", "call"]);
});

Deno.test("prefix ties bind first and groups allow mixed associativity", () => {
  const calc = interpreter({
    neg: number_unary_operator(5, (n) => -n),
    left: number_operator(5, "left", (a, b) => a - b),
    right: number_operator(5, "right", (a, b) => a ** b),
  });
  assert_equals(calc("neg 2 left 3"), -5);
  assert_equals(calc("2 right (3 left 1)"), 4);
  assert_equals(calc("(2 right 3) left 1"), 7);
  const mixed: string = "2 right 3 left 1";
  assert_true(
    error(() => calc(mixed)).message.includes("different associativity"),
    "mixed directions require groups",
  );
});

Deno.test("fragments preserve grouping and exact interpreter ownership", () => {
  const left = ok(terp.fragment("2 + 3"));
  assert_equals(ok(terp.raw`${left} * 4`)(), 20);
  const shared = {};
  const first = interpreter(standard_operators, { values: shared });
  const second = interpreter(standard_operators, { values: shared });
  const foreign = ok(first.fragment("1"));
  const rejected = second.raw`${foreign} + 1`;
  assert_true(rejected instanceof InterpreterError, "foreign fragments fail");
});

Deno.test("structural fragment composition gives each fragment independent arguments", () => {
  const left = ok(terp.fragment("?0 + ?0"));
  const right = ok(terp.fragment("?0 * 3"));
  const combined = ok(terp.combine("+", left, right));
  const n: number = combined.run(2, 4);
  assert_equals(n, 16);
  const namedLeft = ok(terp.fragment("?amount + 1"));
  const namedRight = ok(terp.fragment("?amount * 2"));
  const named = ok(terp.combine("+", namedLeft, namedRight));
  assert_equals(named.run({ amount: 2 }, { amount: 5 }), 13);
  const negated = ok(terp.combine("-", named));
  assert_equals(negated.run({ amount: 2 }, { amount: 5 }), -13);
  assert_equals(
    error(() =>
      (named.run as (...args: unknown[]) => unknown)({ amount: 2 }, {})
    ).code,
    "arguments",
  );
  const source = ok(terp.raw`${left} + ${right}`);
  assert_equals(source(2), 10); // Text templates intentionally share indexed bindings.
});

Deno.test("lazy operators skip branches and trace each evaluated operation once", () => {
  let calls = 0;
  const calc = interpreter(standard_operators, {
    values: {
      tick(_n: number) {
        calls++;
        return true;
      },
    },
  });
  assert_equals(calc("false && tick 1"), false);
  assert_equals(calc("true || tick 1"), true);
  assert_equals(calls, 0);
  const trace = ok(calc.explain("true && tick 1"));
  assert_equals(trace.value, true);
  assert_equals(calls, 1);
  assert_equals(trace.steps.map((step) => step.name), ["tick", "&&"]);
  assert_equals(trace.steps[1].span, { start: 5, end: 7 });
});

Deno.test("checked runtime boundaries validate before callbacks and after results", () => {
  let calls = 0;
  const calc = interpreter({
    add: op("infixl 6 ?", (a: number, b: number) => {
      calls++;
      return a + b;
    }),
  });
  const run = ok(calc.checked("? add ?", {
    arguments: (args: readonly unknown[]): args is readonly [number, number] =>
      args.length === 2 && args.every((value) => typeof value === "number"),
    result: (value: unknown): value is number =>
      typeof value === "number" && value < 10,
  }));
  const value: number = run(2, 3);
  assert_equals(value, 5);
  assert_equals(
    error(() => (run as (...args: unknown[]) => unknown)("x", 2)).code,
    "validation",
  );
  assert_equals(calls, 1);
  assert_equals(error(() => run(9, 9)).code, "validation");
  assert_equals(calls, 2);
});

Deno.test("operator and function failures preserve original cause and source spans", () => {
  const cause = new RangeError("domain problem");
  const calc = interpreter({
    fail: op("infixl 6 ?", (_a: number, _b: number): number => {
      throw cause;
    }),
  }, {
    values: {
      boom(_n: number): number {
        throw cause;
      },
    },
  });
  const operation = error(() => calc("1 fail 2"));
  assert_equals(operation.code, "operator");
  assert_equals(operation.cause, cause);
  assert_equals(operation.span, { start: 2, end: 6 });
  assert_equals(operation.source, "1 fail 2");
  const call = error(() => calc("boom 1"));
  assert_equals(call.code, "function");
  assert_equals(call.cause, cause);
  const nested = error(() => calc("1 fail (boom 2)"));
  assert_equals(nested.code, "function");
  assert_equals(nested.span?.start, 7);
});

Deno.test("oversized nesting reports a limit and finite numeric syntax is enforced", () => {
  const nested = "(".repeat(1000) + "1" + ")".repeat(1000);
  const result = terp.raw(nested);
  assert_true(result instanceof InterpreterError, "deep input is rejected");
  if (result instanceof InterpreterError) assert_equals(result.code, "limit");
  assert_equals(ok(terp.raw("1\u00a0+\u00a02"))(), 3);
  assert_true(
    terp.raw("1e9999") instanceof InterpreterError,
    "nonfinite literals rejected",
  );
});

Deno.test("completion offers only parseable vocabulary continuations", () => {
  const calc = interpreter({
    add: number_operator(6, "left", (a, b) => a + b),
    neg: number_unary_operator(8, (n) => -n),
  }, { values: { amount: 1, answer: 42 } });
  for (
    const prefix of [
      "",
      "a",
      "am",
      "ans",
      "n",
      "ne",
      "1 ",
      "1 a",
      "1 ad",
      "1 add ",
      "1 add a",
      "1 add am",
      "1 add n",
      "1 add ne",
      "neg ",
      "neg a",
      "neg am",
      "amount ",
      "amount a",
      "amount ad",
    ]
  ) {
    const suggestions = calc.complete(prefix);
    assert_true(suggestions.length > 0, "expected completion for " + prefix);
    for (const suggestion of suggestions) {
      const candidate = prefix.slice(0, suggestion.start) + suggestion.text;
      assert_true(
        !(calc.raw(candidate) instanceof InterpreterError) ||
          !(calc.raw(candidate + " ?") instanceof InterpreterError),
        "suggestion must parse with an operand",
      );
    }
  }
  assert_equals(calc.complete("1 ").map((s) => s.text), ["add"]);
  assert_equals(calc.complete('"unfinished'), []);
});

function checked_types(): void {
  const literal: number = terp("1 + 2");
  const calc = interpreter(standard_operators, {
    apply_operator() {
      return "replacement";
    },
  });
  // @ts-expect-error Replacement semantics do not promise numeric results.
  const numeric: number = calc("? + ?", 1, 2);
  const f = ok(terp.fragment("? + 1"));
  const s = ok(terp.fragment("'text'"));
  // @ts-expect-error A numeric operator cannot compose a string fragment.
  terp.combine("+", f, s);
  const pair = ok(terp.combine("+", f, f));
  // @ts-expect-error Independent fragments retain both argument slots.
  pair.run(1);
  // @ts-expect-error Typed fragments retain operand constraints.
  f.run("bad");
  void literal;
  void numeric;
}
void checked_types;

Deno.test("grouped references retain resolved slots and named scope offsets", () => {
  assert_equals(ok(terp.raw("(?) + (?)"))(2, 3), 5);
  assert_equals(ok(terp.raw("(?x) + (?0)"))({ x: 2 }, 3), 5);
  assert_equals(ok(terp.raw("(?1) + (?)"))(10, 20, 30), 50);
  const part = ok(terp.fragment("?"));
  assert_equals(ok(terp.raw`${part} + ${part}`)(2, 3), 5);
  const composed = ok(
    terp.combine("+", ok(terp.fragment("?0 + 1")), ok(terp.fragment("?0 + 2"))),
  );
  assert_true(
    terp.raw`${composed}` instanceof InterpreterError,
    "independent bindings cannot silently collapse into textual slots",
  );
});

Deno.test("callbacks cannot access parser nodes and error names do not bypass wrapping", () => {
  const calc = interpreter({}, {
    values: {
      inspect: function (this: unknown, _value: number) {
        return this;
      },
      fail(_value: number) {
        const e = new Error("ordinary error");
        e.name = "InterpreterError";
        throw e;
      },
    },
  });
  assert_equals(calc("inspect 1"), undefined);
  const e = error(() => calc("fail 1"));
  assert_equals(e.code, "function");
  assert_true(e.cause instanceof Error, "original error is preserved");
});

Deno.test("prototype operator methods survive snapshotting", () => {
  class Add {
    kind = "number";
    precedence = 6;
    arity = 2 as const;
    direction = "left" as const;
    #offset = 1;
    apply(a: unknown, b: unknown) {
      return Number(a) + Number(b) + this.#offset;
    }
  }
  const calc = interpreter({ add: new Add() });
  assert_equals(ok(calc.raw("1 add 2"))(), 4);
});

Deno.test("completion handles groups and partial symbols", () => {
  const calc = interpreter(standard_operators, { values: { answer: 42 } });
  assert_equals(calc.complete("(ans").map((s) => s.text), ["answer"]);
  assert_true(
    calc.complete("1 &").some((s) => s.text === "&&"),
    "partial symbols complete",
  );
  const onlyBinary = interpreter({
    "+": number_operator(6, "left", (a, b) => a + b),
  });
  assert_equals(ok(onlyBinary.raw("1+-2"))(), -1);
});
