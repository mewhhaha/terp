import { fingerprint_text } from "./provenance.ts";
import { median } from "./measure.ts";

const before = Deno.args[0];
let output = Deno.args[1] ?? "bench/performance";
if (before === undefined) {
  throw new Error(
    "usage: deno task bench:qualify BEFORE_DIRECTORY [OUTPUT_DIRECTORY]",
  );
}
const current = Deno.cwd();
const harness = [
  "bench/runtime.ts",
  "bench/scaling.ts",
  "scripts/bench.ts",
  "scripts/measure.ts",
  "scripts/provenance.ts",
  "scripts/memory_bench.ts",
  "scripts/cold_worker.ts",
  "scripts/cold_bench.ts",
  "scripts/lsp_bench.ts",
  "scripts/watch_bench.ts",
];
const temporary = await Deno.makeTempDir({ prefix: "terp-qualification-" });
await Deno.mkdir(output, { recursive: true });
output = await Deno.realPath(output);
async function snapshot(
  root: string,
  name: string,
): Promise<Record<string, string>> {
  const destination = temporary + "/" + name;
  await Deno.mkdir(destination + "/src", { recursive: true });
  const files = ["mod.ts", "deno.json"];
  try {
    await Deno.stat(root + "/core.ts");
    files.push("core.ts");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  for await (const entry of Deno.readDir(root + "/src")) {
    if (entry.isFile && entry.name.endsWith(".ts")) {
      files.push("src/" + entry.name);
    }
  }
  const content = new Map<string, string>();
  for (const file of files.sort()) {
    content.set(file, await Deno.readTextFile(root + "/" + file));
  }
  for (const [file, text] of content) {
    if (text !== await Deno.readTextFile(root + "/" + file)) {
      throw new Error("source changed while freezing " + root);
    }
    await Deno.writeTextFile(destination + "/" + file, text);
  }
  for (const file of harness) {
    const target = destination + "/" + file;
    await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.copyFile(current + "/" + file, target);
  }
  const git = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    cwd: root,
    stdout: "piped",
  }).output();
  return {
    source_root: root,
    snapshot: destination,
    revision: new TextDecoder().decode(git.stdout).trim(),
    frozen_files_sha256: await fingerprint_text(
      [...content].map(([file, text]) => file + "\n" + text).join(""),
    ),
  };
}
async function run(
  snapshot: string,
  script: string,
  destination: string,
  args: string[] = [],
): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-check",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-sys",
      "scripts/" + script + ".ts",
      destination,
      ...args,
    ],
    cwd: snapshot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  await Deno.writeTextFile(
    destination + ".log",
    new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr),
  );
  if (!result.success) {
    throw new Error(script + " failed: " + destination + ".log");
  }
  console.log(destination);
}
try {
  const sources = {
    before: await snapshot(before, "before"),
    current: await snapshot(current, "current"),
  };
  await Deno.writeTextFile(
    output + "/sources.json",
    JSON.stringify(sources, null, 2) + "\n",
  );
  const order = ["before", "current", "current", "before"] as const;
  const reports = [];
  for (const [index, side] of order.entries()) {
    const destination = output + "/runtime-" + (index + 1) + "-" + side +
      ".json";
    await run(sources[side].snapshot, "bench", destination, [
      "--samples=5",
      "--ms=20",
    ]);
    reports.push(JSON.parse(await Deno.readTextFile(destination)));
  }
  const first = reports[0];
  if (
    reports[0].source_sha256 !== reports[3].source_sha256 ||
    reports[1].source_sha256 !== reports[2].source_sha256
  ) throw new Error("source differs between ABBA passes");
  for (const report of reports) {
    for (
      const key of [
        "version",
        "target",
        "host",
        "workload_sha256",
        "samples",
        "sample_ms",
        "filter",
      ]
    ) {
      if (JSON.stringify(report[key]) !== JSON.stringify(first[key])) {
        throw new Error("incomparable runtime reports: " + key);
      }
    }
  }
  const comparisons: Record<string, unknown> = {};
  for (
    const name of new Set([
      ...Object.keys(first.cases),
      ...Object.keys(reports[1].cases),
    ])
  ) {
    if (first.cases[name] === undefined) {
      const samples = [reports[1], reports[2]].flatMap((report) =>
        report.cases[name].samples_cpu_ns
      ) as number[];
      comparisons[name] = {
        before_available: false,
        current_cpu_ns: median(samples),
        current_cpu_range_ns: [Math.min(...samples), Math.max(...samples)],
      };
      continue;
    }
    const baseline = [reports[0], reports[3]].flatMap((report) =>
      report.cases[name].samples_cpu_ns
    ) as number[];
    const changed = [reports[1], reports[2]].flatMap((report) =>
      report.cases[name].samples_cpu_ns
    ) as number[];
    const baseline_wall = [reports[0], reports[3]].flatMap((report) =>
      report.cases[name].samples_ns
    ) as number[];
    const current_wall = [reports[1], reports[2]].flatMap((report) =>
      report.cases[name].samples_ns
    ) as number[];
    comparisons[name] = {
      before_cpu_ns: median(baseline),
      current_cpu_ns: median(changed),
      cpu_ratio: median(changed) / median(baseline),
      before_wall_ns: median(baseline_wall),
      current_wall_ns: median(current_wall),
      wall_ratio: median(current_wall) / median(baseline_wall),
      before_cpu_range_ns: [Math.min(...baseline), Math.max(...baseline)],
      current_cpu_range_ns: [Math.min(...changed), Math.max(...changed)],
    };
  }
  await Deno.writeTextFile(
    output + "/runtime-abba.json",
    JSON.stringify(
      {
        method:
          "interleaved before/current/current/before; two independent processes and ten samples per side; CPU and wall median ratios; full sample spread retained",
        order,
        sources,
        version: first.version,
        target: first.target,
        host: first.host,
        workload_sha256: first.workload_sha256,
        comparisons,
      },
      null,
      2,
    ) + "\n",
  );
  await run(sources.current.snapshot, "bench", output + "/quick-current.json", [
    "--samples=3",
    "--ms=10",
    "--filter=run/arithmetic",
  ]);
  for (const side of ["before", "current"] as const) {
    for (
      const script of ["memory_bench", "cold_bench", "lsp_bench", "watch_bench"]
    ) {
      await run(
        sources[side].snapshot,
        script,
        output + "/" + script.replace("_bench", "") + "-" + side + ".json",
      );
    }
  }
} finally {
  await Deno.remove(temporary, { recursive: true });
}
