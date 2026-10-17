import type { OperatorRegistry } from "./operators.ts";

// One lexer and precedence parser supplies validation, result types and holes.
// Bounds keep generated or adversarial literals inside TypeScript's budget.
type WS =
  | " "
  | "\n"
  | "\r"
  | "\t"
  | "\v"
  | "\f"
  | "\u00a0"
  | "\u1680"
  | "\u2000"
  | "\u2001"
  | "\u2002"
  | "\u2003"
  | "\u2004"
  | "\u2005"
  | "\u2006"
  | "\u2007"
  | "\u2008"
  | "\u2009"
  | "\u200a"
  | "\u2028"
  | "\u2029"
  | "\u202f"
  | "\u205f"
  | "\u3000"
  | "\ufeff";
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type Letter =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";
type IdentStart = Letter | Uppercase<Letter> | "_" | "$";
type IdentPart = IdentStart | Digit;
type Identifier<S extends string> = S extends `${IdentStart}${infer R}`
  ? IdentifierTail<R>
  : false;
type IdentifierTail<S extends string> = S extends "" ? true
  : S extends `${IdentPart}${infer R}` ? IdentifierTail<R>
  : false;
type Digits<S extends string> = S extends "" ? false
  : S extends `${Digit}${infer R}` ? R extends "" ? true : Digits<R>
  : false;
type IndexName<S extends string> = S extends `0${infer R}`
  ? R extends "" ? "0" : IndexName<R>
  : S;
// Sixteen characters per step keeps the guard cheap even for very large input.
type WithinSourceBudget<S extends string, N extends readonly unknown[] = []> =
  S extends
    `${infer _0}${infer _1}${infer _2}${infer _3}${infer _4}${infer _5}${infer _6}${infer _7}${infer _8}${infer _9}${infer _a}${infer _b}${infer _c}${infer _d}${infer _e}${infer _f}${infer R}`
    ? N["length"] extends 31 ? false : WithinSourceBudget<R, [...N, unknown]>
    : true;
type Failure<M extends string> = { error: M };
type Deferred<References extends boolean = boolean> = {
  deferred: true;
  references: References;
};
type Token = readonly [
  kind: "word" | "string" | "prefixed" | "op" | "hole" | "(" | ")",
  text: string,
  spaced: boolean,
];
// A shallow tail avoids recursively comparing every remaining token at each step.
type TokenStream = readonly [] | readonly [Token, unknown];
type ReverseTokens<T extends TokenStream, A extends TokenStream = []> =
  T extends readonly [infer F extends Token, infer R extends TokenStream]
    ? ReverseTokens<R, readonly [F, A]>
    : A;
type AppendTokens<T extends TokenStream, R extends TokenStream> = T extends
  readonly [infer F extends Token, infer Rest extends TokenStream]
  ? readonly [F, AppendTokens<Rest, R>]
  : R;
type Definition<E, A extends 1 | 2> = E extends readonly unknown[]
  ? Extract<E[number], { arity: A }>
  : Extract<E, { arity: A }>;
type Def<O, K extends string, A extends 1 | 2> = K extends keyof O
  ? Definition<O[K], A>
  : never;
type Candidates<
  O,
  S extends string,
  Keys extends keyof O & string = keyof O & string,
> = {
  [K in Keys]: S extends `${K}${infer R}`
    ? Identifier<K> extends true ? R extends `${IdentPart}${string}` ? never : K
    : K
    : never;
}[Keys];
// Candidates are prefixes of one source, so discard empty suffixes together.
type Longest<U extends string> = [U] extends [`${infer C}${infer R}`]
  ? `${C}${LongestTail<R>}`
  : never;
type LongestTail<U extends string> = Exclude<U, ""> extends
  infer R extends string ? [R] extends [never] ? "" : Longest<R>
  : never;
type Match<O, S extends string> = S extends `${infer C}${string}`
  ? Longest<Candidates<O, S, Extract<keyof O & string, `${C}${string}`>>>
  : never;
