// Run: deno run --v8-flags=--expose-gc bench/experiments/retained.ts
import { interpreter, number_operator } from "../../core.ts";
const collect = (globalThis as unknown as { gc?: () => void }).gc;
if (collect === undefined) throw new Error("pass --v8-flags=--expose-gc");
const gc: () => void = collect;
const operators = { "+": number_operator(6, "left", (a, b) => a + b) };
const languages = Array.from({ length: 20 }, () => interpreter(operators));
const memory = () => {
  gc();
  gc();
  return Deno.memoryUsage().heapUsed;
};
const empty = memory();
let source = "?0";
while (source.length * 2 + 5 <= 1024) {
  source = "(" + source + " + " + source + ")";
}
for (const language of languages) {
  const runner = (language as (source: string, value: number) => unknown)(
    source,
    4,
  );
  if (runner instanceof Error) throw runner;
}
const large = memory();
for (const language of languages) {
  for (let i = 0; i < 256; i++) {
    const runner = (language as (source: string, value: number) => unknown)(
      "?0 + " + i,
      4,
    );
    if (runner instanceof Error) throw runner;
  }
}
const replaced = memory();
console.log(JSON.stringify(
  {
    interpreters: languages.length,
    sourceCharacters: source.length,
    emptyBytes: empty,
    populatedBytes: large,
    replacedBytes: replaced,
    perInterpreterPopulatedBytes: (large - empty) / languages.length,
    perInterpreterReplacedBytes: (replaced - empty) / languages.length,
    observable: languages[0].raw("?0 + 255") instanceof Function,
  },
  null,
  2,
));
