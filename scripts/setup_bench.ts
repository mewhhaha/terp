import { runtime_cases, validate_runtime_cases } from "../bench/runtime.ts";
import { interpreter, type OperatorRegistry } from "../mod.ts";
import { median, sample } from "./measure.ts";
import { fingerprint, host, implementation_files } from "./provenance.ts";

// A longer warmup isolates steady setup cost from startup compiler activity.
const source_sha256 = await fingerprint(await implementation_files());
validate_runtime_cases();
const prepared_small = runtime_cases["construct/small"]() as {
  operators: OperatorRegistry;
};
const prepared_large = runtime_cases["construct/large-100"]() as {
  operators: OperatorRegistry;
};
const workload = {
  ...runtime_cases,
  "construct/prepared-small": () => interpreter(prepared_small.operators),
  "construct/prepared-large-100": () => interpreter(prepared_large.operators),
};
const cases: Record<string, unknown> = {};
for (const [name, run] of Object.entries(workload)) {
  if (
    !name.startsWith("construct/") && !name.startsWith("raw/") &&
    !name.includes("explain")
  ) continue;
  sample(run, 100);
  const samples = Array.from({ length: 7 }, () => sample(run, 50));
  cases[name] = {
    median_cpu_ns: median(samples.map((sample) => sample.cpu)),
    median_ns: median(samples.map((sample) => sample.wall)),
    samples,
  };
}
if (source_sha256 !== await fingerprint(await implementation_files())) {
  throw new Error("setup source changed");
}
const report = {
  version: Deno.version,
  target: Deno.build.target,
  host: await host(),
  source_sha256,
  workload_sha256: await fingerprint([
    "bench/runtime.ts",
    "scripts/measure.ts",
    "scripts/setup_bench.ts",
  ]),
  warmup_ms: 100,
  samples: 7,
  sample_ms: 50,
  cases,
};
await Deno.writeTextFile(Deno.args[0], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(cases, null, 2));