type ReadString<S extends string, Q extends string> = S extends
  `${infer C}${infer R}` ? C extends Q ? readonly [R]
  : C extends "\\"
    ? R extends `${infer E}${infer T}`
      ? E extends "\\" | "'" | '"' | "n" | "r" | "t" ? ReadString<T, Q>
      : Failure<"unsupported string escape">
    : Failure<"unclosed string">
  : ReadString<R, Q>
  : Failure<"unclosed string">;
type ReadHole<S extends string, A extends string = ""> = S extends
  `${infer C}${infer R}`
  ? C extends IdentPart ? ReadHole<R, `${A}${C}`> : readonly [A, S]
  : readonly [A, ""];
type ReadWord<O, S extends string, A extends string = ""> = S extends ""
  ? readonly [A, ""]
  : S extends `${WS | "(" | ")" | "?" | "'" | '"'}${string}` ? readonly [A, S]
  : S extends `${infer C}${infer R}`
    ? A extends `${Digit}${string}${"e" | "E"}`
      ? C extends "+" | "-" ? ReadWord<O, R, `${A}${C}`>
      : ReadWordStep<O, S, A, C, R>
    : ReadWordStep<O, S, A, C, R>
  : readonly [A, S];
type SymbolKeys<O> = {
  [K in keyof O & string]: Identifier<K> extends true ? never : K;
}[keyof O & string];
type SymbolStart<O> = SymbolKeys<O> extends `${infer C}${string}` ? C : never;
type ReadWordStep<
  O,
  S extends string,
  A extends string,
  C extends string,
  R extends string,
> = C extends SymbolStart<O>
  ? [Candidates<O, S, SymbolKeys<O>>] extends [never]
    ? ReadWord<O, R, `${A}${C}`>
  : readonly [A, S]
  : ReadWord<O, R, `${A}${C}`>;
// Numbers have their own lexical grammar, independent of registered symbols.
type TakeDigits<
  S extends string,
  Allowed extends string,
  A extends string = "",
> = S extends `${infer C}${infer R}`
  ? C extends Allowed ? TakeDigits<R, Allowed, `${A}${C}`> : readonly [A, S]
  : readonly [A, ""];
type Hex =
  | Digit
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F";
type ReadExponent<S extends string, A extends string> = S extends
  `${infer E extends "e" | "E"}${infer R}`
  ? R extends `${infer Sign extends "+" | "-"}${infer T}`
    ? TakeDigits<T, Digit> extends
      readonly [infer D extends string, infer Rest extends string]
      ? D extends "" ? readonly [A, S] : readonly [`${A}${E}${Sign}${D}`, Rest]
    : never
  : TakeDigits<R, Digit> extends
    readonly [infer D extends string, infer Rest extends string]
    ? D extends "" ? readonly [A, S] : readonly [`${A}${E}${D}`, Rest]
  : never
  : readonly [A, S];
type ReadDecimal<S extends string, Sign extends string = ""> =
  TakeDigits<S, Digit> extends
    readonly [infer Whole extends string, infer R extends string]
    ? R extends `.${infer Fraction}`
      ? TakeDigits<Fraction, Digit> extends
        readonly [infer Part extends string, infer Rest extends string]
        ? ReadExponent<Rest, `${Sign}${Whole}.${Part}`>
      : never
    : ReadExponent<R, `${Sign}${Whole}`>
    : never;
type ReadNumber<S extends string> = S extends
  `${infer Sign extends "+" | "-"}${infer R}` ? ReadDecimal<R, Sign>
  : S extends
    `0${infer Base extends "x" | "X" | "o" | "O" | "b" | "B"}${infer R}`
    ? TakeDigits<
      R,
      Base extends "x" | "X" ? Hex
        : Base extends "o" | "O" ? "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7"
        : "0" | "1"
    > extends readonly [infer Digits extends string, infer Rest extends string]
      ? Digits extends "" ? ReadDecimal<S>
      : readonly [`0${Base}${Digits}`, Rest]
    : never
  : ReadDecimal<S>;
type NumberStart<S extends string> = S extends
  `${Digit}${string}` | `.${Digit}${string}` ? true : false;
