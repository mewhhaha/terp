# Implementation hills

All forty hills have implementations and verification below. The full gate is
`deno task ci`; focused checks do not replace it. Measurements retain source and
workload fingerprints.

| #  | Hill                              | Result and evidence                                                                                                                                                                                |
| -- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Type precedence and associativity | One precedence parser; left/right/non-associative chains and prefix ties asserted in [type tests](../src/expression_types.test.ts).                                                                |
| 2  | Literal result types              | Literal values and operator/function results retain inferred types; [type tests](../src/expression_types.test.ts).                                                                                 |
| 3  | Optional/rest function signatures | Optional, fixed-plus-rest, and placeholder argument tuples match callable signatures; [type tests](../src/expression_types.test.ts).                                                               |
| 4  | Grouped arguments                 | Grouped expressions form one typed function argument; [type tests](../src/expression_types.test.ts).                                                                                               |
| 5  | Remove unchecked `op` fallback    | Literal declarations and excess required callback parameters fail checking; dynamic strings use explicit `op.raw`; [declaration tests](../src/operator_dsl.test.ts).                               |
| 6  | Honest hook results               | Hooked languages return `unknown`; unchanged language results remain inferred; [runtime/type assertions](../src/runtime.test.ts).                                                                  |
| 7  | Own callable properties           | Inherited names never enter vocabulary; [conformance tests](../src/conformance.test.ts).                                                                                                           |
| 8  | Word operator boundaries          | Longest arity-compatible matches respect identifier boundaries; [conformance](../src/conformance.test.ts) and [type tests](../src/expression_types.test.ts).                                       |
| 9  | Registry snapshots                | Frozen shallow snapshots isolate registry, metadata, and value-table mutations while retaining prototype operator methods; [runtime tests](../src/runtime.test.ts).                                |
| 10 | Validate before effects           | Syntax and all argument bindings are validated before application callbacks; zero-call assertions in [runtime tests](../src/runtime.test.ts).                                                      |
| 11 | Execution order                   | Operands execute left to right; independent tree-oracle traces verify order in [conformance tests](../src/conformance.test.ts).                                                                    |
| 12 | Fragment grouping                 | Text interpolation parenthesizes source fragments; [runtime tests](../src/runtime.test.ts).                                                                                                        |
| 13 | Interpreter provenance            | Per-instance WeakMap ownership rejects foreign or forged fragments; [runtime tests](../src/runtime.test.ts).                                                                                       |
| 14 | Lexical parity                    | Whitespace, escapes, signed/radix/scientific numbers, word prefixes, and operator overlaps covered by [type](../src/expression_types.test.ts) and [interpreter tests](../src/interpreter.test.ts). |
| 15 | Compile runners once              | Runners retain parsed plans; reused/direct/raw real-DSL timings in [runtime measurements](../bench/runtime-current.json).                                                                          |
| 16 | Remove reference scanner          | The runtime parser builds reference bindings and execution nodes together; [runtime implementation](../src/runtime.ts).                                                                            |
| 17 | Typecheck budget                  | One CI sample enforces deterministic compiler-instantiation headroom; five-sample manual timings remain diagnostic; [budget script](../scripts/type_bench.ts).                                     |
| 18 | Single type parse                 | A shared analysis supplies validation, argument tuples, result types, and reference detection; [type engine](../src/expression_types.ts).                                                          |
| 19 | Predictable deep grouping         | Type analysis defers safely; runtime depth/source limits return located errors; [type](../src/expression_types.test.ts) and [runtime tests](../src/runtime.test.ts).                               |
| 20 | Operator lookup index             | First-character buckets retained after measured lookup/build-cost experiment; [lookup artifact](../bench/lookup.json).                                                                             |
| 21 | Avoid duplicate CI checking       | `check` covers tests/examples/tooling; CI executes `test --no-check`; [tasks](../deno.json).                                                                                                       |
| 22 | Indexed placeholders              | Multi-digit, repeated, sparse, leading-zero, named-plus-positional, and anonymous slots are checked; [type tests](../src/expression_types.test.ts).                                                |
| 23 | Source spans                      | Errors and trace steps carry source offsets; public spans cannot mutate retained plans; [runtime tests](../src/runtime.test.ts).                                                                   |
| 24 | Error codes and causes            | Structured TypeError subclass retains classification and original callback/guard exceptions; [errors](../src/errors.ts) and [runtime tests](../src/runtime.test.ts).                               |
| 25 | Type diagnostics                  | Invalid literals expose focused `expression_error` diagnostics; expected-error assertions in [interpreter tests](../src/interpreter.test.ts).                                                      |
| 26 | Differential type/runtime checks  | One generated corpus supplies literal acceptance/rejection checks and runtime cases; [type workload](../scripts/type_workload.ts).                                                                 |
| 27 | Grammar-aware fuzzing             | 96 seeded trees × three input sets, execution traces, and 480 malformed cases use an independent evaluator; [corpus](../scripts/corpus.ts).                                                        |
| 28 | Assert example output             | All eight discovered examples must match committed stdout snapshots; [example runner](../scripts/examples.ts).                                                                                     |
| 29 | Small benchmark suite             | Construction, validation, execution, DSLs, nesting, and retained experiments have observable workloads and source fingerprints; [benchmarks](../bench/runtime.ts).                                 |
| 30 | Shorter real DSL examples         | Pricing now uses `op`; function DSL is smaller with unchanged golden output; [pricing](../examples/pricing_dsl.ts) and [functions](../examples/functions_dsl.ts).                                  |
| 31 | Guard helper experiment           | Kept a seven-line local predicate wrapper; removed duplicated checked unary/binary builders; [functions DSL](../examples/functions_dsl.ts).                                                        |
| 32 | Parser example types              | Monomorphic text/record algebras preserve parser output types; recovery casts removed and negative assertions added; [parser example](../examples/applicative_parser.ts).                          |
| 33 | Explicit exports                  | Named public value/type exports replace wildcard internals; documentation and JSR validation check [public module](../mod.ts).                                                                     |
| 34 | Shorter README                    | Reduced the introduction to a working custom language, essential APIs, and links; [README](../README.md).                                                                                          |
| 35 | Lazy controls                     | Retained memoized lazy operator thunks; standard boolean short-circuiting and callback counts verified in [runtime tests](../src/runtime.test.ts).                                                 |
| 36 | Typed fragments                   | Retained typed `.fragment` runners and result-aware composition; [runtime/type assertions](../src/runtime.test.ts).                                                                                |
| 37 | Independent fragment parameters   | Structural `.combine` concatenates independent positional and scope arguments; source-template sharing remains explicit; [runtime tests](../src/runtime.test.ts).                                  |
| 38 | Checked runtime guards            | Retained `.checked` with typed input/result predicates and validation errors; behavior tested and overhead [measured](../bench/runtime-current.json).                                              |
| 39 | Explain trace                     | Retained `.explain`: execution-order values/spans, one execution, skipped lazy branches omitted; [tests](../src/runtime.test.ts) and [timings](../bench/runtime-current.json).                     |
| 40 | Vocabulary completion             | Retained `.complete`: twenty prefix cases plus open-group/partial-symbol regressions, zero callback execution; [tests](../src/runtime.test.ts) and [timings](../bench/runtime-current.json).       |

