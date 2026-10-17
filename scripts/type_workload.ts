import { corpus, invalid_mutations, source } from "./corpus.ts";

export type TypeWorkload = "combined" | "valid" | "invalid" | "placeholders";

/** The default retains the original combined workload byte for byte. */
export function type_workload(
  module_url: string,
  category: TypeWorkload = "combined",
): string {
  const lines = ["import { terp } from " + JSON.stringify(module_url) + ";"];
  if (category === "placeholders") {
    placeholder_workload(lines);
    return lines.join("\n") + "\n";
  }
  for (const [index, tree] of corpus(24).entries()) {
    const expression = source(tree);
    if (category !== "invalid") {
      lines.push(
        "const result" + index + ": number = terp(" +
          JSON.stringify(expression) +
          ", 7, 3);",
      );
    }
    if (category === "valid") continue;
    for (const invalid of invalid_mutations(expression).slice(0, 3)) {
      lines.push("// @ts-expect-error generated syntax must be rejected");
      lines.push(
        "const rejected" + index + "_" + lines.length + ": number = terp(" +
          JSON.stringify(invalid) + ", 7, 3);",
      );
    }
  }
  if (category !== "combined") return lines.join("\n") + "\n";
  lines.push(
    'const named: number = terp("?amount * (1 - ?discount)", { amount: 100, discount: 0.2 });',
  );
  lines.push('const repeated: number = terp("?0 + ?0 * ?1", 4, 5);');
  lines.push('const sequential: number = terp("? + ? * ?", 4, 5, 6);');
  return lines.join("\n") + "\n";
}

function placeholder_workload(lines: string[]): void {
  for (const width of [4, 8, 16, 32]) {
    const anonymous = Array.from({ length: width }, () => "?").join(" + ");
    const values = Array.from({ length: width }, () => "1").join(", ");
    lines.push(
      `const anonymous${width}: number = terp(${
        JSON.stringify(anonymous)
      }, ${values});`,
    );
    const named = Array.from({ length: width }, () => "?value").join(" + ");
    lines.push(
      `const repeated${width}: number = terp(${
        JSON.stringify(named)
      }, { value: 1 });`,
    );
    const distinct = Array.from({ length: width }, (_, index) => "?v" + index)
      .join(" + ");
    const scope = Array.from(
      { length: width },
      (_, index) => "v" + index + ": 1",
    ).join(", ");
    lines.push(
      `const named${width}: number = terp(${
        JSON.stringify(distinct)
      }, { ${scope} });`,
    );
  }
  for (const index of [1, 10, 50, 99]) {
    const values = Array.from({ length: index + 1 }, () => "1").join(", ");
    lines.push(
      `const sparse${index}: number = terp("?${index} + ?${index}", ${values});`,
    );
  }
}
