const golden_url = new URL("./examples.golden.json", import.meta.url);
const actual: Record<string, string> = {};
const paths: string[] = [];
for await (const entry of Deno.readDir("examples")) {
  if (entry.isFile && entry.name.endsWith(".ts")) {
    paths.push("examples/" + entry.name);
  }
}
paths.sort();
if (paths.length === 0) throw new Error("no runnable examples discovered");
for (const path of paths) {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-check", "--quiet", path],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(
      path + " failed:\n" + new TextDecoder().decode(result.stderr),
    );
  }
  actual[path] = new TextDecoder().decode(result.stdout);
}
if (Deno.args.includes("--update")) {
  await Deno.writeTextFile(golden_url, JSON.stringify(actual, null, 2) + "\n");
} else {
  const expected: Record<string, string> = JSON.parse(
    await Deno.readTextFile(golden_url),
  );
  for (const path of new Set([...Object.keys(expected), ...paths])) {
    if (actual[path] !== expected[path]) {
      throw new Error(
        path +
          " output differs from scripts/examples.golden.json; inspect the behavior before running deno task examples:update",
      );
    }
  }
}
console.log(paths.length + " example outputs verified");
