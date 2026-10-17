# terp

Small typed expression languages for TypeScript and Deno.

Define your vocabulary with ordinary functions. Terp supplies parsing,
precedence, typed arguments, and reusable execution.

```ts
import { interpreter, op } from "jsr:@mewhhaha/terp";

const pricing = interpreter({
  plus: op("infixl 6 ?", (a: number, b: number) => a + b),
  times: op("infixl 7 ?", (a: number, b: number) => a * b),
});

const quote = pricing("?base plus ?seats times ?price");
quote({ base: 100, seats: 3, price: 20 }); // 160, inferred number
```

Literal expressions check syntax, operand types, and placeholder arguments.
Operators choose their own symbols, precedence, associativity, and result types.
They can work with objects, functions, validators, or parsers.

## Start with the standard language

```ts
import { terp } from "jsr:@mewhhaha/terp";

terp("2 + 3 * 4"); // 14, inferred number
terp('"hello" ++ " world"'); // "hello world"
terp("?0 + ?0", 21); // 42

const add = terp("? + ?");
add(20, 22); // 42
```

`?` consumes a positional argument; `?0` selects one by index. Named
placeholders read the first argument as an object. Anonymous slots follow the
highest indexed slot. `&&` and `||` short-circuit.

## Runtime expressions

```ts
const expression: string = "?amount * ?rate";
const calculate = terp.raw(expression);

if (calculate instanceof Error) {
  console.error(calculate.summary, calculate.span);
} else {
  calculate({ amount: 100, rate: 0.2 }); // 20
}
```

Parsing never executes callbacks. Runners parse once and validate argument
bindings before execution. `raw` validates syntax; custom operators remain
responsible for their operand domain checks. Use `checked` to give a dynamic
expression an explicitly validated input/output boundary.

## Compose expressions

```ts
const subtotal = terp.fragment("?0 + 10");
const multiplier = terp.fragment("?0 * 2");

if (!(subtotal instanceof Error) && !(multiplier instanceof Error)) {
  const total = terp.combine("*", subtotal, multiplier);
  if (!(total instanceof Error)) {
    total.run(5, 3); // (5 + 10) * (3 * 2) = 90
  }
}
```

`combine` preserves types and gives each fragment its own arguments. Tagged
`raw` templates group interpolated source fragments while sharing named/indexed
bindings. Fragments belong to the interpreter that created them. Use
`fragment.explain(...args)` to trace an already prepared fragment.

For custom languages, import the same builders from `jsr:@mewhhaha/terp/core` to
skip construction of the standard interpreter.

## More

- [API and language rules](docs/api.md): named functions, checked execution,
  tracing, completion, limits, and custom operators.
- [Examples](examples/README.md): pricing, pipelines, rules, flags, validation,
  and typed parser combinators.
- [Implementation and measurements](docs/hills.md): the forty implementation
  hills and their verification.
- [Performance](docs/performance.md): fifty measured hills and their tradeoffs.

## Development

```sh
deno task ci
deno task bench:quick
deno task bench
deno task check:watch
deno task types:bench
```

The full gate checks formatting, lint, documentation, types, behavior, example
outputs, the type-checking budget, and package contents. Runtime benchmarks
report setup and execution separately.

MIT. A _terp_ is a raised dwelling mound: a small language built on TypeScript.
