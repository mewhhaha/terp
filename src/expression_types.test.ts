import { assert_equals } from "./assert.ts";
import { interpreter, InterpreterError, op } from "../mod.ts";
import type {
  BinaryOperatorDefinition,
  StandardOperators,
  UnaryOperatorDefinition,
} from "./operators.ts";
import type {
  CheckedExpression,
  HasReferences,
  StringExpressionArgs,
  StringExpressionType,
} from "./expression_types.ts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
function expect<T extends true>(): void {}
type Empty = Record<never, never>;
type Binary<P extends number, D extends "left" | "right" | "none", L, R, Out> =
  & BinaryOperatorDefinition<"test", L, R, Out>
  & { precedence: P; direction: D };
type Arithmetic = {
  "+": Binary<6, "left", number, number, number>;
  "*": Binary<7, "left", number, number, number>;
  "==": Binary<4, "none", unknown, unknown, boolean>;
  "++": Binary<6, "left", string, string, string>;
};
type Operators = {
  lower: Binary<1, "left", string, boolean, number>;
  tighter: Binary<2, "left", number, string, boolean>;
};

Deno.test("expression types share precedence, grouping and placeholder analysis", () => {
  expect<
    Equal<
      StringExpressionType<Operators, Empty, "'x' lower 1 tighter 'y'">,
      number
    >
  >();
  expect<
    Equal<
      StringExpressionType<Operators, Empty, "('x' lower true) tighter 'y'">,
      boolean
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Operators, Empty, "? lower ? tighter ?">,
      readonly [string, number, string]
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Operators, Empty, "(? lower ?) tighter ?">,
      readonly [string, boolean, string]
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Arithmetic, Empty, "?left + ?10 * ?">,
      readonly [
        { readonly left: number },
        unknown,
        unknown,
        unknown,
        unknown,
        unknown,
        unknown,
        unknown,
        unknown,
        unknown,
        unknown,
        number,
        number,
      ]
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Arithmetic, Empty, "?0 ++ ?0">,
      readonly [string]
    >
  >();
  expect<Equal<HasReferences<Arithmetic, Empty, "'?'">, false>>();
  expect<Equal<HasReferences<Arithmetic, Empty, "?">, true>>();
});

Deno.test("expression types support optional, mixed rest and grouped function arguments", () => {
  type Values = {
    optional: (value: number, suffix?: string) => boolean;
    rest: (value: number, ...suffix: string[]) => string;
    bare: (value: number) => number;
  };
  expect<
    Equal<StringExpressionType<Arithmetic, Values, "optional 1">, boolean>
  >();
  expect<
    Equal<
      StringExpressionArgs<Arithmetic, Values, "optional ? ?">,
      readonly [number, string | undefined]
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Arithmetic, Values, "rest ? ? ?">,
      readonly [number, string, string]
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Arithmetic, Values, "rest (1 + ?) ?">,
      readonly [number, string]
    >
  >();
  expect<
    Equal<StringExpressionType<Arithmetic, Values, "bare">, Values["bare"]>
  >();
  expect<
    Equal<CheckedExpression<Arithmetic, Values, "optional">, "optional">
  >();
  expect<
    Equal<
      CheckedExpression<Arithmetic, Values, "optional 1 'x' 'extra'">,
      "interpreter string error: too many function arguments"
    >
  >();
});

Deno.test("expression types honor longest tokens, word boundaries and JavaScript whitespace", () => {
  type WordOps = {
    and: Binary<3, "left", boolean, boolean, boolean>;
    or: Binary<2, "left", boolean, boolean, boolean>;
  };
  type Values = { candy: boolean; floor: boolean };
  expect<
    Equal<StringExpressionType<WordOps, Values, "candy and floor">, boolean>
  >();
  expect<Equal<StringExpressionType<Arithmetic, Empty, "'a'++'b'">, string>>();
  expect<
    Equal<StringExpressionType<Arithmetic, Empty, "1\u00a0+\u20282">, number>
  >();
  expect<
    Equal<
      CheckedExpression<WordOps, Values, "candyand floor">,
      "interpreter string error: value `candyand` is not defined"
    >
  >();
  expect<
    Equal<
      CheckedExpression<Arithmetic, Empty, "1 +">,
      "interpreter string error: expected an operand"
    >
  >();
  expect<
    Equal<
      CheckedExpression<Arithmetic, Empty, "'x' + 1">,
      "interpreter string error: operand type does not match"
    >
  >();
  expect<
    Equal<
      CheckedExpression<Arithmetic, Empty, "1 == 2 == 3">,
      "interpreter string error: non-associative operator chain"
    >
  >();
  expect<
    Equal<CheckedExpression<StandardOperators, Empty, "1 + 2">, "1 + 2">
  >();
});

