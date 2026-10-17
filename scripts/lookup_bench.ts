import { median, sample } from "./measure.ts";
import { fingerprint } from "./provenance.ts";

const symbols = ["+", "-", "*", "/", "%", "<=", ">=", "==", "!=", "++"];
const words = [
  "add",
  "balance",
  "cost",
  "discount",
  "equal",
  "floor",
  "greater",
  "has",
  "include",
  "join",
  "keep",
  "less",
  "match",
  "not",
  "over",
  "price",
  "quote",
  "round",
  "sum",
  "times",
];
function tokens_for(size: number): string[] {
  const tokens = [...symbols];
  for (let index = 0; tokens.length < size; index += 1) {
    tokens.push(words[index % words.length] + Math.floor(index / words.length));
  }
  return tokens.sort((a, b) => b.length - a.length);
}
function buckets_for(
  tokens: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const buckets = new Map<string, string[]>();
  for (const token of tokens) {
    let bucket = buckets.get(token[0]);
    if (!bucket) {
      bucket = [];
      buckets.set(token[0], bucket);
    }
    bucket.push(token);
  }
  return buckets;
}
function lookup(tokens: readonly string[], text: string): string | undefined {
  for (const token of tokens) {
    if (!text.startsWith(token)) continue;
    if (
      /^[A-Za-z0-9_$]+$/.test(token) &&
      /^[A-Za-z0-9_$]/.test(text.slice(token.length))
    ) continue;
    return token;
  }
}
function measure(run: () => unknown): { wall_ns: number; cpu_ns: number } {
  sample(run, 100);
  const samples = Array.from({ length: 9 }, () => sample(run, 50));
  return {
    wall_ns: median(samples.map((s) => s.wall)),
    cpu_ns: median(samples.map((s) => s.cpu)),
  };
}

const cases = [];
for (const size of [10, 100, 1000]) {
  const tokens = tokens_for(size);
  const buckets = buckets_for(tokens);
  const probes = [
    tokens[0] + " 42",
    tokens[Math.floor(size / 2)] + " 42",
    tokens[size - 1] + " 42",
    "?amount",
    "123",
    "unknown",
    "(",
    "+ 1",
    "addendum",
  ];
  let index = 0;
  const linear = () => {
    const text = probes[index++ % probes.length];
    return lookup(tokens, text);
  };
  const bucketed = () => {
    const text = probes[index++ % probes.length];
    return lookup(buckets.get(text[0]) ?? [], text);
  };
  for (const text of probes) {
    if (lookup(tokens, text) !== lookup(buckets.get(text[0]) ?? [], text)) {
      throw new Error("lookup implementations disagree");
    }
  }
  const build = measure(() => buckets_for(tokens));
  const before = measure(linear);
  const after = measure(bucketed);
  const saved = before.cpu_ns - after.cpu_ns;
  let break_even_probes: number | null = null;
  if (saved > 0) break_even_probes = Math.ceil(build.cpu_ns / saved);
  cases.push({
    tokens: size,
    linear: before,
    bucketed: after,
    build,
    break_even_probes,
  });
  console.log(
    size,
    "tokens:",
    "linear CPU",
    before.cpu_ns.toFixed(0),
    "ns; bucketed",
    after.cpu_ns.toFixed(0),
    "ns; build",
    build.cpu_ns.toFixed(0),
    "ns; break-even",
    break_even_probes,
    "probes",
  );
}
if (Deno.args[0]) {
  await Deno.writeTextFile(
    Deno.args[0],
    JSON.stringify(
      {
        version: Deno.version,
        target: Deno.build.target,
        probes: "mixed matches, misses, word prefixes, and common symbols",
        workload_sha256: await fingerprint([
          "scripts/lookup_bench.ts",
          "scripts/measure.ts",
        ]),
        cases,
      },
      null,
      2,
    ) + "\n",
  );
}
