# Performance hills 1–50

Terp builds small typed expression languages from ordinary functions. This pass
keeps that intent: move repeatable work to preparation, reduce compiler work,
and measure construction, interactive use, execution, and memory separately.

The comparison starts at `0.4.0`, commit
`4b22c07d9f4e7c0eb950dcf84354f2d52e0e7fdd`. All fifty hills were evaluated.
Experiments without a convincing benefit were rejected; they are not additional
production backends or configuration switches.

## Results

Final measurements and their limitations are recorded below. Runtime evidence is
in [the ABBA report](../bench/performance/runtime-abba.json); source pins are in
[sources.json](../bench/performance/sources.json). The prior implementation pass
remains documented in [hills.md](hills.md).

CPU medians on the recorded Ryzen 7 3800X host. Construction/parsing rows use
the longer-warmup [setup ABBA](../bench/performance/setup-abba.json): 100 ms
warmup and fourteen 50 ms samples per side. Short full-matrix construction
samples were noisy; both reports are preserved.

| Workload                                 |        0.4.0 |    Current | Current / before |
| ---------------------------------------- | -----------: | ---------: | ---------------: |
| Reused arithmetic                        |     0.181 µs |   0.082 µs |           0.456× |
| Reused pricing                           |     0.529 µs |   0.258 µs |           0.487× |
| Reused rules                             |     0.344 µs |   0.165 µs |           0.481× |
| Repeated direct arithmetic, cache hit    |     1.713 µs |   0.105 µs |           0.061× |
| Invalid compilation                      |    15.611 µs |   7.355 µs |           0.471× |
| 24 nested groups                         |     7.831 µs |   3.301 µs |           0.421× |
| Standard completion (`1 +` then a space) |   479.326 µs |  84.093 µs |           0.175× |
| 1000-entry empty-prefix completion       | 84443.000 µs | 101.520 µs |           0.001× |
| Reuse prepared 100-operator registry     |   107.287 µs |   3.728 µs |           0.035× |
| Construct fresh small grammar            |     6.657 µs |  11.071 µs |           1.663× |
| Construct fresh 100-operator grammar     |    85.174 µs | 113.186 µs |           1.329× |
| Create raw arithmetic runner             |     1.473 µs |   1.698 µs |           1.153× |
| Parse and explain arithmetic             |     1.766 µs |   2.249 µs |           1.273× |

Reused arithmetic/pricing/rules are **2.1–2.2× faster**. Direct-call cache hits
are **15–17× faster**; the cache experiment separately records unique and
cycling miss costs of 2.7% and 3.5%. Fresh construction, raw preparation, and
one-off explanation remain slower. Prepared-fragment explanation takes about 104
ns for the one-operation fragment workload; it is a different workload from the
two-operation parse-and-explain row.

The unchanged combined type corpus falls from **624544 to 543104 instantiations
(−13.04%)**. Engine-only category experiments reduce valid/invalid/placeholder
work by 16.1%/14.5%/23.3%. Those isolate the type engine; the combined final
report includes the integrated API. The corpus has 99 expression calls; the
older report label of 24 counted generated trees, not calls. Workload bytes and
hash match.

Allocation and retention are distinct:

| Memory workload                                |   Before |  Current |
| ---------------------------------------------- | -------: | -------: |
| Reused arithmetic allocated bytes/call         |   1235 B |    101 B |
| Reused pricing allocated bytes/call            |   2500 B |    135 B |
| Raw runner allocated bytes/creation            |   3882 B |   2640 B |
| Fresh 100-operator grammar allocated bytes     | 144837 B |  97028 B |
| 10000 unused raw runners retained heap         | 10.55 MB | 13.05 MB |
| 1000 fresh 100-operator grammars retained heap | 23.15 MB | 31.71 MB |

Unused runner retention remains **24% higher** than 0.4.0. Executed runners
retain both tree and closure graph: the isolated experiment measured about 2805
bytes/runner, versus 1303 bytes before execution. Lazy preparation reduced
unused retention from the first implementation’s 28 MB to 13 MB per 10000
runners. It shifts roughly 0.36 µs to first invocation, with creation plus first
execution essentially unchanged. Actual GC traces and released-heap deltas are
retained in the [memory reports](../bench/performance/memory-current.json).

