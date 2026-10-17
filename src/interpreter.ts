import { caught, failure, InterpreterError } from "./errors.ts";
import type {
  CheckedExpression,
  HasReferences,
  StringExpressionArgs,
  StringExpressionType,
} from "./expression_types.ts";
import {
  get_operator_from,
  type OperatorDefinition,
  type OperatorEntry,
  type OperatorRegistry,
  operators as validate_operators,
  standard_operators,
  type StandardOperators,
} from "./operators.ts";
import {
  combine_plans,
  compile,
  type Completion,
  completions,
  execute,
  type InterpreterApplyOperator,
  make_grammar,
  type Plan,
  type TraceStep,
} from "./runtime.ts";

export { InterpreterError } from "./errors.ts";
export type { InterpreterErrorCode, SourceSpan } from "./errors.ts";
export type {
  Completion,
  InterpreterApplyOperator,
  RuntimeOperator,
  TraceStep,
} from "./runtime.ts";
/** Named constants and callable vocabulary. Values are shallow-snapshotted. */
export type ValueRegistry = Readonly<Record<string, unknown>>;
/** @internal Empty vocabulary used by default. */
export type EmptyValueRegistry = Record<never, never>;
/** A reusable typed literal expression. */
export type StringRunner<
  O extends OperatorRegistry,
  E extends string,
  V extends ValueRegistry = EmptyValueRegistry,
  P extends readonly string[] = readonly [],
> = (
  ...values: StringExpressionArgs<O, V, E, P>
) => StringExpressionType<O, V, E, P>;
/** Runtime expressions accept arguments checked at execution time. */
export type RawStringRunner = (...values: unknown[]) => unknown;
/** Either a compiled runner or a located validation error. */
export type RawStringResult = RawStringRunner | InterpreterError;
/** A validated expression with a typed runner, owned by one interpreter. */
export interface ExpressionFragment<
  R = unknown,
  A extends readonly unknown[] = readonly unknown[],
> {
  /** Display source. Structural composition retains independent argument bindings. */
  readonly expression: string;
  /** Execute the already-compiled fragment. */
  run(...values: A): R;
  /** Return the display source. */
  toString(): string;
}
/** Fragment validation result. */
export type ExpressionFragmentResult = ExpressionFragment | InterpreterError;
/** Runtime validators that establish a typed boundary around dynamic input. */
export interface ExpressionGuards<A extends readonly unknown[], R> {
  /** Validate the complete argument tuple before application code runs. */
  readonly arguments: (values: readonly unknown[]) => values is A;
  /** Validate the completed expression result. */
  readonly result: (value: unknown) => value is R;
}
/** Execution output together with operations that actually ran. */
export interface Explanation {
  /** Completed expression value. */
  readonly value: unknown;
  /** Completed operations in execution order. */
  readonly steps: readonly TraceStep[];
}
/** Vocabulary, optional word prefixes, and an operator replacement hook. */
export interface InterpreterOptions<
  V extends ValueRegistry = EmptyValueRegistry,
  P extends readonly string[] = readonly [],
  Hook extends InterpreterApplyOperator | undefined =
    | InterpreterApplyOperator
    | undefined,
> {
  /** Named constants and functions. */
  readonly values?: V;
  /** Additional prefixes for callable word arguments. */
  readonly word_prefixes?: P;
  /** Replacement hooks make expression results unknown at the type boundary. */
  readonly apply_operator?: Hook;
}
/** @internal */
type Result<H extends boolean, T> = H extends true ? unknown : T;
/** @internal */
type Definition<E, A extends 1 | 2> = E extends readonly unknown[]
  ? Extract<E[number], { arity: A }>
  : Extract<E, { arity: A }>;
/** @internal */
type Tokens<O, A extends 1 | 2> = {
  [K in keyof O & string]: [Definition<O[K], A>] extends [never] ? never : K;
}[keyof O & string];
/** @internal */
type Inputs<D> = D extends { apply: (...args: infer A) => unknown } ? A : never;
/** @internal */
type Input<D, I extends number> = Inputs<D> extends
  infer P extends readonly unknown[]
  ? number extends P["length"] ? P[I] : `${I}` extends keyof P ? P[I] : unknown
  : unknown;
/** @internal */
type Output<D> = D extends { apply: (...args: never[]) => infer R } ? R
  : unknown;
/** @internal */
type Checked<
  O extends OperatorRegistry,
  V extends ValueRegistry,
  E extends string,
  P extends readonly string[],
> =
  & E
  & (CheckedExpression<O, V, E, P> extends E ? unknown
    : { readonly expression_error: CheckedExpression<O, V, E, P> });