Deno.test("expression type budgets handle long chains without compiler recursion errors", () => {
  expect<
    Equal<
      StringExpressionType<
        Arithmetic,
        Empty,
        "1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1"
      >,
      number
    >
  >();
  type Dynamic = StringExpressionType<Arithmetic, Empty, string>;
  expect<Equal<Dynamic, unknown>>();
});

Deno.test("configured word prefixes apply only to function arguments", () => {
  type Values = { collect: (...words: string[]) => string[] };
  expect<
    Equal<
      StringExpressionType<
        Arithmetic,
        Values,
        "collect -v --version",
        readonly ["-", "--"]
      >,
      string[]
    >
  >();
  expect<
    Equal<
      StringExpressionType<Arithmetic, Values, "1 + 2", readonly ["-", "--"]>,
      number
    >
  >();
  expect<
    Equal<
      CheckedExpression<Arithmetic, Values, "-v", readonly ["-"]>,
      "interpreter string error: expected an operand"
    >
  >();
  expect<
    Equal<
      CheckedExpression<Arithmetic, Values, "collect -v">,
      "interpreter string error: invalid function argument"
    >
  >();
});

Deno.test("deep nesting and right chains defer before reaching compiler limits", () => {
  type Right = { "~": Binary<1, "right", number, number, number> };
  expect<
    Equal<
      StringExpressionType<
        Right,
        Empty,
        "1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1 ~ 1"
      >,
      unknown
    >
  >();
  expect<
    Equal<
      StringExpressionType<
        Arithmetic,
        Empty,
        "((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((1))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))"
      >,
      unknown
    >
  >();
});

Deno.test("oversized source and nonfinite numbers stay within the type budget", () => {
  expect<
    Equal<
      StringExpressionType<
        Arithmetic,
        Empty,
        "'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"
      >,
      unknown
    >
  >();
  expect<
    Equal<
      CheckedExpression<Arithmetic, Empty, "1e999">,
      "interpreter string error: value `1e999` is not defined"
    >
  >();
  expect<
    Equal<StringExpressionType<Arithmetic, Empty, "1e+2 + 0xFF">, number>
  >();
  expect<
    Equal<
      StringExpressionArgs<Arithmetic, Empty, "?01 + ?1">,
      readonly [unknown, number]
    >
  >();
});

Deno.test("prefix ties bind eagerly and negative precedences preserve registry-independent grouping", () => {
  type Unary = UnaryOperatorDefinition<"test", string, boolean> & {
    precedence: 1;
  };
  type Prefix = {
    neg: Unary;
    then: Binary<1, "left", boolean, number, string>;
  };
  expect<
    Equal<StringExpressionType<Prefix, Empty, "neg 'a' then 1">, string>
  >();
  expect<
    Equal<
      StringExpressionArgs<Prefix, Empty, "neg ? then ?">,
      readonly [string, number]
    >
  >();
  type Negative = {
    tighter: Binary<-1, "left", number, string, boolean>;
    lower: Binary<-2, "left", string, boolean, number>;
  };
  expect<
    Equal<
      StringExpressionType<Negative, Empty, "'a' lower 1 tighter 'b'">,
      number
    >
  >();
  type Mixed = {
    left: Binary<1, "left", number, number, number>;
    right: Binary<1, "right", number, number, number>;
  };
  expect<
    Equal<
      CheckedExpression<Mixed, Empty, "1 left (2 right 3)">,
      "1 left (2 right 3)"
    >
  >();
  expect<
    Equal<
      CheckedExpression<Mixed, Empty, "(1 left 2) right 3">,
      "(1 left 2) right 3"
    >
  >();
});

