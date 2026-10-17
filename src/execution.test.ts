import { assert_equals, assert_true } from "./assert.ts";
import {
  interpreter,
  InterpreterError,
  number_operator,
  standard_operators,
  terp,
} from "../mod.ts";
import { combine_plans, prepare_execution } from "./execution.ts";
import { compile, make_grammar } from "./runtime.ts";

function ok<T>(value: T | InterpreterError): T {
  if (value instanceof InterpreterError) throw value;
  return value;
}

Deno.test("prepared fragments explain repeatedly with immutable operation spans", () => {
  const fragment = ok(terp.fragment("?0 + ?1 * 3"));
  const first = ok(fragment.explain(4, 5));
  const next = ok(fragment.explain(1, 2));
  assert_equals(first.value, 19);
  assert_equals(next.value, 7);
  assert_equals(first.steps.map((step) => step.operands), [[5, 3], [4, 15]]);
  assert_true(Object.isFrozen(first.steps[0].span), "span is immutable");
  assert_true(
    first.steps[0].span === next.steps[0].span,
    "prepared span is reused",
  );
  assert_true(
    first.steps[0].operands !== next.steps[0].operands,
    "trace values remain per invocation",
  );
});

Deno.test("structural plans share trees and preserve nested composition provenance", () => {
  const grammar = make_grammar(standard_operators, {}, []);
  const left = compile(grammar, "  ?0 + 1  ");
  const right = compile(grammar, "?0 * 2");
  const plus = grammar.operators["+"];
  assert_true(!Array.isArray(plus), "binary plus");
  const combined = combine_plans({
    token: "+",
    definition: plus as typeof standard_operators["+"],
  }, [left, right]);
  assert_true(combined.root.kind === "operator", "combined root");
  if (combined.root.kind !== "operator") return;
  const bound = combined.root.operands[0];
  assert_true(
    bound.kind === "fragment" && bound.plan.root === left.root,
    "operand tree is shared",
  );
  const prepared = prepare_execution(combined);
  const steps: import("./execution.ts").TraceStep[] = [];
  assert_equals(prepared([2, 4], steps), 11);
  for (const step of steps) {
    assert_equals(
      combined.source.slice(step.span.start, step.span.end),
      step.name,
    );
  }
  const leftFragment = ok(terp.fragment("  ?0 + 1  "));
  const rightFragment = ok(terp.fragment("?0 * 2"));
  const sum = ok(terp.combine("+", leftFragment, rightFragment));
  const negated = ok(terp.combine("-", sum));
  const trace = ok(negated.explain(2, 4));
  assert_equals(trace.value, -11);
  for (const step of trace.steps) {
    assert_equals(
      negated.expression.slice(step.span.start, step.span.end),
      step.name,
    );
  }
});

Deno.test("function arity specialization preserves detached callbacks and argument order", () => {
  const log: number[] = [];
  const language = interpreter({}, {
    values: {
      inspect: function (this: unknown, ...args: unknown[]) {
        assert_equals(this, undefined);
        return args;
      },
      tick(value: number) {
        log.push(value);
        return value;
      },
    },
  });
  for (
    const source of [
      "inspect 1",
      "inspect 1 2",
      "inspect 1 2 3",
      "inspect 1 2 3 4",
    ]
  ) {
    assert_equals(
      ok(language.raw(source))(),
      source.split(" ").slice(1).map(Number),
    );
  }
  assert_equals(ok(language.raw("inspect (tick 1) (tick 2) (tick 3)"))(), [
    1,
    2,
    3,
  ]);
  assert_equals(log, [1, 2, 3]);
});

Deno.test("prepared execution remains reentrant and validates bindings before effects", () => {
  let calls = 0;
  const language = interpreter(standard_operators, {
    values: {
      descend(value: number): number {
        calls++;
        if (value === 0) return 0;
        return Number(recurse(value - 1));
      },
    },
  });
  const recurse: (value: unknown) => unknown = ok(
    language.raw("descend ?0 + 1"),
  );
  assert_equals(recurse(3), 4);
  assert_equals(calls, 4);
  calls = 0;
  const bad = ok(language.raw("descend 1 + ?missing"));
  try {
    bad({});
  } catch (error) {
    assert_true(error instanceof InterpreterError, "binding error");
  }
  assert_equals(calls, 0);
});

Deno.test("repeated named bindings are checked once without caching live property reads", () => {
  let validations = 0;
  let reads = 0;
  const scope = new Proxy({ amount: 2 }, {
    getOwnPropertyDescriptor(target, key) {
      validations++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target, key) {
      reads++;
      return Reflect.get(target, key);
    },
  });
  const run = ok(terp.raw("?amount + ?amount * ?amount"));
  assert_equals(run(scope), 6);
  assert_equals(validations, 1);
  assert_equals(reads, 3);
});

Deno.test("compilation never executes application callbacks even for constants", () => {
  let calls = 0;
  const language = interpreter({
    add: number_operator(6, "left", (a, b) => {
      calls++;
      return a + b;
    }),
  });
  const run = ok(language.raw("1 add 2"));
  assert_equals(calls, 0);
  assert_equals(run(), 3);
  assert_equals(run(), 3);
  assert_equals(calls, 2);
});

Deno.test("lazy memoized operands survive reentry and retained thunks", () => {
  let calls = 0;
  let retained: (() => unknown) | undefined;
  const language = interpreter({
    choose: {
      kind: "custom",
      arity: 2,
      precedence: 1,
      direction: "left",
      apply(a: unknown, _b: unknown) {
        return a;
      },
      lazy(left: () => unknown, right: () => unknown) {
        retained = right;
        assert_equals(left(), left());
        return left();
      },
    },
  }, {
    values: {
      tick(value: number) {
        calls++;
        return value;
      },
    },
  });
  const fragment = ok(language.fragment("tick ?0 choose tick ?1"));
  assert_equals(fragment.run(3, 7), 3);
  assert_equals(calls, 1);
  assert_true(retained !== undefined, "right thunk retained");
  assert_equals(retained!(), 7);
  assert_equals(retained!(), 7);
  assert_equals(calls, 2);
  const trace = ok(fragment.explain(5, 9));
  assert_equals(trace.value, 5);
  assert_equals(trace.steps.map((step) => step.name), ["tick", "choose"]);
  assert_equals(trace.steps[1].operands.length, 1);
});

Deno.test("combined display sources remain lazy through successful execution", () => {
  const grammar = make_grammar(standard_operators, {}, []);
  const parsed = compile(grammar, "?0 + 1");
  let displays = 0;
  const left = {
    ...parsed,
    sourceLength: parsed.source.length,
    get source() {
      displays++;
      return parsed.source;
    },
  };
  const right = compile(grammar, "?0 * 2");
  const combined = combine_plans({
    token: "+",
    definition: grammar.operators["+"] as typeof standard_operators["+"],
  }, [left, right]);
  assert_equals(prepare_execution(combined)([2, 4]), 11);
  assert_equals(displays, 0);
  assert_equals(combined.source, "(?0 + 1) + (?0 * 2)");
  assert_equals(combined.source, "(?0 + 1) + (?0 * 2)");
  assert_equals(displays, 1);
});
