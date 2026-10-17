import type { OperatorDefinition } from "./operators.ts";

/** Prefix operator declaration understood by {@link op}. */
export type PrefixOperatorDeclaration = `prefix ${number} ?`;
/** Infix operator declaration understood by {@link op}. */
export type InfixOperatorDeclaration =
  | `infix ${number} ?`
  | `infixl ${number} ?`
  | `infixr ${number} ?`;

/** @internal */
type UnaryCallback = { apply(value: unknown): unknown }["apply"];
/** @internal */
type BinaryCallback = {
  apply(left: unknown, right: unknown): unknown;
}["apply"];

/** @internal */
type KindLiteral = `'${string}'` | `"${string}"`;
/** @internal */
type Kinded<declaration extends string> =
  | declaration
  | `${KindLiteral} | ${declaration}`;
/** Operator declaration understood by {@link op}. */
export type OperatorDeclaration = Kinded<
  PrefixOperatorDeclaration | InfixOperatorDeclaration
>;

/** @internal */
type DeclarationBody<declaration extends string> = declaration extends
  `${KindLiteral} | ${infer body}` ? body : declaration;
/** @internal */
type DeclarationKind<declaration extends string, fallback extends string> =
  declaration extends `'${infer kind}' | ${string}` ? kind
    : declaration extends `"${infer kind}" | ${string}` ? kind
    : fallback;
/** @internal */
type DeclarationPrecedence<declaration extends string> =
  DeclarationBody<declaration> extends
    `${string} ${infer precedence extends number} ?` ? precedence : never;
/** @internal */
type DeclarationDirection<declaration extends string> =
  DeclarationBody<declaration> extends `infixl ${string}` ? "left"
    : DeclarationBody<declaration> extends `infixr ${string}` ? "right"
    : "none";
/** @internal */
type DeclaredOperator<declaration extends string, kind extends string, fn> =
  & {
    readonly kind: DeclarationKind<declaration, kind>;
    readonly precedence: DeclarationPrecedence<declaration>;
    readonly apply: fn;
  }
  & (DeclarationBody<declaration> extends PrefixOperatorDeclaration
    ? { readonly arity: 1 }
    : {
      readonly arity: 2;
      readonly direction: DeclarationDirection<declaration>;
    });

/** Options for {@link op}. */
export interface OperatorDeclarationOptions<kind extends string = "operator"> {
  /** Category used for narrowing and lookup helpers. */
  readonly kind?: kind;
}

/** Literal declaration helper. Dynamic declarations use `op.raw`. */
export interface OperatorDeclarationBuilder<fallback extends string> {
  <
    const declaration extends Kinded<PrefixOperatorDeclaration>,
    fn extends UnaryCallback,
    const kind extends string = fallback,
  >(
    declaration: declaration,
    fn: fn,
    options?: OperatorDeclarationOptions<kind>,
  ): DeclaredOperator<declaration, kind, fn>;
  <
    const declaration extends Kinded<InfixOperatorDeclaration>,
    fn extends BinaryCallback,
    const kind extends string = fallback,
  >(
    declaration: declaration,
    fn: fn,
    options?: OperatorDeclarationOptions<kind>,
  ): DeclaredOperator<declaration, kind, fn>;
}

/** Operator declarations with explicit handling for dynamic input. */
export interface OperatorDeclarationFunction
  extends OperatorDeclarationBuilder<"operator"> {
  /** Parse a dynamic declaration, returning malformed input as a TypeError. */
  raw(
    declaration: string,
    fn: (...operands: never[]) => unknown,
    options?: OperatorDeclarationOptions<string>,
  ): OperatorDefinition | TypeError;
  /** Create a helper that applies one kind to every declaration. */
  kind<const kind extends string>(kind: kind): OperatorDeclarationBuilder<kind>;
}

/** Create an operator definition from a fixity, precedence, and operand marker. */
export const op = Object.assign(operator_definition, {
  raw(
    declaration: string,
    fn: (...operands: never[]) => unknown,
    options?: OperatorDeclarationOptions<string>,
  ): OperatorDefinition | TypeError {
    try {
      return operator_definition(declaration, fn, options);
    } catch (error) {
      if (error instanceof TypeError) {
        return error;
      }
      throw error;
    }
  },
  kind<const kind extends string>(
    kind: kind,
  ): OperatorDeclarationBuilder<kind> {
    return ((
      declaration: string,
      fn: (...operands: never[]) => unknown,
      options?: OperatorDeclarationOptions<string>,
    ) => {
      return operator_definition(declaration, fn, {
        kind: options?.kind ?? kind,
      });
    }) as OperatorDeclarationBuilder<kind>;
  },
}) as OperatorDeclarationFunction;

function operator_definition(
  declaration: string,
  fn: (...operands: never[]) => unknown,
  options?: OperatorDeclarationOptions<string>,
): OperatorDefinition {
  const match = /^(?:(['"])(.*?)\1 \| )?(prefix|infix|infixl|infixr) (\S+) \?$/
    .exec(declaration);
  if (match === null) {
    throw new TypeError(
      "operator declaration `" + declaration +
        "` is invalid; expected [quoted kind | ]prefix/infix/infixl/infixr precedence ?",
    );
  }
  const precedence = Number(match[4]);
  if (!Number.isFinite(precedence)) {
    throw new TypeError(
      "operator declaration precedence must be a finite number",
    );
  }
  if (typeof fn !== "function") {
    throw new TypeError("operator declaration callback must be a function");
  }
  const kind = match[2] ?? options?.kind ?? "operator";
  if (match[3] === "prefix") {
    return {
      kind,
      precedence,
      arity: 1,
      apply: fn as (value: unknown) => unknown,
    };
  }
  let direction: "left" | "right" | "none" = "none";
  if (match[3] === "infixl") {
    direction = "left";
  }
  if (match[3] === "infixr") {
    direction = "right";
  }
  return {
    kind,
    precedence,
    arity: 2,
    direction,
    apply: fn as (left: unknown, right: unknown) => unknown,
  };
}
