import { interpreter, op } from "../mod.ts";

type Guard<value> = (value: unknown) => value is value;
type UnaryFunction = (value: unknown) => unknown;
type Point = { x: number; y: number };

const unary_function: Guard<UnaryFunction> = (
  value,
): value is UnaryFunction => {
  return typeof value === "function";
};

const point: Guard<Point> = (value): value is Point => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<Point>;

  return typeof candidate.x === "number" && typeof candidate.y === "number";
};

const pipe = op("'pipe' | infixl 1 ?", (value: unknown, fn: UnaryFunction) => {
  return checked(fn, unary_function)(value);
});
const functions = interpreter({
  then: pipe,
  near: op("'geometry' | infix 4 ?", (left: Point, right: Point) => {
    const from = checked(left, point);
    const to = checked(right, point);
    return Math.hypot(from.x - to.x, from.y - to.y) <= 10;
  }),
  quadrant: op("'geometry' | prefix 8 ?", (value: Point) => {
    const position = checked(value, point);
    if (position.x >= 0 && position.y >= 0) {
      return "NE";
    }
    return "other";
  }),
});

const trim = (value: unknown) => String(value).trim();
const shout = (value: unknown) => String(value).toUpperCase() + "!";
const named_functions = interpreter({
  then: pipe,
}, {
  values: {
    trim,
    shout,
  },
});
const trim_step = named_functions.fragment("trim");
const shout_step = named_functions.fragment("shout");

if (trim_step instanceof Error) {
  throw trim_step;
}

if (shout_step instanceof Error) {
  throw shout_step;
}

const composed_pipeline = named_functions
  .raw`? then ${trim_step} then ${shout_step}`;

if (composed_pipeline instanceof Error) {
  throw composed_pipeline;
}

console.log("functions", {
  pipeline: functions("? then ? then ?", " hello ", trim, shout),
  composed: composed_pipeline(" hello "),
  near: functions("?from near ?to", {
    from: { x: 0, y: 0 },
    to: { x: 3, y: 4 },
  }),
  quadrant: functions("quadrant ?point", { point: { x: 3, y: 4 } }),
});

function checked<value>(value: unknown, guard: Guard<value>): value {
  if (!guard(value)) {
    throw new TypeError("operator rejected an operand");
  }
  return value;
}
