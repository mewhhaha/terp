import { assert_equals, assert_true } from "./assert.ts";
import {
  interpreter,
  InterpreterError,
  number_operator,
  number_unary_operator,
  standard_operators,
} from "../mod.ts";

Deno.test("only prepared immutable registries share operator snapshots", () => {
  const entry = { ...number_operator(6, "left", (a, b) => a + b) };
  const registry = { add: entry };
  const first = interpreter(registry);
  const shared = interpreter(first.operators);
  assert_true(first.operators === shared.operators, "prepared table is reused");
  entry.apply = (a, b) => a * b;
  const second = interpreter(registry);
  assert_equals(first("2 add 3"), 5);
  assert_equals(second("2 add 3"), 6);
  assert_true(
    first.operators !== second.operators,
    "mutable input is resnapshotted",
  );
});

Deno.test("cursor scanning preserves whitespace and string escape boundaries", () => {
  const calc = interpreter(standard_operators);
  for (
    const space of [" ", "\t", "\r\n", "\v", "\f", "\u00a0", "\u2028", "\ufeff"]
  ) {
    const result = calc.raw(space + "0x10" + space + "+ .5" + space);
    if (result instanceof InterpreterError) throw result;
    assert_equals(result(), 16.5);
  }
  for (
    const [source, expected] of [
      ['""', ""],
      ['"plain"', "plain"],
      ['"a\\n\\t\\r\\\\\\"z"', 'a\n\t\r\\"z'],
      ["'a\\'b'", "a'b"],
      ['"' + "\\n".repeat(1000) + '"', "\n".repeat(1000)],
    ]
  ) {
    const result = calc.raw(source);
    if (result instanceof InterpreterError) throw result;
    assert_equals(result(), expected);
  }
});

Deno.test("indexed completions agree with candidate parsing across grammatical contexts", () => {
  const operators = {
    ...standard_operators,
    left: number_operator(5, "left", (a, b) => a + b),
    right: number_operator(5, "right", (a, b) => a + b),
    none: number_operator(5, "none", (a, b) => a + b),
    neg: number_unary_operator(2, (a) => -a),
    "++": number_operator(6, "left", (a, b) => a + b),
  };
  const values = { answer: 42, a: 1, call: (...args: unknown[]) => args };
  const calc = interpreter(operators, { values });
  const vocabulary = [
    ...Object.keys(operators).sort((a, b) => b.length - a.length),
    ...Object.keys(values),
  ];
  const heads = [
    "",
    " ",
    "1 ",
    "(",
    "(1 ",
    "call ",
    "call a ",
    "1 left 2 ",
    "1 right 2 ",
    "1 none 2 ",
    "1 right neg 2 ",
    "1 + (",
    "1 + (2 ",
    "1 + (2 + ",
    "call (",
    "1 + call ",
    "1 + call a ",
    "?",
    "1 left ?",
    "1 right 2 left neg ",
    "(! ",
    " !(! ",
  ];
  for (const head of heads) {
    const depth = [...head].filter((char) => char === "(").length;
    for (const prefix of ["", "a", "n", "+", "!", "="]) {
      const expected = vocabulary.filter((token) => {
        if (!token.startsWith(prefix)) return false;
        for (const suffix of ["", " ?"]) {
          if (
            !(calc.raw(head + token + suffix + ")".repeat(depth)) instanceof
              InterpreterError)
          ) return true;
        }
        return false;
      });
      assert_equals(
        calc.complete(head + prefix).map((item) => item.text),
        expected,
        head + prefix,
      );
    }
  }
  assert_equals(calc.complete(" ".repeat(100_001)), []);
  assert_equals(
    calc.complete("answer trailing text", 3).map((item) => item.text),
    ["answer"],
  );
});
