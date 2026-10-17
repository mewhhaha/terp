/** Hash exact source or workload bytes so benchmark comparisons stay auditable. */
export async function fingerprint(paths: readonly string[]): Promise<string> {
  let source = "";
  for (const path of paths) {
    source += path + "\n" + await Deno.readTextFile(path);
  }
  return await fingerprint_text(source);
}

/** Hash generated text without depending on a temporary filesystem path. */
export async function fingerprint_text(source: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Record the checkout revision in addition to the authoritative source digest. */
export async function revision(): Promise<string> {
  const result = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!result.success) return "snapshot";
  return new TextDecoder().decode(result.stdout).trim();
}

/** Files implementing the public API measured by both benchmark suites. */
export async function implementation_files(): Promise<string[]> {
  const paths = ["mod.ts"];
  for await (const entry of Deno.readDir("src")) {
    if (
      entry.isFile && entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") && entry.name !== "assert.ts"
    ) paths.push("src/" + entry.name);
  }
  return paths.sort();
}
