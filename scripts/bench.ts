import { runtime_cases, validate_runtime_cases } from "../bench/runtime.ts";
import { fingerprint, implementation_files, revision } from "./provenance.ts";
import { sample } from "./measure.ts";

interface Measurement {
  median_ns: number;
  samples_ns: number[];
  median_cpu_ns: number;
  samples_cpu_ns: number[];
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
}

const report: Report = {
  version: Deno.version,
  target: Deno.build.target,
  source_sha256: await fingerprint(await implementation_files()),
  workload_sha256: await fingerprint(["bench/runtime.ts"]),
  revision: await revision(),
  samples: 9,
  sample_ms: 50,
  cases: {},
};
validate_runtime_cases();
for (const [name, run] of Object.entries(runtime_cases)) {
  sample(run, 100);
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
  };
}
const output = Deno.args[0];
if (report.source_sha256 !== await fingerprint(await implementation_files())) {
  throw new Error(
    "implementation changed during runtime measurement; retry against a stable snapshot",
  );
}
if (output) {
  await Deno.writeTextFile(output, JSON.stringify(report, null, 2) + "\n");
}
const baseline_path = Deno.args[1];
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