type PrefixCandidate<S extends string, K extends string> = K extends K
  ? K extends "" ? never : S extends `${K}${IdentStart}${string}` ? K : never
  : never;
type PrefixMatch<P extends readonly string[], S extends string> = Longest<
  PrefixCandidate<S, P[number]>
>;
type ReadPrefixed<S extends string, A extends string = ""> = S extends
  `${infer C}${infer R}`
  ? C extends IdentPart | "-" ? ReadPrefixed<R, `${A}${C}`> : readonly [A, S]
  : readonly [A, ""];
type AfterAtom<T extends TokenStream> = T extends
  readonly [infer Last extends Token, unknown]
  ? Last[0] extends "word" | "string" | "prefixed" | "hole" | ")" ? true : false
  : false;
type Lex<
  O,
  S extends string,
  P extends readonly string[],
  T extends TokenStream = [],
  Space extends boolean = false,
  Count extends readonly unknown[] = [],
> = Count["length"] extends 256 ? Deferred
  : S extends "" ? ReverseTokens<T>
  : S extends `${WS}${infer R}` ? Lex<O, R, P, T, true, Count>
  : S extends `${infer Q extends "'" | '"'}${infer R}`
    ? ReadString<R, Q> extends infer X
      ? X extends readonly [infer Rest extends string] ? Lex<
          O,
          Rest,
          P,
          [["string", "", Space], T],
          false,
          [...Count, unknown]
        >
      : X
    : never
  : S extends `?${infer R}`
    ? ReadHole<R> extends
      readonly [infer Name extends string, infer Rest extends string]
      ? Lex<O, Rest, P, [["hole", Name, Space], T], false, [...Count, unknown]>
    : never
  : S extends `${infer C extends "(" | ")"}${infer R}`
    ? Lex<O, R, P, [[C, C, Space], T], false, [...Count, unknown]>
  : S extends `${Digit}${string}` ? LexNumber<O, S, P, T, Space, Count>
  : S extends `.${Digit}${string}`
    ? AfterAtom<T> extends true
      ? [Def<O, ".", 2>] extends [never] ? LexNumber<O, S, P, T, Space, Count>
      : LexMatched<O, S, P, T, Space, Count>
    : [Def<O, ".", 1>] extends [never] ? LexNumber<O, S, P, T, Space, Count>
    : LexMatched<O, S, P, T, Space, Count>
  : LexMatched<O, S, P, T, Space, Count>;
type LexMatched<
  O,
  S extends string,
  P extends readonly string[],
  T extends TokenStream,
  Space extends boolean,
  Count extends readonly unknown[],
> = [PrefixMatch<P, S>] extends [never]
  ? [Match<O, S>] extends [never]
    ? S extends `${"+" | "-"}${infer Numeric}`
      ? NumberStart<Numeric> extends true ? LexNumber<O, S, P, T, Space, Count>
      : LexWord<O, S, P, T, Space, Count>
    : LexWord<O, S, P, T, Space, Count>
  : Match<O, S> extends infer K extends string
    ? S extends `${K}${infer R}`
      ? Lex<O, R, P, [["op", K, Space], T], false, [...Count, unknown]>
    : never
  : never
  : S extends `${PrefixMatch<P, S>}${infer PrefixRest}`
    ? ReadPrefixed<PrefixRest, PrefixMatch<P, S>> extends
      readonly [infer W extends string, infer R extends string]
      ? Lex<O, R, P, [["prefixed", W, Space], T], false, [...Count, unknown]>
    : never
  : never;
type LexNumber<
  O,
  S extends string,
  P extends readonly string[],
  T extends TokenStream,
  Space extends boolean,
  Count extends readonly unknown[],
> = ReadNumber<S> extends
  readonly [infer N extends string, infer R extends string]
  ? Lex<O, R, P, [["word", N, Space], T], false, [...Count, unknown]>
  : never;
type LexWord<
  O,
  S extends string,
  P extends readonly string[],
  T extends TokenStream,
  Space extends boolean,
  Count extends readonly unknown[],
