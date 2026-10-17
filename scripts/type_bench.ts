import { type_workload, type TypeWorkload } from "./type_workload.ts";
import {
  fingerprint,
  fingerprint_text,
  implementation_files,
  revision,
} from "./provenance.ts";

const category = Deno.args[3] ?? "combined";
if (!["combined", "valid", "invalid", "placeholders"].includes(category)) {
  throw new Error("unknown type workload category: " + category);
}
const workload_category = category as TypeWorkload;
const directory = await Deno.makeTempDir({ prefix: "terp-type-bench-" });
try {
  const source_sha256 = await fingerprint(await implementation_files());
  const workload = directory + "/workload.ts";
  const module_url = new URL("../mod.ts", import.meta.url).href;
  await Deno.writeTextFile(
    workload,
    type_workload(module_url, workload_category),
  );
  const samples_ms: number[] = [];
  const instantiations: number[] = [];
  let sample_count = 5;
  if (Deno.args[2] === "1") sample_count = 1;
  for (let index = 0; index < sample_count; index += 1) {
    const start = performance.now();
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "check",
        "--config",
        "bench/type_config.json",
        "--reload",
        "--log-level=debug",
        workload,
      ],
      stdout: "null",
      stderr: "piped",
      signal: AbortSignal.timeout(180_000),
    }).output();
    const stderr = new TextDecoder().decode(result.stderr);
    if (!result.success) {
      throw new Error(
        "type workload check failed (exit " + result.code + ", signal " +
          result.signal + "): " + stderr,
      );
    }
    const count = stderr.match(/\bInstantiations:\s+(\d+)/);
    if (!count) {
      throw new Error(
        "Deno did not report compiler instantiations; inspect --log-level=debug statistics before updating this script",
      );
    }
    instantiations.push(Number(count[1]));
    samples_ms.push(performance.now() - start);
  }
  if (new Set(instantiations).size !== 1) {
    throw new Error(
      "compiler instantiation counts changed between samples; freeze the measured source before retrying",
    );
  }
  if (source_sha256 !== await fingerprint(await implementation_files())) {
    throw new Error(
      "implementation changed during type measurement; retry against a stable snapshot",
    );
  }
  const median_ms = samples_ms.toSorted((a, b) =>
    a - b
  )[Math.floor(samples_ms.length / 2)];
  const report = {
    version: Deno.version,
    target: Deno.build.target,
    revision: await revision(),
    source_sha256,
    workload_sha256: await fingerprint_text(
      type_workload("terp:public-api", workload_category) +
        await Deno.readTextFile("bench/type_config.json"),
    ),
    workload_category,
    expressions: type_workload("terp:public-api", workload_category).split("\n")
      .filter((line) => line.startsWith("const ")).length,
    samples_ms,
    median_ms,
    instantiations: instantiations[0],
  };
  const output = Deno.args[0];
  if (output && output !== "-") {
    await Deno.writeTextFile(output, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(
    "type workload median:",
    median_ms.toFixed(0),
    "ms",
    "samples:",
    samples_ms.map((value) => value.toFixed(0)).join(", "),
    "instantiations:",
    instantiations[0],
  );
  const baseline_path = Deno.args[1];
  if (baseline_path) {
    const baseline = JSON.parse(await Deno.readTextFile(baseline_path));
    if (
      baseline.version.deno !== report.version.deno ||
      baseline.version.typescript !== report.version.typescript
    ) {
      throw new Error(
        "type benchmark toolchain changed; remeasure its baseline",
      );
    }
    if (baseline.workload_sha256 !== report.workload_sha256) {
      throw new Error(
        "type benchmark workload changed; remeasure its baseline",
      );
    }
    // Compiler work is deterministic across scheduling noise and host speeds.
    const ceiling = Math.ceil(baseline.instantiations * 1.1 + 500);
    console.log(
      "instantiation ceiling:",
      ceiling,
      "wall ratio:",
      (median_ms / baseline.median_ms).toFixed(2),
    );
    if (report.instantiations > ceiling) {
      throw new Error(
        "typecheck instantiation budget exceeded; inspect the workload and implementation before changing the baseline",
      );
    }
  }
} finally {
  await Deno.remove(directory, { recursive: true });
}