Cold/editor results do **not** establish a general latency win. Seven fresh
standard-entry processes measured import 1.68 → 1.98 ms and process lifetime
28.1 → 31.9 ms. The core entry imported in 2.40 ms, required another 0.75 ms for
explicit grammar initialization, and had a 51.4 ms process median. Its benefit
is avoiding implicit standard-interpreter construction; this capture does not
show faster cold startup. LSP diagnostics were 30.2 → 30.6 ms, hover 0.69 → 1.09
ms, and completion 6.63 → 6.23 ms. Watch edits were 687 → 727 ms including
debounce. These small sequential samples vary with host load.

The focused five-case benchmark takes about **211 ms** inside the benchmark
process; the complete 81-case current capture takes about **9861 ms**. CLI
startup is additional. Production source grows from 2759 to 3155 lines; the
additional prepared execution and completion machinery is a real code-size cost.

Final implementation SHA-256:
`eb6bbf121c4e88df536134f05a73f287e87c404d7de640901d61799c68f45212`. All final
runtime, setup, type, memory, cold, LSP, and watch reports match this digest.
Experimental reports keep their own earlier source pins.

## Decisions

“Retained” means present in production. “Rejected” means measured and
deliberately left out. Related changes share end-to-end measurements; the report
does not attribute the entire gain to each individual edit.