> = ReadWord<O, S> extends
  readonly [infer W extends string, infer R extends string]
  ? W extends "" ? Failure<"unexpected token">
  : Lex<O, R, P, [["word", W, Space], T], false, [...Count, unknown]>
  : never;

type TokenReferences<T extends TokenStream> = T extends
  readonly [infer F extends Token, infer R extends TokenStream]
  ? F[0] extends "hole" ? true : TokenReferences<R>
  : false;
type ArityRegistry<O, A extends 1 | 2> = {
  [K in keyof O as [Definition<O[K], A>] extends [never] ? never : K]: O[K];
};
type SplitOperator<
  O,
  K extends string,
  A extends 1 | 2,
  R extends TokenStream,
  Space extends boolean = false,
> = Match<ArityRegistry<O, A>, K> extends infer Short
  ? [Short] extends [never] ? never
  : Short extends string
    ? K extends `${Short}${infer Rest}`
      ? Lex<O, Rest, []> extends infer Tokens
        ? Tokens extends TokenStream
          ? readonly [["op", Short, Space], AppendTokens<Tokens, R>]
        : never
      : never
    : never
  : never
  : never;
type Hole = {
  kind: "anonymous" | "indexed" | "named";
  name: string;
  value: unknown;
};
type Eval<V = unknown, H extends readonly Hole[] = readonly Hole[]> = {
  value: V;
  holes: H;
};
type Ref<K extends Hole["kind"], N extends string> =
  & Eval<unknown, [{ kind: K; name: N; value: unknown }]>
  & { hole: true };
type Parsed<E, T extends TokenStream> = { result: E; rest: T };
type Constrain<E, V> = E extends Eval<infer Value, infer H>
  ? E extends { hole: true }
    ? H extends readonly [infer R extends Hole]
      ? Eval<V, [{ kind: R["kind"]; name: R["name"]; value: V }]>
    : never
  : unknown extends Value ? E
  : [Value] extends [V] ? E
  : Failure<"operand type does not match">
  : E;
type Params<D> = D extends { apply: (...args: infer P) => unknown } ? P : never;
type Input<D, I extends number> = Params<D> extends
  infer P extends readonly unknown[]
  ? number extends P["length"] ? P[I] : `${I}` extends keyof P ? P[I] : unknown
  : unknown;
type Output<D> = D extends { apply: (...args: never[]) => infer R } ? R
  : unknown;
type Unary<D, E> = Constrain<E, Input<D, 0>> extends infer A
  ? A extends Eval<unknown, infer H> ? Eval<Output<D>, H> : A
  : never;
type Binary<D, L, R> = Constrain<L, Input<D, 0>> extends infer A
  ? A extends Eval<unknown, infer AH>
    ? Constrain<R, Input<D, 1>> extends infer B
      ? B extends Eval<unknown, infer BH> ? Eval<Output<D>, [...AH, ...BH]> : B
    : never
  : A
  : never;
// Compare signed integer precedences without assuming widened numbers or fractions.
type Magnitude<N extends number, A extends readonly unknown[] = []> =
  A["length"] extends N ? A
    : A["length"] extends 128 ? never
    : Magnitude<N, [...A, unknown]>;
type PositiveCompare<A extends number, B extends number> = A extends B ? "equal"
  : Magnitude<A> extends infer X
    ? Magnitude<B> extends infer Y ? [X | Y] extends [never] ? "unknown"
      : [X] extends [never] ? "unknown"
      : [Y] extends [never] ? "unknown"
      : X extends readonly unknown[]
        ? Y extends readonly unknown[]
          ? X extends [...Y, ...infer R] ? R extends [] ? "equal" : "greater"
          : "less"
        : "unknown"
      : "unknown"
    : never
  : never;
type Compare<A extends number, B extends number> = number extends A | B
  ? "unknown"
  : `${A}` extends `-${infer AP extends number}`
    ? `${B}` extends `-${infer BP extends number}` ? PositiveCompare<BP, AP>
    : "less"
  : `${B}` extends `-${number}` ? "greater"
  : PositiveCompare<A, B>;
