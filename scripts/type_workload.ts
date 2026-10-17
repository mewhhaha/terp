import { corpus, invalid_mutations, source } from "./corpus.ts";

/** Generate the same literal corpus used by runtime differential verification. */
export function type_workload(module_url: string): string {
  const lines = ["import { terp } from " + JSON.stringify(module_url) + ";"];
  for (const [index, tree] of corpus(24).entries()) {
    const expression = source(tree);
    lines.push(
      "const result" + index + ": number = terp(" + JSON.stringify(expression) +
        ", 7, 3);",
    );
    for (const invalid of invalid_mutations(expression).slice(0, 3)) {
      lines.push("// @ts-expect-error generated syntax must be rejected");
      lines.push(
        "const rejected" + index + "_" + lines.length + ": number = terp(" +
          JSON.stringify(invalid) + ", 7, 3);",
      );
    }
  }
  lines.push(
    'const named: number = terp("?amount * (1 - ?discount)", { amount: 100, discount: 0.2 });',
  );
  lines.push('const repeated: number = terp("?0 + ?0 * ?1", 4, 5);');
  lines.push('const sequential: number = terp("? + ? * ?", 4, 5, 6);');
  return lines.join("\n") + "\n";
}
