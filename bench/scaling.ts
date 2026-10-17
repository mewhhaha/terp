import {
  interpreter,
  number_operator,
  type OperatorRegistry,
  terp,
} from "../mod.ts";

/** Independent axes expose scaling without an expensive Cartesian product. */
export function scaling_cases(): Record<string, () => unknown> {
  const cases: Record<string, () => unknown> = {};
  for (const size of [0, 10, 100, 1000]) {
    const operators: Record<string, OperatorRegistry[string]> = {};
    const values: Record<string, number> = {};
    for (let index = 0; index < size; index++) {
      operators["operator" + index] = number_operator(
        6,
        "left",
        (a, b) => a + b,
      );
      values["value" + index] = index;
    }
    const vocabulary = interpreter(operators, { values });
    const operators_only = interpreter(operators);
    const values_only = interpreter({}, { values });
    cases["scale/operators/construct/" + size] = () => interpreter(operators);
    cases["scale/values/construct/" + size] = () => interpreter({}, { values });
    let source = "1";
    let expected = 1;
    if (size > 0) {
      source = "value" + (size - 1) + " operator" + (size - 1) + " 2";
      expected = size + 1;
    }
    cases["scale/vocabulary/parse/" + size] = () => vocabulary.raw(source);
    let operator_source = "1";
    let value_source = "1";
    let operator_expected = 1;
    let value_expected = 1;
    if (size > 0) {
      operator_source = "1 operator" + (size - 1) + " 2";
      value_source = "value" + (size - 1);
      operator_expected = 3;
      value_expected = size - 1;
    }
    const operator_run = operators_only.raw(operator_source);
    const value_run = values_only.raw(value_source);
    if (operator_run instanceof Error || operator_run() !== operator_expected) {
      throw new Error(operator_source);
    }
    if (value_run instanceof Error || value_run() !== value_expected) {
      throw new Error(value_source);
    }
    cases["scale/operators/parse/" + size] = () =>
      operators_only.raw(operator_source);
    cases["scale/values/parse/" + size] = () => values_only.raw(value_source);
    const run = vocabulary.raw(source);
    if (run instanceof Error || run() !== expected) throw new Error(source);
    cases["scale/vocabulary/run/" + size] = run;
    for (const prefix of ["", "v", "value9", "missing", "1 operator9"]) {
      cases[
        "scale/completion/" + size + "/" +
        (prefix || "empty").replaceAll(" ", "_")
      ] = () => vocabulary.complete(prefix);
    }
  }
  for (const size of [4, 32, 96]) {
    const flat = Array.from({ length: size }, () => "1").join(" + ");
    const nested = "(".repeat(size) + "1" + ")".repeat(size);
    for (
      const [shape, source, expected] of [["flat", flat, size], [
        "nested",
        nested,
        1,
      ]] as const
    ) {
      const run = terp.raw(source);
      if (run instanceof Error || run() !== expected) throw new Error(source);
      cases["scale/source/" + shape + "/" + size] = () => terp.raw(source);
    }
  }
  for (const size of [1, 4, 16]) {
    const source = Array.from({ length: size }, (_, index) => "?" + index).join(
      " + ",
    );
    const values = Array.from({ length: size }, () => 1);
    const run = terp.raw(source);
    if (run instanceof Error || run(...values) !== size) {
      throw new Error(source);
    }
    cases["scale/arguments/" + size] = () => run(...values);
  }
  for (
    const [shape, source] of Object.entries({
      empty: "",
      trailing: "1 +",
      group: "1 + (2 *",
      unknown: "unknown",
      quote: "'unfinished",
      depth: "(".repeat(140) + "1" + ")".repeat(140),
    })
  ) {
    if (!(terp.raw(source) instanceof Error)) throw new Error(shape);
    cases["scale/invalid/" + shape] = () => terp.raw(source);
  }
  return cases;
}