Deno.test("decimal literals keep their dot when a dot operator is registered", () => {
  type Dot = { ".": Binary<1, "left", number, number, boolean> };
  expect<Equal<StringExpressionType<Dot, Empty, "1.5">, number>>();
  expect<Equal<StringExpressionType<Dot, Empty, ".5">, number>>();
  expect<Equal<StringExpressionType<Dot, Empty, "-1.5">, number>>();
  expect<Equal<StringExpressionType<Dot, Empty, "1.5 . 2.5">, boolean>>();
});

Deno.test("numeric scanning preserves compact dots and signed adjacency", () => {
  type Dot = { ".": Binary<1, "left", number, number, boolean> };
  expect<Equal<StringExpressionType<Dot, Empty, "1.5.2.5">, boolean>>();
  expect<Equal<StringExpressionType<Dot, Empty, "1.5 .2.5">, boolean>>();
  type DotPrefix = {
    ".": UnaryOperatorDefinition<"test", number, boolean> & { precedence: 1 };
  };
  expect<Equal<StringExpressionType<DotPrefix, Empty, ".5">, boolean>>();
  type Plus = { "+": Binary<1, "left", number, number, number> };
  expect<Equal<StringExpressionType<Plus, Empty, "1+-2">, number>>();
  expect<Equal<StringExpressionType<Plus, Empty, "1++2">, number>>();
  expect<Equal<StringExpressionType<Plus, Empty, "1e+2+0xFF">, number>>();
});

Deno.test("longest operators are selected for their operand arity", () => {
  type Unary = UnaryOperatorDefinition<"test", unknown, string> & {
    precedence: 2;
  };
  type Infix = Binary<1, "left", number, number, string>;
  type ShortBinary = { "+": Infix; "++": Unary };
  expect<Equal<StringExpressionType<ShortBinary, Empty, "1++2">, string>>();
  type ShortUnary = { "+": Unary; "++": Infix };
  expect<Equal<StringExpressionType<ShortUnary, Empty, "++2">, string>>();
  type Widened = {
    "+": BinaryOperatorDefinition<"test", number, number, number>;
  };
  expect<Equal<HasReferences<Widened, Empty, "? + 1 + 2">, true>>();
  expect<Equal<HasReferences<Widened, Empty, "1 + 1 + 2">, false>>();
  expect<Equal<StringExpressionType<Widened, Empty, "? + 1 + 2">, unknown>>();
});

Deno.test("callable words use literals without invoking unary operators", () => {
  type Vocabulary = {
    collect: (...words: string[]) => string[];
    count: (...numbers: number[]) => number;
  };
  type Word = {
    not: UnaryOperatorDefinition<"test", boolean, number> & { precedence: 2 };
  };
  expect<
    Equal<StringExpressionType<Word, Vocabulary, "collect not">, string[]>
  >();
  expect<
    Equal<StringExpressionType<Word, Vocabulary, "collect not not">, string[]>
  >();
  type Sign = {
    "-": UnaryOperatorDefinition<"test", number, boolean> & { precedence: 2 };
    "+": UnaryOperatorDefinition<"test", number, boolean> & { precedence: 2 };
  };
  expect<
    Equal<StringExpressionType<Sign, Vocabulary, "count -2 +3">, number>
  >();
  expect<
    Equal<
      CheckedExpression<Sign, Vocabulary, "count -0xFF">,
      "interpreter string error: expected an operand"
    >
  >();
});

