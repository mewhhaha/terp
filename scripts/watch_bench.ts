import { median } from "./measure.ts";
import {
  fingerprint,
  host,
  implementation_files,
  revision,
} from "./provenance.ts";

const source_sha256 = await fingerprint(await implementation_files());
const directory = await Deno.makeTempDir({ prefix: "terp-watch-" });
const path = directory + "/edit.ts";
const source = "import { terp } from " +
  JSON.stringify(new URL("../mod.ts", import.meta.url).href) +
  ';\nexport const value: number = terp("1 + 2");\n';
await Deno.writeTextFile(path, source);
const child = new Deno.Command(Deno.execPath(), {
  args: ["check", "--watch", "--no-clear-screen", path],
  stdout: "piped",
  stderr: "piped",
  env: { NO_COLOR: "1" },
}).spawn();
const lines: string[] = [];
const read = async (stream: ReadableStream<Uint8Array>) => {
  let text = "";
  for await (const chunk of stream) {
    text += new TextDecoder().decode(chunk);
    const split = text.split("\n");
    text = split.pop() ?? "";
    lines.push(...split);
  }
};
const readers = Promise.all([read(child.stdout), read(child.stderr)]);
let seen = 0;
async function finished(): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < 30_000) {
    const count = lines.filter((line) =>
      line.includes("Check finished")
    ).length;
    if (count > seen) {
      seen = count;
      return;
    }
    if (lines.some((line) => line.includes("error:"))) {
      throw new Error(
        lines.join("\n"),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("watch timeout: " + lines.join("\n"));
}
try {
  const start = performance.now();
  await finished();
  const cold_check_ms = performance.now() - start;
  const edit_check_ms = [];
  for (let index = 0; index < 5; index++) {
    const edit = performance.now();
    await Deno.writeTextFile(
      path,
      source.replace("1 + 2", "1 + " + (index + 3)),
    );
    await finished();
    edit_check_ms.push(performance.now() - edit);
  }
  if (source_sha256 !== await fingerprint(await implementation_files())) {
    throw new Error("source changed during watch measurement");
  }
  const report = {
    version: Deno.version,
    target: Deno.build.target,
    host: await host(),
    revision: await revision(),
    source_sha256,
    workload_sha256: await fingerprint(["scripts/watch_bench.ts"]),
    method:
      "actual deno check --watch; five isolated consumer edits, completion marker includes watcher debounce",
    cold_check_ms,
    median_edit_check_ms: median(edit_check_ms),
    edit_check_ms,
    log: lines,
  };
  if (Deno.args[0]) {
    await Deno.writeTextFile(
      Deno.args[0],
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.kill();
  await child.status;
  await readers;
  await Deno.remove(directory, { recursive: true });
}
