import { failure, InterpreterError, type SourceSpan } from "./errors.ts";
import type { OperatorDefinition } from "./operators.ts";

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

export type Base = {
  start: number;
  end: number;
  height: number;
  grouped?: boolean;
};
export type Literal = Base & { kind: "literal"; value: unknown };
export type Reference = Base & {
  kind: "reference";
  slot: number;
  key?: string;
  label: string;
  anonymous?: number;
};
export type Operation = Base & {
  kind: "operator";
  operator: RuntimeOperator;
  operands: Node[];
  operatorSpan: SourceSpan;
};
export type Call = Base & {
  kind: "function";
  name: string;
  fn: (...args: unknown[]) => unknown;
  operands: Node[];
};
export type FragmentNode = Base & {
  kind: "fragment";
  plan: Plan;
  slotOffset: number;
  sourceOffset: number;
};
export type Node = Literal | Reference | Operation | Call | FragmentNode;

export interface Plan {
  readonly source: string;
  readonly root: Node;
  readonly references: readonly Reference[];
  readonly argumentCount: number;
  readonly composed?: true;
  readonly sourceLength?: number;
  readonly requirements?: readonly Reference[];
}

const MAX_DEPTH = 128;

/** Prepare distinct bindings once, retaining their first diagnostic location. */
export function finalize_plan(plan: Plan): Plan {
  if (plan.requirements !== undefined) return plan;
  const seen = new Map<number, Set<string | undefined>>();
  const requirements: Reference[] = [];
  for (const ref of plan.references) {
    let keys = seen.get(ref.slot);
    if (keys === undefined) {
      keys = new Set();
      seen.set(ref.slot, keys);
    }
    if (keys.has(ref.key)) continue;
    keys.add(ref.key);
    requirements.push(ref);
  }
  Object.defineProperty(plan, "requirements", { value: requirements });
  if (plan.sourceLength === undefined) {
    Object.defineProperty(plan, "sourceLength", { value: plan.source.length });
  }
  return plan;
}