Deno.test("operator callbacks may ignore declared operands", () => {
  const calc = interpreter({
    always: op("infixl 6 ?", () => 42),
    first: op("infixl 6 ?", (left: number) => left),
    ignore: op("prefix 8 ?", () => 42),
  });
  const direct: number = calc("1 always 'ignored'");
  const first: number = calc("1 first 'ignored'");
  const prefix: number = calc("ignore 'ignored'");
  assert_equals([direct, first, prefix], [42, 1, 42]);
  expect<
    Equal<
      StringExpressionArgs<typeof calc.operators, Empty, "? always ?">,
      readonly [unknown, unknown]
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<typeof calc.operators, Empty, "? first ?">,
      readonly [number, unknown]
    >
  >();
  expect<
    Equal<
      CheckedExpression<typeof calc.operators, Empty, "'wrong' first 1">,
      "interpreter string error: operand type does not match"
    >
  >();
  const number = calc.fragment("1");
  const text = calc.fragment("'ignored'");
  if (number instanceof InterpreterError) throw number;
  if (text instanceof InterpreterError) throw text;
  const binary = calc.combine("always", number, text);
  const left = calc.combine("first", number, text);
  const unary = calc.combine("ignore", text);
  if (binary instanceof InterpreterError) throw binary;
  if (left instanceof InterpreterError) throw left;
  if (unary instanceof InterpreterError) throw unary;
  const binary_result: number = binary.run();
  const left_result: number = left.run();
  const unary_result: number = unary.run();
  assert_equals([binary_result, left_result, unary_result], [42, 1, 42]);
});

type Repeat<
  S extends string,
  N extends number,
  A extends readonly unknown[] = [],
  R extends string = "",
> = A["length"] extends N ? R : Repeat<S, N, [...A, unknown], `${R}${S}`>;

Deno.test("expression type limits preserve the exact source, token and depth boundaries", () => {
  type Source511 = `${Repeat<"                ", 31>}              1`;
  expect<Equal<StringExpressionType<Arithmetic, Empty, Source511>, number>>();
  expect<
    Equal<StringExpressionType<Arithmetic, Empty, `${Source511} `>, unknown>
  >();
  type Tokens255 = `${Repeat<"1+", 127>}1`;
  expect<Equal<StringExpressionType<Arithmetic, Empty, Tokens255>, number>>();
  expect<
    Equal<StringExpressionType<Arithmetic, Empty, `${Tokens255}+`>, unknown>
  >();
  expect<
    Equal<
      CheckedExpression<Arithmetic, Empty, Repeat<"1+", 127>>,
      "interpreter string error: expected an operand"
    >
  >();
  type Groups23 = `${Repeat<"(", 23>}1${Repeat<")", 23>}`;
  type Groups24 = `(${Groups23})`;
  expect<Equal<StringExpressionType<Arithmetic, Empty, Groups23>, number>>();
  expect<Equal<StringExpressionType<Arithmetic, Empty, Groups24>, unknown>>();
});

Deno.test("binding collection preserves intersected values, sparse indices and operand order", () => {
  type Constraints = {
    "&": Binary<1, "left", number | string, string | boolean, boolean>;
  };
  expect<
    Equal<
      StringExpressionArgs<Constraints, Empty, "?name & ?name">,
      readonly [{ readonly name: string }]
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Constraints, Empty, "?0 & ?0">,
      readonly [string]
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Constraints, Empty, "? & ?">,
      readonly [number | string, string | boolean]
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Arithmetic, Empty, "?99 + ?99">[99],
      number
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Arithmetic, Empty, "?99 + ?99">["length"],
      100
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Arithmetic, Empty, "?100 + ?100">,
      readonly unknown[]
    >
  >();
  expect<
    Equal<
      StringExpressionArgs<Arithmetic, Empty, "?0 + ?">,
      readonly [number, number]
    >
  >();
});

Deno.test("word scanning keeps punctuation operators inside registered vocabularies", () => {
  type Word = {
    "a!": Binary<1, "left", number, number, boolean>;
    "!": Binary<2, "left", number, number, number>;
  };
  type Values = { alph: number; alpha: number; beta: number; gamma: number };
  expect<Equal<StringExpressionType<Word, Values, "alpha!gamma">, boolean>>();
  expect<Equal<StringExpressionType<Word, Values, "betaa!gamma">, boolean>>();
  expect<Equal<StringExpressionType<Word, Values, "alpha ! gamma">, number>>();
});
