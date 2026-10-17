import {
  boolean_operator,
  interpreter,
  InterpreterError,
  number_operator,
  number_unary_operator,
  type OperatorRegistry,
  ordering_operator,
  standard_operators,
  terp,
} from "../mod.ts";

const pricing_operators = {
  plus: number_operator(6, "left", (a, b) => a + b),
  minus: number_operator(6, "left", (a, b) => a - b),
  times: number_operator(7, "left", (a, b) => a * b),
  pct: number_unary_operator(8, (a) => a / 100),
};
const pricing = interpreter(pricing_operators);
const quote = { base: 5000, seats: 12, seat_price: 75, discount: 10 };
const price_source =
  "(?base plus ?seats times ?seat_price) times (1 minus pct ?discount)";
const price = pricing(price_source);
const rules = interpreter({
  above: ordering_operator((a, b) => a > b),
  below: ordering_operator((a, b) => a < b),
  and: boolean_operator(3, "right", (a, b) => a && b),
});
const rule_source = "?amount above 10000 and ?risk below 0.35";
const rule = rules(rule_source);
const order = { amount: 42000, risk: 0.28 };
const arithmetic = terp("?0 + ?1 * 3");
const raw_arithmetic = terp.raw("?0 + ?1 * 3");
if (raw_arithmetic instanceof Error) throw raw_arithmetic;
const large_registry: Record<string, OperatorRegistry[string]> = {
  ...standard_operators,
};
for (let index = 0; index < 100; index += 1) {
  large_registry["op" + index] = number_operator(6, "left", (a, b) => a + b);
}
const large = interpreter(large_registry);
const nested = "(".repeat(24) + "?0 + 1" + ")".repeat(24);

/** Shared cases for the sampler; return values are consumed by that runner. */
const cases: Record<string, () => unknown> = {
  "construct/small": () => interpreter(pricing_operators),
  "construct/large-100": () => interpreter(large_registry),
  "raw/arithmetic": () => terp.raw("?0 + ?1 * 3"),
  "raw/invalid": () => terp.raw("1 + (2 *"),
  "raw/large-100": () => large.raw("1 op99 2 * 3"),
  "raw/nesting-24": () => terp.raw(nested),
  "run/arithmetic-reused": () => arithmetic(4, 5),
  "run/arithmetic-direct": () => terp("?0 + ?1 * 3", 4, 5),
  "run/arithmetic-raw": () => raw_arithmetic(4, 5),
  "run/pricing-reused": () => price(quote),
  "run/pricing-direct": () => pricing(price_source, quote),
  "run/rules-reused": () => rule(order),
  "run/rules-direct": () => rules(rule_source, order),
};

// Feature detection keeps this same workload executable on the before revision.
if ("checked" in terp) {
  const checked = terp.checked("?0 + ?1 * 3", {
    arguments(values): values is readonly [number, number] {
      return values.length === 2 && typeof values[0] === "number" &&
        typeof values[1] === "number";
    },
    result(value): value is number {
      return typeof value === "number" && Number.isFinite(value);
    },
  });
  if (checked instanceof Error) throw checked;
  const left = terp.fragment("?0 + 1");
  const right = terp.fragment("?0 * 2");
  if (left instanceof Error) throw left;
  if (right instanceof Error) throw right;
  const combined = terp.combine("+", left, right);
  if (combined instanceof Error) throw combined;
  const template = terp.raw`${left} + ${right}`;
  if (template instanceof Error) throw template;
  cases["run/arithmetic-checked"] = () => checked(4, 5);
  cases["run/arithmetic-explain"] = () => {
    const result = terp.explain("?0 + ?1 * 3", 4, 5);
    if (result instanceof Error) throw result;
    return result.value;
  };
  cases["run/fragment-typed"] = () => left.run(4);
  cases["run/composed-independent"] = () => combined.run(4, 5);
  cases["run/composed-template"] = () => template(4);
  cases["complete/operator-prefix"] = () => terp.complete("1 + ");
}

/** Available cases; feature-only cases have no artificial legacy baseline. */
export const runtime_cases: Readonly<Record<string, () => unknown>> = cases;

/** Verify benchmark work before timing it, so an error path cannot look faster. */
export function validate_runtime_cases(): void {
  const expected: Record<string, unknown> = {
    "run/arithmetic-reused": 19,
    "run/arithmetic-direct": 19,
    "run/arithmetic-raw": 19,
    "run/arithmetic-checked": 19,
    "run/arithmetic-explain": 19,
    "run/fragment-typed": 5,
    "run/composed-independent": 15,
    "run/composed-template": 13,
    "run/pricing-reused": 5310,
    "run/pricing-direct": 5310,
    "run/rules-reused": true,
    "run/rules-direct": true,
  };
  for (const [name, run] of Object.entries(runtime_cases)) {
    const result = run();
    if (name === "raw/invalid") {
      if (!(result instanceof InterpreterError)) {
        throw new Error(name + " should reject malformed input");
      }
    } else if (name.startsWith("complete/")) {
      if (!Array.isArray(result)) {
        throw new Error(name + " must produce completion candidates");
      }
    } else if (Object.hasOwn(expected, name)) {
      if (result !== expected[name]) {
        throw new Error(name + " produced an incorrect result");
      }
    } else if (typeof result !== "function") {
      throw new Error(name + " failed to construct a runner/interpreter");
    }
  }
}