| Hill                                               | Outcome                 | Implementation or evidence                                                                                                                                                          |
| -------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Snapshot definitions once                       | Retained                | One final frozen definition per overload; preserves inherited metadata and prototype methods.                                                                                       |
| 2. Fuse validation and preparation                 | Retained                | Registry validation, snapshotting, and descriptor preparation share a traversal.                                                                                                    |
| 3. Prebuild lookup descriptors                     | Retained                | Parser lookup returns the prepared unary/binary descriptor, without per-lookup arrays or freezing.                                                                                  |
| 4. Avoid testing every operator per word character | Retained                | Symbol-start guard and first-character candidate filtering reduce type work.                                                                                                        |
| 5. Cheaper longest-token matching                  | Retained                | Prefix recursion and mapped candidates; isolated type sequence 624303 → 618926 instantiations.                                                                                      |
| 6. Parse completion context once                   | Retained                | Parser probes the cursor with a virtual operand; ordinary candidates use the resulting context. Lexical ambiguities and long/malformed prefixes use exact candidate qualification.  |
| 7. Avoid duplicate error stacks                    | Retained                | Synthetic compatibility causes are created only when inspected. Actual application exceptions retain identity.                                                                      |
| 8. Remove eager operand arrays                     | Retained                | Ordinary unary/binary execution calls prepared children directly. Hook and trace paths retain their required operand records.                                                       |
| 9. Compile distinct binding requirements           | Retained                | Validate each unique slot/key once before callbacks; actual property reads remain live. Proxy validation observations are consequently deduplicated.                                |
| 10. Reuse trusted immutable tables                 | Retained                | Passing an interpreter's frozen `.operators` reuses its prepared table. Mutable application registries always receive a new snapshot.                                               |
| 11. Cheaper type precedence comparison             | Rejected                | Simpler tuple comparison added 268 instantiations. A counter saved only 56 and added machinery.                                                                                     |
| 12. Aggregate named holes once                     | Retained                | One binding fold handles named, indexed, and anonymous holes.                                                                                                                       |
| 13. Avoid scans for sparse index gaps              | Retained                | Direct sparse-index lookup; binding changes together reduce 618926 → 617864 instantiations.                                                                                         |
| 14. Reduce type-hole tuple copying                 | Rejected                | Constraint trees added 300 combined and 3084 placeholder instantiations.                                                                                                            |
| 15. Share analysis projections                     | Verified; no new helper | The compiler already reuses shared analysis. Extra projectors saved only 255 instantiations (0.044%) while adding API/code.                                                         |
| 16. Reduce token-stream copying                    | Retained                | Shallow linked streams reduce 617864 → 582934 instantiations without exceeding recursion limits.                                                                                    |
| 17. Avoid split-suffix relexing                    | Rejected                | Shortcut cost 126261 versus 123407 instantiations across 17 cases; keep the cached lexer fallback.                                                                                  |
| 18. Separate type workload categories              | Retained                | Combined, valid, invalid, and placeholder workloads; original combined workload bytes remain unchanged.                                                                             |
| 19. Compile evaluator closures once                | Retained                | Runners prepare evaluators on first execution, then reuse them. This halves unused-runner retention versus eager preparation; executed runners still retain both tree and closures. |
| 20. Remove checked-runner forwarding               | Retained                | Checked boundaries call the prepared evaluator directly between argument/result guards.                                                                                             |
| 21. Reduce lazy-thunk closures                     | Retained                | One memo closure per operand; exploratory 121 → 50 ns, with lazy order and reentrancy tests.                                                                                        |
| 22. Specialize common function arities             | Retained                | Direct calls for zero through three arguments; general fallback for larger calls.                                                                                                   |
| 23. Select execution modes outside the inner loop  | Retained                | Prepare ordinary and replacement modes once; build trace evaluators lazily.                                                                                                         |
| 24. Scan with cursors                              | Retained                | Sticky numeric/identifier scans avoid suffix strings and set their cursor explicitly on every use.                                                                                  |
| 25. Fast whitespace runs                           | Retained                | ASCII whitespace uses character codes; Unicode whitespace retains language behavior.                                                                                                |
| 26. Slice unescaped strings directly               | Retained                | Scan quote/escape positions and copy segments; preserve escaped quotes and incomplete-escape diagnostics.                                                                           |
| 27. Cache operator lookahead                       | Rejected                | Synthetic repeated lookups improved 40–56%, but arithmetic stayed flat, rules/adjacency regressed, and only named functions improved 12.5%.                                         |
| 28. Compute heights in existing loops              | Retained                | Function parsing updates maximum operand height while collecting arguments.                                                                                                         |
| 29. Classify operators once                        | Retained                | Word/symbol classification lives in prepared descriptors.                                                                                                                           |
| 30. Sort within lookup buckets                     | Retained                | Parsing sorts only each initial-character bucket; completion order is prepared lazily.                                                                                              |
| 31. Choose linear/indexed lookup crossover         | Rejected                | A linear path for at most eight tokens made four/eight-token compilation 17%/34% slower. Keep one bucketed implementation.                                                          |
| 32. Allocate fragment ownership lazily             | Retained                | Create the fragment WeakMap only when the first fragment is made.                                                                                                                   |
| 33. Lightweight custom-language import             | Retained                | `@mewhhaha/terp/core` exports builders and types without constructing the standard interpreter.                                                                                     |
| 34. Index completion vocabulary                    | Retained                | A lazy sorted vocabulary permits binary prefix search; returned ordering remains compatible.                                                                                        |
| 35. Bound completion prefixes                      | Retained                | Prefixes over 100000 characters return no suggestions before scanning or preparing vocabulary. Text after the cursor remains irrelevant.                                            |
| 36. Explain a compiled plan                        | Retained                | `fragment.explain(...args)` reuses its prepared plan, including independently bound combinations.                                                                                   |
| 37. Reuse immutable trace spans                    | Retained                | Prepared frozen spans are reused; operands and trace lists remain invocation-local.                                                                                                 |
| 38. Share fragment trees                           | Retained                | Composition retains operand plans with binding/source offsets instead of cloning their trees.                                                                                       |
| 39. Build composed display text lazily             | Retained                | Source text is assembled only when requested or needed for diagnostics.                                                                                                             |
| 40. Bounded source-cache experiment                | Retained, one entry     | Cache only the latest successful direct-call source up to 1024 characters. A 64-entry Map increased miss costs 1.6–2× and was rejected.                                             |
| 41. Closure backend experiment                     | Retained                | Preserves validation, effects, hooks, laziness, errors, and traces; qualified with complete library workloads.                                                                      |
| 42. Compact instruction VM                         | Rejected                | Eager-only VM measured 50.6 ns versus validated closures 53.6 ns, with an earlier VM result of 86.5 ns. No demonstrated full-semantics benefit.                                     |
| 43. Pure constant-folding experiment               | Rejected                | Prototype 157 → 70 ns, but removed trace steps; arbitrary callbacks cannot be assumed pure or invoked during compilation.                                                           |
| 44. Scaling matrix                                 | Retained                | Independent operator/value sizes, source lengths/shapes, argument counts, completion prefixes, and invalid syntax.                                                                  |
| 45. Interleaved comparisons                        | Retained                | Frozen before/current/current/before processes; comparable source, workload, toolchain, and host metadata required.                                                                 |
| 46. Allocation, GC, and retention                  | Retained                | V8 allocated-byte counter, forced-GC live/released heap, and actual GC trace logs.                                                                                                  |
| 47. Cold import and first use                      | Retained                | Seven fresh processes per entry; separate import, grammar construction, parse, and execution measurements.                                                                          |
| 48. Actual editor latency                          | Retained                | Real Deno LSP diagnostics, hover, and nonempty completion responses across document edits.                                                                                          |
| 49. Selectable quick benchmarks                    | Retained                | `bench:quick` and case filters preserve the full unfiltered workload.                                                                                                               |
| 50. Focused edit/check loops                       | Retained                | `check:watch` and `test:watch`; five real edits qualify the check loop including filesystem debounce.                                                                               |