type Metadata = { precedence: number; direction?: "left" | "right" | "none" };
type Direction<D extends Metadata> = D["direction"] extends string
  ? D["direction"]
  : "right";
type Allowed<D extends Metadata, Bound> = Bound extends Metadata
  ? Compare<D["precedence"], Bound["precedence"]> extends infer C
    ? C extends "equal" ? Bound extends { arity: 1 } ? false
      : Direction<D> extends Direction<Bound>
        ? Direction<Bound> extends "none"
          ? Failure<"non-associative operator chain">
        : Direction<Bound> extends "right" ? true
        : false
      : Failure<"mixed operator associativity">
    : C extends "unknown" ? Deferred
    : C extends "greater" ? true
    : false
  : never
  : true;
type Chain<Last, D extends Metadata> = Last extends Metadata
  ? Compare<Last["precedence"], D["precedence"]> extends "equal"
    ? Direction<Last> extends Direction<D>
      ? Direction<D> extends "none" ? Failure<"non-associative operator chain">
      : true
    : Failure<"mixed operator associativity">
  : true
  : true;
type Expr<
  O,
  V,
  T extends TokenStream,
  Bound = undefined,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 24 ? Deferred
  : Atom<O, V, T, [...Depth, unknown]> extends infer X
    ? X extends Parsed<infer E, infer R> ? Tail<O, V, E, R, Bound, Depth> : X
  : never;
type Tail<
  O,
  V,
  E,
  T extends TokenStream,
  Bound,
  Depth extends readonly unknown[],
  Last = undefined,
> = T extends readonly [
  ["op", infer K extends string, boolean],
  infer R extends TokenStream,
]
  ? Def<O, K, 2> extends infer D
    ? [D] extends [never]
      ? SplitOperator<O, K, 2, R> extends infer Tokens
        ? [Tokens] extends [never] ? Parsed<E, T>
        : Tokens extends TokenStream ? Tail<O, V, E, Tokens, Bound, Depth, Last>
        : never
      : never
    : D extends Metadata
      ? Allowed<D, Bound> extends infer A
        ? A extends true
          ? Chain<Last, D> extends infer C
            ? C extends true
              ? Expr<O, V, R, D, [...Depth, unknown]> extends infer Right
                ? Right extends Parsed<infer RE, infer RT>
                  ? Binary<D, E, RE> extends infer Result
                    ? Result extends Eval
                      ? Tail<O, V, Result, RT, Bound, Depth, D>
                    : Result
                  : never
                : Right
              : never
            : C
          : never
        : A extends false ? Parsed<E, T>
        : A
      : never
    : Failure<"invalid operator metadata">
  : never
  : Parsed<E, T>;
type Atom<O, V, T extends TokenStream, Depth extends readonly unknown[]> =
  T extends readonly [infer H extends Token, infer R extends TokenStream]
    ? H[0] extends "hole" ? H[1] extends "" ? Parsed<Ref<"anonymous", "">, R>
      : Digits<H[1]> extends true ? Parsed<Ref<"indexed", IndexName<H[1]>>, R>
      : Identifier<H[1]> extends true ? Parsed<Ref<"named", H[1]>, R>
      : Failure<"invalid placeholder">
    : H[0] extends "string" ? Parsed<Eval<string, []>, R>
    : H[0] extends "(" ? Group<O, V, R, Depth>
    : H[0] extends "op"
      ? [Def<O, H[1], 1>] extends [never]
        ? SplitOperator<O, H[1], 1, R> extends infer Tokens
          ? [Tokens] extends [never] ? SignedAtom<H[1], R>
          : Tokens extends TokenStream ? Atom<O, V, Tokens, Depth>
          : never
        : never
      : Expr<O, V, R, Def<O, H[1], 1>, Depth> extends infer X
        ? X extends Parsed<infer E, infer RT>
          ? Unary<Def<O, H[1], 1>, E> extends infer Result
            ? Result extends Eval ? Parsed<Result, RT> : Result
          : never
        : X
      : never
    : H[0] extends "word" ? Word<O, V, H[1], R, Depth>
    : Failure<"expected an operand">
    : Failure<"expected an operand">;
