# API and language rules

## Expressions

`interpreter(registry, options?)` returns a callable language. `terp` is the
standard language with arithmetic, string `++`, comparison, equality, and
boolean operators.

| Form                                       | Meaning                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `language("1 + 2")`                        | Evaluate a literal; infer its result                      |
| `language("? + ?", 1, 2)`                  | Evaluate with typed arguments                             |
| `language("? + ?")`                        | Compile a typed reusable runner                           |
| `language.raw(source)`                     | Compile runtime text; return runner or `InterpreterError` |
| `language.fragment(source)`                | Validate a reusable fragment with its own `.run(...)`     |
| `language.combine(token, left, right?)`    | Compose typed fragments with independent arguments        |
| `language.checked(source, guards)`         | Compile with runtime argument/result guards               |
| `language.explain(source, ...args)`        | Execute once and return `{ value, steps }` or error       |
| `language.complete(source, cursor?)`       | Suggest valid vocabulary continuations                    |
| `language.get(token)` / `.get_value(name)` | Read vocabulary snapshots                                 |

Numbers support finite decimal, scientific, hexadecimal, binary, and octal
literals. Strings use single or double quotes and escapes `\\`, `\'`, `\"`,
`\n`, `\r`, and `\t`. JavaScript whitespace is accepted. Booleans are `true` and
`false`. Parentheses group expressions; `(+)` retrieves an operator value.

## Operators

```ts
import { interpreter, op } from "../mod.ts";

const words = interpreter({
  add: op("'math' | infixl 6 ?", (a: number, b: number) => a + b),
  neg: op("prefix 8 ?", (value: number) => -value),
});
words("neg 2 add 5"); // 3
```

Declarations use `prefix`, `infixl`, `infixr`, or non-associative `infix`,
followed by precedence and `?`. Higher precedence binds tighter. Prefix
operators bind before infix operators at equal precedence. Mixing
associativities at the same precedence requires grouping. `op.kind("math")`
supplies a shared category. Callbacks can ignore unused arguments but cannot
require more than the declared arity. Literal declarations are checked; dynamic
declarations use `op.raw(declaration, callback, options?)`, returning a
definition or `TypeError`.

An operator is also an ordinary object with `kind`, `precedence`, `arity`,
`apply`, and (for binary operators) `direction`. `operator(unary, binary)`
combines two arities under one token. `operators(registry)` validates a reusable
table.

Numeric, string, boolean, equality, ordering, and unary helper constructors are
exported for common cases. They retain literal fixity metadata. Numeric/string/
boolean helpers validate operand types at runtime; `op` retains the callback's
own behavior and does not manufacture runtime type guards.

Tokens cannot be empty, contain whitespace or `()?"'`, begin with a numeric
literal, or equal `true`/`false`. Word operators require an identifier boundary,
so `not` does not consume the start of `notice`.

## Arguments and vocabulary

- Each `?` consumes one argument after the highest indexed placeholder.
- `?0`, `?1`, etc. select zero-based positional arguments and can repeat.
- Named placeholders such as `?price` read own properties of the first argument.
  Positional arguments follow that scope object.
- Missing bindings and surplus arguments are rejected before any callback runs.
  `undefined` is a valid supplied value.

`options.values` exposes named constants and functions. Bare function names
return the function; following whitespace-separated words invoke it.
Unregistered identifier-shaped argument words are strings. Literal arguments
retain their types. Groups supply one evaluated argument.

```ts
const tools = interpreter({}, {
  values: {
    greet(name: string, title?: string) {
      let prefix = "";
      if (title !== undefined) prefix = title + " ";
      return "hello " + prefix + name;
    },
  },
});
tools('greet Ada "Dr"'); // "hello Dr Ada"
```

Optional and rest parameters constrain literal calls and placeholders. A
function with no supplied words is always a value, including a zero-argument
function; register a prefix operation to invoke such functions explicitly.
`word_prefixes: ["-", "--"] as const` opts into argument words such as
`--verbose`.

The interpreter snapshots own registry entries, metadata, named values, and
prefixes at construction. Objects used as values and callback closure state
remain application-owned; this is a shallow snapshot. Registered prototype
operator methods are retained. Inherited vocabulary names are never callable.

