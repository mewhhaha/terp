interface CpuTime {
  user: number;
  system: number;
}
// The built-in module needs no packages. Dynamic loading avoids pulling the
// unrelated @types/node package into this dependency-free Deno project.
const process_module: string = "node:process";
const { cpuUsage }: { cpuUsage(previous?: CpuTime): CpuTime } = await import(
  process_module
);

let sink: unknown;
/** Time batches with both wall and CPU clocks to expose host contention. */
export function sample(
  run: () => unknown,
  duration: number,
): { wall: number; cpu: number } {
  let count = 0;
  const cpu_start = cpuUsage();
  const start = performance.now();
  let elapsed = 0;
  let batch = 1;
  do {
    for (let index = 0; index < batch; index += 1) sink = run();
    count += batch;
    elapsed = performance.now() - start;
    // Keep slow completion/large-vocabulary cases from overshooting by 100x.
    batch = Math.min(
      100,
      Math.max(1, Math.floor(count / Math.max(elapsed, 0.001))),
    );
  } while (elapsed < duration);
  const cpu = cpuUsage(cpu_start);
  if (sink === Symbol.for("unreachable benchmark sink")) {
    throw new Error("unreachable");
  }
  return {
    wall: elapsed * 1e6 / count,
    cpu: (cpu.user + cpu.system) * 1000 / count,
  };
}

/** Report a middle sample instead of treating scheduler/GC outliers as a trend. */
export function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
