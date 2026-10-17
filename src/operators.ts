/** Associativity for operators at the same precedence. */
export type InfixDirection = "left" | "right" | "none";

/** Shared runtime metadata for an operator. */
export interface OperatorMetadata<
  kind extends string = string,
  arity extends 1 | 2 = 1 | 2,
> {
  /** Category used for narrowing and lookup helpers. */
  readonly kind: kind;
  /** Higher values bind more tightly. */
  readonly precedence: number;
  /** Number of operands consumed by this operator. */
  readonly arity: arity;
}

/** Runtime definition for a prefix operator. */
export interface UnaryOperatorDefinition<
  kind extends string = string,
  value = unknown,
  result = unknown,
> extends OperatorMetadata<kind, 1> {
  /** Apply the operator to its already-evaluated operand. */
  apply(value: value): result;
}

/** Runtime definition for an infix operator. */
export interface BinaryOperatorDefinition<
  kind extends string = string,
  left = unknown,
  right = unknown,
  result = unknown,
> extends OperatorMetadata<kind, 2> {
  /** Associativity when adjacent operators share precedence. */
  readonly direction: InfixDirection;
  /** Apply the operator to already-evaluated operands. */
  apply(left: left, right: right): result;
  /** Evaluate operands on demand; used for short-circuiting operators. */
  lazy?(left: () => left, right: () => right): result;
}

/** Runtime definition for a prefix or infix operator. */
export type OperatorDefinition<kind extends string = string> =
  | UnaryOperatorDefinition<kind>
  | BinaryOperatorDefinition<kind>;

/** Overload set for a token that has both unary and binary meanings. */
export type OperatorOverloads<kind extends string = string> = readonly [
  OperatorDefinition<kind>,
  ...OperatorDefinition<kind>[],
];

/** Value stored for one operator token. */
export type OperatorEntry<kind extends string = string> =
  | OperatorDefinition<kind>
  | OperatorOverloads<kind>;

/** Map of operator tokens to runtime definitions or overload sets. */
export type OperatorRegistry<kind extends string = string> = Readonly<
  Record<string, OperatorEntry<kind>>
>;

/** Create an operator registry while preserving literal token types. */
export function operators<const registry extends OperatorRegistry>(
  registry: registry,
): registry {
  validate_operator_registry(registry);

  return registry;
}

/** Create one operator or overload set while preserving literal kinds. */
export function operator<const definition extends OperatorDefinition>(
  definition: definition,
): definition;
/** Create an overload set for one token while preserving literal kinds. */
export function operator<
  const definitions extends readonly [
    OperatorDefinition,
    OperatorDefinition,
    ...OperatorDefinition[],
  ],
>(...definitions: definitions): definitions;
export function operator(
  definition: OperatorDefinition,
  ...rest: OperatorDefinition[]
): OperatorDefinition | readonly OperatorDefinition[] {
  if (rest.length === 0) {
    return definition;
  }

  return [definition, ...rest];
}

function validate_operator_registry(registry: OperatorRegistry): void {
  for (const token of Object.keys(registry)) {
    validate_operator_token(token);
    validate_operator_entry(token, registry[token]);
  }
}