function validate(plan: Plan, values: readonly unknown[]): void {
  for (const ref of plan.requirements ?? plan.references) {
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

type Evaluation = (values: readonly unknown[], steps?: TraceStep[]) => unknown;

function lazy_operand(
  read: Evaluation,
  values: readonly unknown[],
  steps?: TraceStep[],
  operands?: unknown[],
  index = 0,
): () => unknown {
  let done = false;
  let value: unknown;
  return () => {
    if (!done) {
      value = read(values, steps);
      if (operands !== undefined) operands[index] = value;
      done = true;
    }
    return value;
  };
}

/** Compile ordinary, replacement, and traced execution separately. */
function evaluator(
  node: Node,
  plan: Plan,
  hook: InterpreterApplyOperator | undefined,
  tracing: boolean,
  slotOffset = 0,
  sourceOffset = 0,
): Evaluation {
  if (node.kind === "fragment") {
    return evaluator(
      node.plan.root,
      plan,
      hook,
      tracing,
      slotOffset + node.slotOffset,
      sourceOffset + node.sourceOffset,
    );
  }
  if (node.kind === "literal") return () => node.value;
  if (node.kind === "reference") {
    const slot = node.slot + slotOffset;
    const key = node.key;
    if (key !== undefined) {
      return (values) => (values[slot] as Record<string, unknown>)[key];
    }
    return (values) => values[slot];
  }
  const children = node.operands.map((child) =>
    evaluator(child, plan, hook, tracing, slotOffset, sourceOffset)
  );
  let name: string;
  let location: SourceSpan = node;
  if (node.kind === "function") name = node.name;
  else {
    name = node.operator.token;
    location = node.operatorSpan;
  }
  const span = Object.freeze({
    start: location.start + sourceOffset,
    end: location.end + sourceOffset,
  });
  let apply: Evaluation;
  if (tracing || hook !== undefined) {
    apply = (values, steps) => {
      const operands: unknown[] = [];
      let result: unknown;
      if (
        node.kind === "operator" && hook === undefined &&
        node.operator.definition.arity === 2 &&
        node.operator.definition.lazy !== undefined
      ) {
        result = node.operator.definition.lazy(
          lazy_operand(children[0], values, steps, operands, 0),
          lazy_operand(children[1], values, steps, operands, 1),
        );
      } else {
        for (const child of children) operands.push(child(values, steps));
        if (node.kind === "function") {
          const fn = node.fn;
          result = fn(...operands);
        } else if (hook !== undefined) {
          result = hook(node.operator, ...operands);
        } else if (node.operator.definition.arity === 1) {
          result = node.operator.definition.apply(operands[0]);
        } else {result = node.operator.definition.apply(
            operands[0],
            operands[1],
          );}
      }
      if (tracing) {
        steps!.push({ kind: node.kind, name, span, operands, result });
      }
      return result;
    };
  } else if (node.kind === "function") {
    const fn = node.fn;
    if (children.length === 0) apply = () => fn();
    else if (children.length === 1) apply = (values) => fn(children[0](values));
    else if (children.length === 2) {
      apply = (values) => fn(children[0](values), children[1](values));
    } else if (children.length === 3) {
      apply = (values) =>
        fn(children[0](values), children[1](values), children[2](values));
    } else apply = (values) => fn(...children.map((child) => child(values)));
  } else {
    const definition = node.operator.definition;
    if (definition.arity === 1) {
      apply = (values) => definition.apply(children[0](values));
    } else if (definition.lazy !== undefined) {
      apply = (values) =>
        definition.lazy!(
          lazy_operand(children[0], values),
          lazy_operand(children[1], values),
        );
    } else {apply = (values) =>
        definition.apply(children[0](values), children[1](values));}
  }
  return (values, steps) => {
    try {
      return apply(values, steps);
    } catch (cause) {
      if (cause instanceof InterpreterError) throw cause;
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
  };
}

/** Construct a reusable evaluator without per-invocation evaluator closures. */
export function prepare_execution(
  plan: Plan,
  hook?: InterpreterApplyOperator,
): Evaluation {
  finalize_plan(plan);
  let ordinary: Evaluation | undefined;
  let traced: Evaluation | undefined;
  return (values, steps) => {
    validate(plan, values);
    if (steps === undefined) {
      if (ordinary === undefined) {
        ordinary = evaluator(plan.root, plan, hook, false);
      }
      return ordinary(values);
    }
    if (traced === undefined) traced = evaluator(plan.root, plan, hook, true);
    return traced(values, steps);
  };
}

/** Share operand trees; only binding locations and source offsets are composed. */
export function combine_plans(
  operator: RuntimeOperator,
  plans: readonly Plan[],
): Plan {
  let source: string | undefined;
  let slotOffset = 0;
  let sourceOffset = 1;
  if (plans.length === 1) sourceOffset += operator.token.length + 1;
  const references: Reference[] = [];
  const operands: Node[] = [];
  for (const plan of plans) {
    operands.push({
      kind: "fragment",
      plan,
      slotOffset,
      sourceOffset,
      start: sourceOffset,
      end: sourceOffset + plan.root.end,
      height: plan.root.height,
    });
    for (const ref of plan.requirements ?? plan.references) {
      references.push({
        ...ref,
        slot: ref.slot + slotOffset,
        start: ref.start + sourceOffset,
        end: ref.end + sourceOffset,
      });
    }
    slotOffset += plan.argumentCount;
    sourceOffset += (plan.sourceLength ?? plan.source.length) +
      operator.token.length + 4;
  }
  let opStart = 0;
  if (plans.length === 2) {
    opStart = (plans[0].sourceLength ?? plans[0].source.length) + 3;
  }
  let end = (plans[0].sourceLength ?? plans[0].source.length) +
    operator.token.length + 3;
  if (plans.length === 2) {
    end += (plans[1].sourceLength ?? plans[1].source.length) + 3;
  }
  const root: Operation = {
    kind: "operator",
    operator: Object.freeze(operator),
    operands,
    operatorSpan: { start: opStart, end: opStart + operator.token.length },
    start: 0,
    end,
    height: Math.max(...operands.map((node) => node.height)) + 1,
  };
  const combined: Plan = {
    get source() {
      if (source === undefined) {
        const sources = plans.map((plan) => "(" + plan.source + ")");
        if (plans.length === 1) source = operator.token + " " + sources[0];
        else source = sources[0] + " " + operator.token + " " + sources[1];
      }
      return source;
    },
    sourceLength: end,
    root,
    references,
    argumentCount: slotOffset,
    composed: true,
  };
  if (root.height > MAX_DEPTH) {
    throw failure(
      "limit",
      "expression exceeds maximum tree depth of " + MAX_DEPTH,
      combined.source,
      root,
    );
  }
  return finalize_plan(combined);
}