/** Callable expression language. Parsing is pure and runners retain the parsed tree. */
export interface Interpreter<
  O extends OperatorRegistry,
  V extends ValueRegistry = EmptyValueRegistry,
  P extends readonly string[] = readonly [],
  H extends boolean = false,
> {
  /** Immutable operator snapshot. */
  readonly operators: O;
  /** Immutable vocabulary snapshot. */
  readonly values: V;
  /** Look up a registered operator. */
  get<const K extends keyof O & string>(token: K): O[K];
  /** Look up a runtime operator token. */
  get(token: string): OperatorEntry | undefined;
  /** Look up a named value. */
  get_value<const K extends keyof V & string>(name: K): V[K];
  /** Look up a runtime value name. */
  get_value(name: string): unknown;
  /** Validate a fragment and preserve its literal input and output types. */
  fragment<const E extends string>(
    expression: E,
  ):
    | ExpressionFragment<
      Result<H, StringExpressionType<O, V, E, P>>,
      StringExpressionArgs<O, V, E, P>
    >
    | InterpreterError;
  /** Compile a runtime expression. */
  raw(expression: string): RawStringResult;
  /** Compose grouped fragments from this interpreter; indexed/named bindings are shared. */
  raw(
    strings: TemplateStringsArray,
    ...fragments: readonly ExpressionFragment[]
  ): RawStringResult;
  /** Compose independent argument tuples in operand order. */
  combine<const K extends Tokens<O, 1>, A extends readonly unknown[]>(
    token: K,
    operand: ExpressionFragment<Input<Definition<O[K], 1>, 0>, A>,
  ):
    | ExpressionFragment<Result<H, Output<Definition<O[K], 1>>>, A>
    | InterpreterError;
  /** Compose independent binary input bindings. */
  combine<
    const K extends Tokens<O, 2>,
    A extends readonly unknown[],
    B extends readonly unknown[],
  >(
    token: K,
    left: ExpressionFragment<Input<Definition<O[K], 2>, 0>, A>,
    right: ExpressionFragment<Input<Definition<O[K], 2>, 1>, B>,
  ):
    | ExpressionFragment<
      Result<H, Output<Definition<O[K], 2>>>,
      readonly [...A, ...B]
    >
    | InterpreterError;
  /** Compile dynamic input with explicit argument and result validation. */
  checked<A extends readonly unknown[], R>(
    expression: string,
    guards: ExpressionGuards<A, R>,
  ): ((...values: A) => R) | InterpreterError;
  /** Evaluate once while recording completed calls and operators. */
  explain(
    expression: string,
    ...values: readonly unknown[]
  ): Explanation | InterpreterError;
  /** Offer vocabulary completions valid at a cursor position. */
  complete(expression: string, cursor?: number): readonly Completion[];
  /** Evaluate a literal or return its typed runner when placeholders are unbound. */
  <const E extends string>(
    expression: Checked<O, V, E, P>,
  ): HasReferences<O, V, E, P> extends true ? (
      ...values: StringExpressionArgs<O, V, E, P>
    ) => Result<H, StringExpressionType<O, V, E, P>>
    : Result<H, StringExpressionType<O, V, E, P>>;
  <const E extends string>(
    expression: Checked<O, V, E, P>,
    ...values: StringExpressionArgs<O, V, E, P>
  ): Result<H, StringExpressionType<O, V, E, P>>;
}
/** Build a language with replacement semantics and unknown expression results. */
export function interpreter<
  const O extends OperatorRegistry,
  const V extends ValueRegistry = EmptyValueRegistry,
  const P extends readonly string[] = readonly [],
>(
  operators: O,
  options: InterpreterOptions<V, P> & {
    readonly apply_operator: InterpreterApplyOperator;
  },
): Interpreter<O, V, P, true>;
/** Build an expression language from an immutable snapshot of its vocabulary. */
export function interpreter<
  const O extends OperatorRegistry,
  const V extends ValueRegistry = EmptyValueRegistry,
  const P extends readonly string[] = readonly [],