## Reproduce verification

`deno task check` checks the public module, all test files, examples,
benchmarks, and scripts. `deno task test` retains ordinary Deno typechecking;
`deno task test:ci` reuses the preceding explicit check. CI pins Deno 2.9.7
(TypeScript 6.0.3).

`deno task examples` discovers `examples/*.ts` and compares each complete stdout
against `scripts/examples.golden.json`. Inspect behavior before intentionally
updating snapshots with `deno task examples:update`.

The seeded grammar corpus uses 96 numeric trees, three input sets per tree,
callback-order traces, and five malformed mutations per source. It compares
actual values against a tree evaluator that never parses expression text.
`scripts/type_workload.ts` emits the first 24 trees as checked literal calls
plus 72 compile rejection assertions and named/repeated/sequential placeholder
cases.

## Measurements

`deno task ci` passed: 77 tests, eight asserted examples, the generated type
budget, documentation checks, and publish dry-run. The qualification log is
`/tmp/terp-ci.log`. Production TypeScript decreased from 4140 to 2759 lines
(1381 removed, 33.4%); `bench/code-size.json` lists every counted file.

Before artifacts use revision `1c372df1c710953605ce7e03ac34e5ca2af45268`. After
artifacts identify the working tree with an exact implementation SHA-256;
`bench/runtime-current.json` and `bench/type-budget.json` have the same source
fingerprint. Both samplers reject source changes during measurement. Runtime
comparisons also reject different workloads, toolchains, or targets.

