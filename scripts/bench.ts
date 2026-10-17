import { runtime_cases, validate_runtime_cases } from "../bench/runtime.ts";
import {
  fingerprint,
  host,
  implementation_files,
  revision,
} from "./provenance.ts";
import { sample } from "./measure.ts";
import { scaling_cases } from "../bench/scaling.ts";

interface Measurement {
  median_ns: number;
  samples_ns: number[];
  median_cpu_ns: number;
  samples_cpu_ns: number[];
  min_ns: number;
  max_ns: number;
}
interface Report {
  version: typeof Deno.version;
  target: string;
  source_sha256: string;
  workload_sha256: string;
  revision: string;
  samples: number;
  sample_ms: number;
  cases: Record<string, Measurement>;
  host: Record<string, unknown>;
  filter: string;
  elapsed_ms: number;
}

const started = performance.now();
const positional = Deno.args.filter((arg) => !arg.startsWith("--"));
function option(name: string, fallback: string): string {
  return Deno.args.find((arg) => arg.startsWith("--" + name + "="))?.split("=")
    .slice(1).join("=") ?? fallback;
}
const report: Report = {
  version: Deno.version,
  target: Deno.build.target,
  source_sha256: await fingerprint(await implementation_files()),
  workload_sha256: await fingerprint([
    "bench/runtime.ts",
    "bench/scaling.ts",
    "scripts/measure.ts",
    "scripts/bench.ts",
  ]),
  revision: await revision(),
  samples: Number(option("samples", "9")),
  sample_ms: Number(option("ms", "50")),
  cases: {},
  host: await host(),
  filter: option("filter", ""),
  elapsed_ms: 0,
};
if (
  !Number.isInteger(report.samples) || report.samples < 1 ||
  !Number.isFinite(report.sample_ms) || report.sample_ms <= 0
) throw new Error("invalid sampling configuration");
validate_runtime_cases();
const cases = { ...runtime_cases };
if (!/^(run|raw|construct)\//.test(report.filter)) {
  Object.assign(cases, scaling_cases());
}
const selected = Object.entries(cases).filter(([name]) =>
  name.includes(report.filter)
);
if (selected.length === 0) {
  throw new Error("case filter matched nothing: " + report.filter);
}
for (const [name, run] of selected) {
  sample(run, report.sample_ms);
  const samples = Array.from(
    { length: report.samples },
    () => sample(run, report.sample_ms),
  );
  const samples_ns = samples.map((value) => value.wall);
  const samples_cpu_ns = samples.map((value) => value.cpu);
  const sorted = samples_ns.toSorted((a, b) => a - b);
  const cpu_sorted = samples_cpu_ns.toSorted((a, b) => a - b);
  report.cases[name] = {
    median_ns: sorted[Math.floor(sorted.length / 2)],
    samples_ns,
    median_cpu_ns: cpu_sorted[Math.floor(cpu_sorted.length / 2)],
    samples_cpu_ns,
    min_ns: sorted[0],
    max_ns: sorted[sorted.length - 1],
  };
}
const output = positional[0];
report.elapsed_ms = performance.now() - started;
if (report.source_sha256 !== await fingerprint(await implementation_files())) {
  throw new Error(
    "implementation changed during runtime measurement; retry against a stable snapshot",
  );
}
if (output) {
  await Deno.writeTextFile(output, JSON.stringify(report, null, 2) + "\n");
}
const baseline_path = positional[1];
let baseline: Report | undefined;
if (baseline_path) {
  baseline = JSON.parse(await Deno.readTextFile(baseline_path));
  if (
    baseline?.version.deno !== report.version.deno ||
    baseline?.version.v8 !== report.version.v8 ||
    baseline?.version.typescript !== report.version.typescript ||
    baseline?.target !== report.target
  ) {
    throw new Error(
      "runtime benchmark toolchain/target changed; remeasure its baseline",
    );
  }
  if (JSON.stringify(baseline?.host) !== JSON.stringify(report.host)) {
    throw new Error("runtime benchmark host changed; remeasure its baseline");
  }
  if (baseline?.workload_sha256 !== report.workload_sha256) {
    throw new Error(
      "runtime benchmark workload changed; remeasure the baseline with this workload",
    );
  }
}
for (const [name, measurement] of Object.entries(report.cases)) {
  let comparison = "";
  const before = baseline?.cases[name];
  if (before) {
    comparison = "  " + (measurement.median_ns / before.median_ns).toFixed(2) +
      "x baseline";
    if (before.median_cpu_ns) {
      comparison += " / " +
        (measurement.median_cpu_ns / before.median_cpu_ns).toFixed(2) + "x CPU";
    }
  }
  console.log(
    name.padEnd(28),
    measurement.median_ns.toFixed(0).padStart(9),
    "ns/op (CPU " + measurement.median_cpu_ns.toFixed(0) + ")" + comparison,
  );
}
