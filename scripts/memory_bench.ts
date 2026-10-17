import { runtime_cases, validate_runtime_cases } from "../bench/runtime.ts";
import {
  fingerprint,
  host,
  implementation_files,
  revision,
} from "./provenance.ts";

const names = [
  "construct/small",
  "construct/large-100",
  "raw/arithmetic",
  "run/arithmetic-reused",
  "run/pricing-reused",
];
const output = Deno.args[0];
const worker = Deno.args.indexOf("--worker");
if (worker >= 0) {
  const name = Deno.args[worker + 1];
  const run = runtime_cases[name];
  if (run === undefined) throw new Error(name);
  validate_runtime_cases();
  const module_name: string = "node:v8";
  const { getHeapStatistics } = await import(module_name);
  const gc = (globalThis as unknown as { gc(): void }).gc;
  if (gc === undefined) {
    throw new Error("requires --v8-flags=--expose-gc,--trace-gc");
  }
  let warmup_count = 1000;
  if (name.startsWith("run/")) warmup_count = 100_000;
  if (name.startsWith("raw/")) warmup_count = 10_000;
  for (let index = 0; index < warmup_count; index++) run();
  let count = 10_000;
  if (name === "construct/large-100") count = 1000;
  let retained: unknown[] = new Array(count);
  gc();
  const before = getHeapStatistics();
  const start = performance.now();
  for (let index = 0; index < count; index++) retained[index] = run();
  const elapsed_ms = performance.now() - start;
  const after = getHeapStatistics();
  const gc_start = performance.now();
  gc();
  const forced_gc_ms = performance.now() - gc_start;
  const live = getHeapStatistics();
  // Consume retained results before releasing them, preventing dead-code elimination.
  if (retained.length !== count) throw new Error("lost results");
  retained = [];
  gc();
  const released = getHeapStatistics();
  if (!Number.isFinite(after.total_allocated_bytes)) {
    throw new Error("V8 allocation counter is unavailable");
  }
  console.log(
    "TERP_MEMORY " +
      JSON.stringify({
        name,
        count,
        warmup_count,
        elapsed_ms,
        allocated_bytes: after.total_allocated_bytes -
          before.total_allocated_bytes,
        allocated_bytes_per_op:
          (after.total_allocated_bytes - before.total_allocated_bytes) / count,
        retained_bytes: live.used_heap_size - before.used_heap_size,
        released_heap_delta_bytes: released.used_heap_size -
          before.used_heap_size,
        forced_gc_ms,
      }),
  );
} else {
  const source_sha256 = await fingerprint(await implementation_files());
  const cases = [];
  for (const name of names) {
    const child = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-check",
        "--allow-read",
        "--v8-flags=--expose-gc,--trace-gc",
        "scripts/memory_bench.ts",
        "--worker",
        name,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!child.success) throw new Error(new TextDecoder().decode(child.stderr));
    const trace = new TextDecoder().decode(child.stdout) +
      new TextDecoder().decode(child.stderr);
    // V8's buffered native trace may precede the JS write on the same line.
    const result = /TERP_MEMORY (\{[^\n]*\})/.exec(trace)?.[1];
    if (result === undefined) throw new Error(trace);
    const pauses = [...trace.matchAll(/ (\d+(?:\.\d+)?) \/ [\d.]+ ms/g)].map((
      match,
    ) => Number(match[1]));
    cases.push({
      ...JSON.parse(result),
      worker_gc_events: pauses.length,
      worker_gc_pause_ms: pauses.reduce((a, b) => a + b, 0),
      trace,
    });
  }
  if (source_sha256 !== await fingerprint(await implementation_files())) {
    throw new Error("source changed during memory measurement");
  }
  const report = {
    version: Deno.version,
    target: Deno.build.target,
    host: await host(),
    revision: await revision(),
    source_sha256,
    workload_sha256: await fingerprint([
      "bench/runtime.ts",
      "scripts/memory_bench.ts",
    ]),
    method:
      "V8 total_allocated_bytes delta; preallocated retention array; 1000 large-registry/10000 other retained results; forced full GC before/live/released; trace includes startup and warmup GC",
    cases,
  };
  if (output) {
    await Deno.writeTextFile(output, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(
    JSON.stringify(cases.map(({ trace: _trace, ...row }) => row), null, 2),
  );
}