Type experiments and rejected alternatives are recorded in
[types-results.json](../bench/experiments/types-results.json). Parser
experiments include their patches, harness, source hashes, five-sample
distributions, and semantic checks in
[parser-results.json](../bench/experiments/parser-results.json). The follow-up
[lazy-preparation experiment](../bench/experiments/lazy-execution-results.json)
records the first-invocation cost and lower unused-runner retention.
Execution/cache/VM/folding experiments are in
[execution-results.json](../bench/experiments/execution-results.json).

## Measurement method

Qualification uses frozen snapshots of revision `4b22c07` and the final working
tree. Runtime cases run in before/current/current/before order, with two
processes and ten samples per side. Reports retain every wall and CPU sample,
sample ranges, Deno/V8/TypeScript versions, workload and implementation hashes,
CPU model, affinity, and scheduler policy. Ratios are CPU medians unless marked
otherwise. Historical runtime and type baselines remain unchanged. The previous
type budget is preserved as `bench/performance/types-before.json`; the active
budget is tightened to the final measured count.

The scaling workload varies operator and value registries independently at
0/10/100/1000 entries, flat and nested sources at 4/32/96 elements, argument
counts at 1/4/16, empty/word/operator/missing completion prefixes, and six
invalid shapes. Every parser/runner case validates its expected result before
measurement.

Memory qualification reads V8's cumulative allocated-byte counter around a fixed
loop, retains results in a preallocated array, and forces full GC before
measuring live and released heap. Raw parsing warms for 10000 operations, reused
execution for 100000, and construction for 1000. Actual V8 GC trace lines and
pause durations are preserved; worker GC counts include startup and warmup.
Signed retained deltas around primitive-valued runners can contain collection
noise.

Cold results use seven fresh processes per entry point, with the normal on-disk
module cache. Process startup, module import, optional explicit core grammar
initialization, first parse, and first execution are separate measurements.
`core.ts` constructs a two-operator arithmetic grammar explicitly and does not
initialize the full standard interpreter.

Editor results execute the actual `deno lsp` JSON-RPC protocol. Six
whole-document edits alternate valid and invalid expressions; measurements wait
for matching-version expected diagnostics and then request hover and nonempty
symbol completion results. First expected diagnostics can precede completion of
later diagnostic batches. The watch measurement executes `deno check --watch`
across five real expression edits and includes filesystem debounce.

`deno task bench:quick` selects arithmetic cases with three 10ms samples.
`deno task bench --filter=scale/completion --samples=5 --ms=20` selects another
slice. Unfiltered `deno task bench` retains the full workload.
`deno task check:watch` and `deno task test:watch` provide focused loops; full
CI remains `deno task ci`.

The host may assign benchmark threads `SCHED_IDLE`. This capture used an
external wrapper to restore `SCHED_OTHER` for its own subprocess tree;
normalization counts are preserved in the report. CPU medians reduce scheduling
noise but do not make shared-host results universal. Experimental backend
microbenchmarks are explicitly exploratory and do not replace the frozen
full-library comparison.

```sh
git worktree add --detach /tmp/terp-before 4b22c07
deno task bench:qualify /tmp/terp-before
deno task types:bench bench/performance/types-current.json bench/type-budget.json 1
deno task types:bench /tmp/types-valid.json '' 1 valid
deno run --allow-read --allow-write --allow-run=git,cat --allow-sys scripts/setup_bench.ts /tmp/setup-current.json
deno task bench:quick
deno task bench --filter=scale/completion --samples=5 --ms=20
deno task check:watch
deno task test:watch
```

## Verification

`deno task ci` passes formatting, lint, public documentation checks, type
checking, 91 tests, all eight golden example outputs, the instantiation budget,
and a publish dry run. Regression coverage includes snapshot reuse/isolation,
Unicode whitespace and escapes, binding/callback order, lazy and hook execution,
combined-fragment traces, live getters, source/depth/type boundaries, and
completion qualification. An additional temporary differential harness compared
12506 focused and generated completion inputs with `0.4.0`, with no mismatches.

Qualification is local to Deno 2.9.7 / TypeScript 6.0.3 on the recorded Linux
host. No cross-engine or release-publication claim is implied.