>(
  operators: O,
  options?: InterpreterOptions<V, P, undefined>,
): Interpreter<O, V, P>;
export function interpreter(
  operators: OperatorRegistry,
  options: InterpreterOptions<ValueRegistry, readonly string[]> = {},
): unknown {
  validate_operators(operators);
  const grammar = make_grammar(
    operators,
    options.values ?? {},
    options.word_prefixes ?? [],
  );
  const hook = options.apply_operator;
  const fragments = new WeakMap<ExpressionFragment, Plan>();
  const make_fragment = (plan: Plan): ExpressionFragment => {
    const fragment: ExpressionFragment = Object.freeze({
      expression: plan.source,
      run(...values: unknown[]) {
        return execute(plan, values, hook);
      },
      toString() {
        return plan.source;
      },
    });
    fragments.set(fragment, plan);
    return fragment;
  };
  const instance = (expression: string, ...values: unknown[]): unknown => {
    const plan = compile(grammar, expression);
    if (values.length === 0 && plan.references.length > 0) {
      return (...arguments_: unknown[]) => execute(plan, arguments_, hook);
    }
    return execute(plan, values, hook);
  };
  const raw = (
    expression: string | TemplateStringsArray,
    ...parts: readonly ExpressionFragment[]
  ): RawStringResult => {
    try {
      if (typeof expression !== "string") {
        if (!Array.isArray(expression)) {
          throw failure("fragment", "raw template expected a string array");
        }
        if (expression.length !== parts.length + 1) {
          throw failure(
            "fragment",
            "raw template expected one more string than fragment",
          );
        }
        if (expression.some((part) => typeof part !== "string")) {
          throw failure("fragment", "raw template expected string chunks");
        }
        let source = expression[0];
        for (let i = 0; i < parts.length; i++) {
          const plan = fragments.get(parts[i]);
          if (plan === undefined) {
            throw failure(
              "fragment",
              "raw template interpolations must be fragments from this interpreter",
            );
          }
          if (plan.composed) {
            throw failure(
              "fragment",
              "combined fragments retain independent arguments; use run or combine",
            );
          }
          source += "(" + plan.source + ")" + expression[i + 1];
        }
        expression = source;
      }
      if (typeof expression !== "string") {
        throw failure("fragment", "raw template expected string chunks");
      }
      const plan = compile(grammar, expression);
      return (...values: unknown[]) => execute(plan, values, hook);
    } catch (error) {
      return caught(error);
    }
  };
  Object.defineProperties(instance, {
    operators: { value: grammar.operators },
    values: { value: grammar.values },
    get: {
      value: (token: string) => get_operator_from(grammar.operators, token),
    },
    get_value: {
      value: (name: string) => {
        if (Object.hasOwn(grammar.values, name)) return grammar.values[name];
        return undefined;
      },
    },
    raw: { value: raw },
    fragment: {
      value: (expression: string): ExpressionFragmentResult => {
        try {
          return make_fragment(compile(grammar, expression));
        } catch (error) {
          return caught(error);
        }
      },
    },
    combine: {
      value: (
        token: string,
        ...parts: ExpressionFragment[]
      ): ExpressionFragmentResult => {
        try {
          const plans = parts.map((part) => {
            const plan = fragments.get(part);
            if (plan === undefined) {
              throw failure(
                "fragment",
                "composition requires fragments from this interpreter",
              );
            }
            return plan;
          });
          const entry = get_operator_from(grammar.operators, token);
          if (entry === undefined) {
            throw failure(
              "fragment",
              "operator `" + token + "` is not defined",
            );
          }
          let definitions: readonly OperatorDefinition[] = [
            entry as OperatorDefinition,
          ];
          if (Array.isArray(entry)) definitions = entry;
          const definition = definitions.find((definition) =>
            definition.arity === plans.length
          );
          if (definition === undefined) {
            throw failure(
              "fragment",
              "operator `" + token + "` has incompatible arity",
            );
          }
          return make_fragment(combine_plans({ token, definition }, plans));
        } catch (error) {
          return caught(error);
        }
      },
    },
    checked: {
      value: (
        expression: string,
        guards: ExpressionGuards<readonly unknown[], unknown>,
      ): RawStringResult => {
        const runner = raw(expression);
        if (runner instanceof InterpreterError) return runner;
        return (...values: unknown[]) => {
          try {
            if (!guards.arguments(values)) {
              throw failure(
                "validation",
                "expression arguments failed validation",
                expression,
              );
            }
            const value = runner(...values);
            if (!guards.result(value)) {
              throw failure(
                "validation",
                "expression result failed validation",
                expression,
              );
            }
            return value;
          } catch (cause) {
            if (cause instanceof InterpreterError) throw cause;
            throw failure(
              "validation",
              "expression guard failed",
              expression,
              undefined,
              cause,
            );
          }
        };
      },
    },
    explain: {
      value: (
        expression: string,
        ...values: readonly unknown[]
      ): Explanation | InterpreterError => {
        try {
          const plan = compile(grammar, expression);
          const steps: TraceStep[] = [];
          const value = execute(plan, values, hook, steps);
          return { value, steps };
        } catch (error) {
          return caught(error);
        }
      },
    },
    complete: {
      value: (source: string, cursor?: number) =>
        completions(grammar, source, cursor),
    },
  });
  return instance;
}
/** Standard numeric, string, comparison, and short-circuit boolean language. */
export const terp: Interpreter<StandardOperators> = interpreter(
  standard_operators,
);