type SignedAtom<K extends string, T extends TokenStream> = K extends "+" | "-"
  ? T extends readonly [
    ["word", infer Numeric extends string, boolean],
    infer R extends TokenStream,
  ] ? `${K}${Numeric}` extends `${number}` ? Parsed<Eval<number, []>, R>
    : Failure<"expected an operand">
  : Failure<"expected an operand">
  : Failure<"expected an operand">;
type Group<O, V, T extends TokenStream, Depth extends readonly unknown[]> =
  T extends readonly [
    ["op", infer K extends keyof O & string, boolean],
    readonly [[")", string, boolean], infer R extends TokenStream],
  ] ? Parsed<Eval<O[K], []>, R>
    : Expr<O, V, T, undefined, Depth> extends infer X
      ? X extends Parsed<infer E, infer R> ? R extends readonly [
          [")", string, boolean],
          infer Rest extends TokenStream,
        ] ? Parsed<E, Rest>
        : Failure<"missing closing parenthesis">
      : X
    : never;
type Word<
  O,
  V,
  W extends string,
  R extends TokenStream,
  Depth extends readonly unknown[],
> = W extends `${number}` ? Parsed<Eval<number, []>, R>
  : W extends "true" | "false" ? Parsed<Eval<boolean, []>, R>
  : W extends keyof V
    ? V[W] extends (...args: infer P) => infer Result
      ? Call<O, V, R, P, Result, Depth> extends infer C
        ? C extends { called: false } ? Parsed<Eval<V[W], []>, R> : C
      : never
    : Parsed<Eval<V[W], []>, R>
  : Failure<`value \`${W}\` is not defined`>;
type StopsCall<O, First extends Token> = First[0] extends ")" ? true
  : First[0] extends "op"
    ? [Match<ArityRegistry<O, 2>, First[1]>] extends [never] ? false : true
  : false;
type Call<
  O,
  V,
  T extends TokenStream,
  P extends readonly unknown[],
  Result,
  Depth extends readonly unknown[],
  H extends readonly Hole[] = [],
  Count extends readonly unknown[] = [],
> = T extends readonly [infer First extends Token, unknown]
  ? First[2] extends true
    ? StopsCall<O, First> extends true ? FinishCall<T, P, Result, H, Count>
    : CallArgument<O, V, T, Depth> extends infer A
      ? A extends Parsed<infer E, infer R>
        ? P extends readonly [] ? Failure<"too many function arguments">
        : Constrain<E, P[0]> extends infer C
          ? C extends Eval<unknown, infer AH> ? Call<
              O,
              V,
              R,
              DropParameter<P>,
              Result,
              Depth,
              [...H, ...AH],
              [...Count, unknown]
            >
          : C
        : never
      : A
    : never
  : FinishCall<T, P, Result, H, Count>
  : FinishCall<T, P, Result, H, Count>;
type DropParameter<P extends readonly unknown[]> = P extends
  readonly [unknown, ...infer R] ? R
  : P extends readonly [unknown?, ...infer R] ? R
  : P;
type FinishCall<
  T extends TokenStream,
  P extends readonly unknown[],
  Result,
  H extends readonly Hole[],
  Count extends readonly unknown[],
> = Count extends [] ? { called: false }
  : [] extends P ? Parsed<Eval<Result, H>, T>
  : Failure<"missing function arguments">;
type CallArgument<
  O,
  V,
  T extends TokenStream,
  Depth extends readonly unknown[],
> = T extends readonly [
  ["op", infer K extends string, boolean],
  infer R extends TokenStream,
]
  ? Identifier<K> extends true
    ? Parsed<Eval<K extends keyof V ? V[K] : string, []>, R>
  : SignedAtom<K, R>
  : T extends readonly [
    ["prefixed", string, boolean],
    infer Rest extends TokenStream,
  ] ? Parsed<Eval<string, []>, Rest>
  : T extends readonly [
    ["word", infer W extends string, boolean],
    infer R extends TokenStream,
  ] ? W extends `${number}` | "true" | "false" ? Atom<O, V, T, Depth>
    : W extends keyof V ? Parsed<Eval<V[W], []>, R>
    : Identifier<W> extends true ? Parsed<Eval<string, []>, R>
    : Failure<"invalid function argument">
  : Atom<O, V, T, Depth>;

