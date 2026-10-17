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
  try {
    await Deno.stat("core.ts");
    paths.push("core.ts");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  for await (const entry of Deno.readDir("src")) {
    if (
      entry.isFile && entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") && entry.name !== "assert.ts"
    ) paths.push("src/" + entry.name);
  }
  return paths.sort();
}

/** Record host identity and scheduler state alongside wall and CPU clocks. */
export async function host(): Promise<Record<string, unknown>> {
  // Deno treats /proc reads as --allow-all; a narrowly permitted cat preserves
  // restricted benchmark permissions and records the inherited scheduling state.
  async function proc(path: string): Promise<string> {
    if (Deno.build.os !== "linux") return "";
    const result = await new Deno.Command("cat", {
      args: [path],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!result.success) {
      throw new Error("cannot record host metadata: " + path);
    }
    return new TextDecoder().decode(result.stdout);
  }
  const cpuinfo = await proc("/proc/cpuinfo");
  const status = await proc("/proc/self/status");
  return {
    hostname: Deno.hostname(),
    os_release: Deno.osRelease(),
    cpu: /^model name\s*:\s*(.+)$/m.exec(cpuinfo)?.[1] ?? "unknown",
    logical_cpus: navigator.hardwareConcurrency,
    cpu_affinity: /^Cpus_allowed_list:\s*(.+)$/m.exec(status)?.[1] ?? "unknown",
    scheduling_policy: await proc("/proc/self/sched").then((
      text,
    ) => /^policy\s*:\s*(.+)$/m.exec(text)?.[1]).catch(() => undefined),
  };
}
