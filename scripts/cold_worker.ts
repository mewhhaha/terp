// Each invocation imports the public module into a fresh process and module map.
const module_url = Deno.args[0];
const process_module: string = "node:process";
const { cpuUsage } = await import(process_module);
const cpu = cpuUsage();
const start = performance.now();
const api = await import(module_url);
const imported = performance.now();
let terp = api.terp;
if (terp === undefined) {
  terp = api.interpreter({
    "+": api.number_operator(6, "left", (a: number, b: number) => a + b),
    "*": api.number_operator(7, "left", (a: number, b: number) => a * b),
  });
}
const parse_start = performance.now();
const run = terp.raw("?0 + ?1 * 3");
const parsed = performance.now();
if (run instanceof Error || run(4, 5) !== 19) {
  throw new Error("first-use result");
}
const executed = performance.now();
const usage = cpuUsage(cpu);
console.log(
  JSON.stringify({
    import_ms: imported - start,
    initialize_ms: parse_start - imported,
    first_parse_ms: parsed - parse_start,
    first_run_ms: executed - parsed,
    first_use_cpu_us: usage.user + usage.system,
  }),
);