type Analyze<O, V, E extends string, P extends readonly string[]> =
  string extends E ? Deferred
    : WithinSourceBudget<E> extends false ? Deferred
    : string extends keyof O ? Deferred
    : Lex<O, E, P> extends infer L
      ? L extends TokenStream
        ? Expr<O, V, L> extends infer X
          ? X extends Parsed<infer Result, infer Rest>
            ? Rest extends [] ? Result
            : Failure<"expected a registered operator">
          : X extends Deferred ? Deferred<TokenReferences<L>>
          : X
        : never
      : L
    : never;
// Fold bindings once; repeated names intersect their complete operand constraints.
type Bindings<
  H extends readonly Hole[],
  N = Record<never, never>,
  I = Record<never, never>,
  A extends readonly unknown[] = [],
> = H extends
  readonly [infer F extends Hole, ...infer R extends readonly Hole[]]
  ? F["kind"] extends "named"
    ? Bindings<R, N & Record<F["name"], F["value"]>, I, A>
  : F["kind"] extends "indexed"
    ? Bindings<R, N, I & Record<F["name"], F["value"]>, A>
  : Bindings<R, N, I, [...A, F["value"]]>
  : { named: N; indexed: I; anonymous: A };
type Indexed<
  I,
  Names extends string = keyof I & string,
  A extends readonly unknown[] = [],
> = [Names] extends [never] ? A
  : A["length"] extends 100 ? readonly unknown[]
  : Indexed<
    I,
    Exclude<Names, `${A["length"]}`>,
    [...A, `${A["length"]}` extends keyof I ? I[`${A["length"]}`] : unknown]
  >;
type Args<H extends readonly Hole[]> = Bindings<H> extends {
  named: infer N;
  indexed: infer I;
  anonymous: infer A extends readonly unknown[];
} ? keyof N extends never ? readonly [...Indexed<I>, ...A]
  : readonly [{ readonly [K in keyof N]: N[K] }, ...Indexed<I>, ...A]
  : never;

/** @internal Parsed expression information shared by the public string call signatures. */
export type ExpressionAnalysis<
  O extends OperatorRegistry,
  V extends Readonly<Record<string, unknown>>,
  E extends string,
  P extends readonly string[] = readonly [],
> = Analyze<O, V, E, P>;
/** @internal Inferred positional arguments, including the optional leading named scope. */
export type StringExpressionArgs<
  O extends OperatorRegistry,
  V extends Readonly<Record<string, unknown>>,
  E extends string,
  P extends readonly string[] = readonly [],
> = Analyze<O, V, E, P> extends Eval<unknown, infer H> ? Args<H>
  : readonly unknown[];
/** @internal Result inferred from the registered operators and named functions. */
export type StringExpressionType<
  O extends OperatorRegistry,
  V extends Readonly<Record<string, unknown>>,
  E extends string,
  P extends readonly string[] = readonly [],
> = Analyze<O, V, E, P> extends Eval<infer Result, readonly Hole[]> ? Result
  : unknown;
/** @internal Literal expression or a readable diagnostic when its syntax or operands fail. */
export type CheckedExpression<
  O extends OperatorRegistry,
  V extends Readonly<Record<string, unknown>>,
  E extends string,
  P extends readonly string[] = readonly [],
> = Analyze<O, V, E, P> extends Failure<infer Message>
  ? `interpreter string error: ${Message}`
  : E;
/** @internal Whether evaluation requires a placeholder argument. */
export type HasReferences<
  O extends OperatorRegistry,
  V extends Readonly<Record<string, unknown>>,
  E extends string,
  P extends readonly string[] = readonly [],
> = Analyze<O, V, E, P> extends Eval<unknown, infer H>
  ? H extends readonly [] ? false : true
  : Analyze<O, V, E, P> extends Deferred<infer References> ? References
  : boolean;