| Workload                    | Before CPU µs/op | After CPU µs/op | Result       |
| --------------------------- | ---------------: | --------------: | ------------ |
| Construct small registry    |            5.222 |          16.824 | 3.22× slower |
| Construct large registry    |           33.593 |         177.645 | 5.29× slower |
| Reject malformed input      |           17.232 |          27.550 | 1.60× slower |
| Reused arithmetic runner    |            5.546 |           0.372 | 14.9× faster |
| Reused pricing runner       |           14.144 |           1.009 | 14.0× faster |
| Reused rules runner         |            7.681 |           0.643 | 11.9× faster |
| Compile with large registry |            7.728 |           3.867 | 2.00× faster |
| Compile 24 nested groups    |           35.973 |          12.673 | 2.84× faster |

The large registry adds 100 operators to the standard vocabulary. Immutable
snapshots and indexes increase construction cost; located validation errors also
cost more. These regressions accompany the runner improvements. The full 19-case
after report retains direct calls and raw runners as well. New API CPU costs
were 0.417 µs for a checked runner, 3.077 µs for explain, 0.235 µs for a typed
fragment, 0.550 µs for independent composition, 0.559 µs for template
composition, and 0.981 ms for completion. These features have no artificial
before baseline.

The type workload regressed from 471538 to 624544 compiler instantiations
(+32.4%). Five-check wall medians were 7.029 s before and 13.132 s after
(+86.8%), with substantial host contention. The richer type parser is more
expensive on this corpus; no type-speedup claim is made. CI checks one generated
workload against the post-change reference with a deterministic ceiling of
687499 instantiations (10% plus 500 headroom). Manual measurement retains five
forced checks and requires identical counts between samples.

The isolated type workload uses `bench/type_config.json`: `esnext` libraries and
`skipLibCheck: true` exclude unrelated Deno ambient-library checking. The full
project check retains its normal configuration. Type checks include process
startup and have a 180-second watchdog. Toolchain and workload changes require a
new reference.

`deno task bench:lookup bench/lookup.json` compares a longest-first linear scan
with first-character buckets, including word boundaries and mixed matches and
misses. CPU medians were 123/82 ns for 10 tokens, 769/143 ns for 100 tokens, and
6734/567 ns for 1000 tokens (linear/bucketed). Building the index amortized
after 29/8/6 probes. The runtime builds buckets once per grammar. This isolated
lookup experiment does not hide the measured construction regressions above.

## Reproduce measurements

Use the same Deno executable for both revisions:

```sh
deno task bench /tmp/runtime-current.json bench/runtime-baseline.json
deno task types:bench /tmp/type-current.json bench/type-budget.json
deno task types:budget
```

Runtime samples warm each case for 100 ms, then report the median of nine 50 ms
samples, timing batches of 100 operations. Benchmark results are smoke-checked
before timing and remain observable. Reports retain every wall-time and process
CPU-time sample. CPU time and compiler instantiation counts support the
comparisons above; wall time is too noisy here for a CI timing gate.

The host repeatedly placed spawned processes in `SCHED_IDLE`. An external
`/tmp/terp-normalize.py` helper requested normal `SCHED_OTHER` scheduling for
only each benchmark and its own descendant threads, polling every 50 ms.
Artifacts record requested policy, observed policies, and normalization counts.
Host contention still affected wall time. The repository scripts contain no host
scheduling workaround.

The preserved before snapshot was `/tmp/terp-before-hills`. Reproduction does
not require that directory: check out the recorded revision in a separate
worktree, copy the current `bench/` and `scripts/` workloads into it, and run
the same commands. Feature detection skips APIs absent from that revision; the
shared legacy cases use identical workload fingerprints.
