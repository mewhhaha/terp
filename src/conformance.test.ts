import {
  interpreter,
  InterpreterError,
  number_operator,
  number_unary_operator,
  operator,
} from "../mod.ts";
import {
  corpus,
  evaluate,
  invalid_mutations,
  source,
} from "../scripts/corpus.ts";
import { assert_equals, assert_true } from "./assert.ts";

Deno.test("generated grammar agrees with a tree oracle and source-order trace", () => {
  const actual_trace: string[] = [];
  const language = interpreter({
    "+": number_operator(6, "left", (a, b) => {
      actual_trace.push("+");
      return a + b;
    }),
    "*": number_operator(7, "left", (a, b) => {
      actual_trace.push("*");
      return a * b;
    }),
    "-": operator(
      number_operator(6, "left", (a, b) => {
        actual_trace.push("-");
        return a - b;
      }),
      number_unary_operator(8, (a) => {
        actual_trace.push("negate");
        return -a;
      }),
    ),
  });
  for (const tree of corpus()) {
    const expression = source(tree);
    actual_trace.length = 0;
    const compiled = language.raw(expression);
    assert_true(
      typeof compiled === "function",
      "generated source must compile: " + expression,
    );
    assert_equals(actual_trace, [], "validation must not execute operators");
    if (compiled instanceof Error) throw compiled;
    for (const args of [[7, 3], [-4, 0], [0, 11]]) {
      actual_trace.length = 0;
      const expected_trace: string[] = [];
      const expected = evaluate(tree, args, expected_trace);
      assert_equals(compiled(...args), expected, expression);
      assert_equals(
        actual_trace,
        expected_trace,
        "source-order evaluation: " + expression,
      );
    }
    for (const invalid of invalid_mutations(expression)) {
      assert_true(
        language.raw(invalid) instanceof InterpreterError,
        "mutation must fail: " + invalid,
      );
    }
  }
});

Deno.test("generated identifier suffixes preserve word boundaries and own-only calls", () => {
  let inherited_calls = 0;
  const prototype = {
    inherited(value: number) {
      inherited_calls += 1;
      return value;
    },
  };
  for (const suffix of ["end", "_value", "2", "$value"]) {
    const name = "add" + suffix;
    const values = Object.assign(Object.create(prototype), {
      [name]: 5,
      identity(value: number) {
        return value;
      },
    }) as Record<string, unknown>;
    const language = interpreter({
      add: number_operator(6, "left", (a, b) => a + b),
    }, { values });
    const runner = language.raw("identity (?0 add " + name + ")");
    if (runner instanceof Error) throw runner;
    assert_equals(runner(7), 12, name);
    assert_true(
      language.raw("inherited ?0") instanceof InterpreterError,
      "prototype functions are not expression values",
    );
  }
  assert_equals(inherited_calls, 0);
});