function validate_operator_token(token: string): void {
  if (token.length === 0) {
    throw new TypeError("operator token must not be empty");
  }
  if (/^(?:\d|\.\d)/.test(token) || token === "true" || token === "false") {
    throw new TypeError(
      "operator token `" + token + "` must not shadow literal syntax",
    );
  }

  if (/\s/.test(token)) {
    throw new TypeError(
      "operator token `" + token + "` must not contain whitespace",
    );
  }

  if (/[()?'"]/.test(token)) {
    throw new TypeError(
      "operator token `" + token +
        "` must not contain reserved syntax characters",
    );
  }
}

function validate_operator_entry(token: string, entry: OperatorEntry): void {
  const definitions = operator_definitions(entry);
  const arities = new Set<number>();

  if (definitions.length === 0) {
    throw new TypeError(
      "operator `" + token + "` must have at least one definition",
    );
  }

  for (const definition of definitions) {
    validate_operator_definition(token, definition);

    if (arities.has(definition.arity)) {
      throw new TypeError(
        "operator `" + token + "` has more than one arity `" +
          definition.arity + "` definition",
      );
    }

    arities.add(definition.arity);
  }
}

function validate_operator_definition(
  token: string,
  definition: OperatorDefinition,
): void {
  if (typeof definition !== "object" || definition === null) {
    throw new TypeError(
      "operator `" + token + "` definition must be an object",
    );
  }

  if (typeof definition.kind !== "string") {
    throw new TypeError(
      "operator `" + token + "` definition kind must be a string",
    );
  }

  if (
    typeof definition.precedence !== "number" ||
    !Number.isFinite(definition.precedence)
  ) {
    throw new TypeError(
      "operator `" + token + "` definition must have a finite precedence",
    );
  }

  if (definition.arity !== 1 && definition.arity !== 2) {
    throw new TypeError(
      "operator `" + token + "` definition arity must be 1 or 2",
    );
  }

  if (typeof definition.apply !== "function") {
    throw new TypeError(
      "operator `" + token + "` definition apply must be a function",
    );
  }
  if (
    definition.arity === 2 && definition.lazy !== undefined &&
    typeof definition.lazy !== "function"
  ) {
    throw new TypeError(
      "operator `" + token + "` definition lazy must be a function",
    );
  }

  if (
    definition.arity === 2 &&
    definition.direction !== "left" &&
    definition.direction !== "right" &&
    definition.direction !== "none"
  ) {
    throw new TypeError(
      "operator `" + token +
        "` binary definition direction must be left, right, or none",
    );
  }
}

function operator_definitions(
  entry: OperatorEntry,
): readonly OperatorDefinition[] {
  if (is_operator_overloads(entry)) {
    return entry;
  }

  return [entry];
}

function is_operator_overloads(
  entry: OperatorEntry,
): entry is OperatorOverloads {
  return Array.isArray(entry);
}

/** Look up an operator definition by token. */
export function get_operator_from(
  operators: OperatorRegistry,
  token: string,
): OperatorEntry | undefined {
  if (!Object.hasOwn(operators, token)) {
    return undefined;
  }

  return operators[token];
}

/** Create a generic prefix operator. */
export function unary_operator<
  const kind extends string,
  value = unknown,
  result = unknown,
  const precedence extends number = number,
>(
  kind: kind,
  precedence: precedence,
  fn: (value: value) => result,
): UnaryOperatorDefinition<kind, value, result> & {
  readonly precedence: precedence;
} {
  return {
    kind,
    precedence,
    arity: 1,
    apply: fn,
  };
}

/** Create a numeric binary operator. */
export function number_operator<
  const precedence extends number,
  const direction extends InfixDirection,
>(
  precedence: precedence,
  direction: direction,
  fn: (left: number, right: number) => number,
): BinaryOperatorDefinition<"number", number, number, number> & {
  readonly precedence: precedence;
  readonly direction: direction;
} {
  return {
    kind: "number",
    precedence,
    direction,
    arity: 2,
    apply(left, right) {
      return fn(as_number(left), as_number(right));
    },
  };
}

/** Create a numeric prefix operator. */
export function number_unary_operator<const precedence extends number>(
  precedence: precedence,
  fn: (value: number) => number,
): UnaryOperatorDefinition<"number", number, number> & {
  readonly precedence: precedence;
} {
  return {
    kind: "number",
    precedence,
    arity: 1,
    apply(value) {
      return fn(as_number(value));
    },
  };
}

/** Create an equality operator. */
export function equality_operator(
  fn: (left: unknown, right: unknown) => boolean = Object.is,
): BinaryOperatorDefinition<"equality", unknown, unknown, boolean> & {
  readonly precedence: 4;
  readonly direction: "none";
} {
  return {
    kind: "equality",
    precedence: 4,
    direction: "none",
    arity: 2,
    apply: fn,
  };
}

/** Create an ordering operator for numeric operands. */
export function ordering_operator(
  fn: (left: number, right: number) => boolean,
): BinaryOperatorDefinition<"ordering", number, number, boolean> & {
  readonly precedence: 4;
  readonly direction: "none";
} {
  return {
    kind: "ordering",
    precedence: 4,
    direction: "none",
    arity: 2,
    apply(left, right) {
      return fn(as_number(left), as_number(right));
    },
  };
}

/** Create a boolean binary operator. */
export function boolean_operator<
  const precedence extends number,
  const direction extends InfixDirection,
>(
  precedence: precedence,
  direction: direction,
  fn: (left: boolean, right: boolean) => boolean,
): BinaryOperatorDefinition<"boolean", boolean, boolean, boolean> & {
  readonly precedence: precedence;
  readonly direction: direction;
} {
  return {
    kind: "boolean",
    precedence,
    direction,
    arity: 2,
    apply(left, right) {
      return fn(as_boolean(left), as_boolean(right));
    },
  };
}

/** Create a boolean prefix operator. */
export function boolean_unary_operator<const precedence extends number>(
  precedence: precedence,
  fn: (value: boolean) => boolean,
): UnaryOperatorDefinition<"boolean", boolean, boolean> & {
  readonly precedence: precedence;
} {
  return {
    kind: "boolean",
    precedence,
    arity: 1,
    apply(value) {
      return fn(as_boolean(value));
    },
  };
}

/** Create a string binary operator. */
export function string_operator<
  const precedence extends number,
  const direction extends InfixDirection,
>(
  precedence: precedence,
  direction: direction,
  fn: (left: string, right: string) => string,
): BinaryOperatorDefinition<"string", string, string, string> & {
  readonly precedence: precedence;
  readonly direction: direction;
} {
  return {
    kind: "string",
    precedence,
    direction,
    arity: 2,
    apply(left, right) {
      return fn(as_string(left), as_string(right));
    },
  };
}

/** Registry type for the built-in operators, including exact fixities. */
export type StandardOperators = Readonly<{
  "++": ReturnType<typeof string_operator<6, "left">>;
  "+": ReturnType<typeof number_operator<6, "left">>;
  "-": readonly [
    ReturnType<typeof number_operator<6, "left">>,
    ReturnType<typeof number_unary_operator<8>>,
  ];
  "*": ReturnType<typeof number_operator<7, "left">>;
  "/": ReturnType<typeof number_operator<7, "left">>;
  "%": ReturnType<typeof number_operator<7, "left">>;
  "==": ReturnType<typeof equality_operator>;
  "!=": ReturnType<typeof equality_operator>;
  "<": ReturnType<typeof ordering_operator>;
  "<=": ReturnType<typeof ordering_operator>;
  ">": ReturnType<typeof ordering_operator>;
  ">=": ReturnType<typeof ordering_operator>;
  "!": ReturnType<typeof boolean_unary_operator<8>>;
  "&&": ReturnType<typeof boolean_operator<3, "right">>;
  "||": ReturnType<typeof boolean_operator<2, "right">>;
}>;

/** Standard numeric, string, comparison, equality, and boolean operators. */
export const standard_operators: StandardOperators = operators({
  "++": string_operator(6, "left", (left, right) => left + right),
  "+": number_operator(6, "left", (left, right) => left + right),
  "-": operator(
    number_operator(6, "left", (left, right) => left - right),
    number_unary_operator(8, (value) => -value),
  ),
  "*": number_operator(7, "left", (left, right) => left * right),
  "/": number_operator(7, "left", (left, right) => left / right),
  "%": number_operator(7, "left", (left, right) => left % right),
  "==": equality_operator(),
  "!=": equality_operator((left, right) => !Object.is(left, right)),
  "<": ordering_operator((left, right) => left < right),
  "<=": ordering_operator((left, right) => left <= right),
  ">": ordering_operator((left, right) => left > right),
  ">=": ordering_operator((left, right) => left >= right),
  "!": boolean_unary_operator(8, (value) => !value),
  "&&": {
    ...boolean_operator(3, "right", (left, right) => left && right),
    lazy(left: () => boolean, right: () => boolean) {
      return as_boolean(left()) && as_boolean(right());
    },
  },
  "||": {
    ...boolean_operator(2, "right", (left, right) => left || right),
    lazy(left: () => boolean, right: () => boolean) {
      return as_boolean(left()) || as_boolean(right());
    },
  },
});

function as_number(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  throw new TypeError("operator expected a number");
}

function as_boolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new TypeError("operator expected a boolean");
}

function as_string(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  throw new TypeError("operator expected a string");
}