## Execution and errors

Compilation constructs an expression tree without executing operators, named
functions, or application hooks. Reusable runners retain it. Execution evaluates
operands from left to right, then applies their operator or function.

Binary definitions may supply `lazy(leftThunk, rightThunk)` in addition to
`apply`. Each thunk evaluates at most once. Standard `&&` and `||` use this to
skip the unnecessary branch; custom operators remain eager unless they opt in.
All required input bindings are still validated before execution.

`options.apply_operator` replaces application with `(operator, ...operands)`. It
receives eager operands and overrides lazy behavior. Since it can replace result
semantics, that interpreter's expression results are typed `unknown`. Use
`explain` for observation without replacing semantics.

`InterpreterError` extends `TypeError` and carries:

- `summary`: short diagnostic;
- `code`: `syntax`, `unknown_value`, `arguments`, `operator`, `function`,
  `fragment`, `limit`, or `validation`;
- `source` and `span: { start, end }`: original source and exclusive-end
  offsets;
- `cause` and `errors`: originating exceptions.

Direct calls and runners throw errors. `raw`, `fragment`, `combine`, `checked`
compilation, and `explain` return them. Application exceptions retain their
causes. Runtime strings validate syntax rather than the domains of arbitrary
callbacks.

## Fragments

```ts
const left = words.fragment("?0 add 1");
const right = words.fragment("?0 add 2");
if (!(left instanceof Error) && !(right instanceof Error)) {
  const result = words.combine("add", left, right);
  if (!(result instanceof Error)) result.run(10, 20); // 33
}
```

Structural `combine` concatenates argument tuples in operand order. Each operand
keeps its own scope object and indexed slots. Nested combinations retain those
bindings. Incompatible operand result types fail checking.

Tagged `raw` templates accept only source fragments from the same interpreter.
Each interpolation is parenthesized. Named and indexed placeholders share the
final expression's bindings; anonymous placeholders remain sequential.

Combined fragments retain bindings that cannot be represented by their display
source alone. Execute them with `.run` or combine them again; inserting one into
a textual template returns a fragment error rather than silently changing slots.

## Checked runtime input

```ts
import { terp } from "../mod.ts";

const run = terp.checked("? + ?", {
  arguments: (
    values: readonly unknown[],
  ): values is readonly [number, number] =>
    values.length === 2 && values.every((value) => typeof value === "number"),
  result: (value: unknown): value is number => typeof value === "number",
});
if (!(run instanceof Error)) {
  const total: number = run(2, 3);
}
```

Argument guards run before callbacks. Result guards run after evaluation. A
guard rejection throws `InterpreterError` with code `validation`. Guards should
be ordinary pure predicates; their cost is part of executing the checked runner.

## Explanation and completion

`explain` returns the result and completed function/operator steps in execution
order. Each step has a name, source span, evaluated operands, and result.
Skipped lazy branches produce no steps. Application code executes exactly once.

`complete` suggests registered operators and values with replacement offsets. It
checks syntax using the same runtime parser, supports partial words/symbols and
open groups, and never evaluates callbacks. Suggestions concern syntax and
vocabulary, not erased TypeScript operand types. The optional cursor defaults to
the end; text after the cursor is not used to qualify suggestions.

## Predictable limits

Runtime expressions allow 100,000 characters and tree/nesting depth 128. Larger
input returns a located `limit` error. These bounds prevent call-stack failures.

Literal analysis is exact within its supported grammar and budget: up to 512
characters, 256 tokens, 24 recursive parser levels, indexes 0–99, and literal
integer precedences with magnitude up to 128. Larger or widened inputs fall back
to `unknown` results and runtime validation, preserving compiler responsiveness.
Long left-associative chains use iterative type recursion. Literal operator
metadata is preserved by the supplied builders; an explicitly widened operator
annotation can intentionally lose that information.

## Development evidence

See [hills and measurements](hills.md) for benchmarks, generated conformance,
example output checks, and reproducible commands. `deno task ci` is the release
gate. The package has no runtime dependencies.
