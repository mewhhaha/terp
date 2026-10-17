import { median } from "./measure.ts";
import {
  fingerprint,
  host,
  implementation_files,
  revision,
} from "./provenance.ts";

const source_sha256 = await fingerprint(await implementation_files());
const cases: Record<string, unknown> = {};
const entries = ["mod.ts"];
try {
  await Deno.stat("core.ts");
  entries.push("core.ts");
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}
for (const entry of entries) {
  const samples = [];
  for (let index = 0; index < 7; index++) {
    const start = performance.now();
    const child = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-check",
        "--allow-read",
        "scripts/cold_worker.ts",
        new URL("../" + entry, import.meta.url).href,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const process_ms = performance.now() - start;
    if (!child.success) throw new Error(new TextDecoder().decode(child.stderr));
    samples.push({
      ...JSON.parse(new TextDecoder().decode(child.stdout)),
      process_ms,
    });
  }
  const medians: Record<string, number> = {};
  for (const field of Object.keys(samples[0])) {
    medians[field] = median(samples.map((sample) => sample[field]));
  }
  cases[entry] = { medians, samples };
}
if (source_sha256 !== await fingerprint(await implementation_files())) {
  throw new Error("source changed during cold measurement");
}
const report = {
  version: Deno.version,
  target: Deno.build.target,
  host: await host(),
  revision: await revision(),
  source_sha256,
  workload_sha256: await fingerprint([
    "scripts/cold_worker.ts",
    "scripts/cold_bench.ts",
  ]),
  method:
    "seven fresh Deno processes per entry; normal on-disk module cache; process startup, module import, first parse, first execution separated",
  cases,
};
if (Deno.args[0]) {
  await Deno.writeTextFile(
    Deno.args[0],
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(JSON.stringify(cases, null, 2));
