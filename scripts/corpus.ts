/** Independent expression trees: generation and evaluation never parse source. */
export type Tree =
  | { kind: "literal"; value: number }
  | { kind: "argument"; index: 0 | 1 }
  | { kind: "negate"; value: Tree }
  | { kind: "binary"; token: "+" | "-" | "*"; left: Tree; right: Tree };

export function corpus(count = 96): Tree[] {
  let state = 0x5eed1234;
  function next(limit: number): number {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  }
  function tree(depth: number): Tree {
    if (depth === 0) {
      if (next(3) === 0) return { kind: "argument", index: next(2) as 0 | 1 };
      return { kind: "literal", value: next(10) };
    }
    if (next(4) === 0) return { kind: "negate", value: tree(depth - 1) };
    return {
      kind: "binary",
      token: ["+", "-", "*"][next(3)] as "+" | "-" | "*",
      left: tree(depth - 1),
      right: tree(depth - 1),
    };
  }
  return Array.from({ length: count }, (_, index) => ({
    kind: "binary",
    token: "+",
    left: {
      kind: "binary",
      token: "+",
      left: { kind: "argument", index: 0 },
      right: { kind: "argument", index: 1 },
    },
    right: tree(1 + index % 3),
  }));
}

export function source(tree: Tree): string {
  switch (tree.kind) {
    case "literal":
      return String(tree.value);
    case "argument":
      return "?" + tree.index;
    case "negate":
      return "(-" + source(tree.value) + ")";
    case "binary":
      return "(" + source(tree.left) + " " + tree.token + " " +
        source(tree.right) + ")";
  }
}

export function evaluate(
  tree: Tree,
  args: readonly number[],
  trace: string[] = [],
): number {
  switch (tree.kind) {
    case "literal":
      return tree.value;
    case "argument":
      return args[tree.index];
    case "negate": {
      const result = -evaluate(tree.value, args, trace);
      trace.push("negate");
      return result;
    }
    case "binary": {
      const left = evaluate(tree.left, args, trace);
      const right = evaluate(tree.right, args, trace);
      trace.push(tree.token);
      switch (tree.token) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
      }
    }
  }
}

export function invalid_mutations(expression: string): string[] {
  return [
    ")" + expression,
    expression + "(",
    expression + " +",
    expression + " ?0",
    expression + " + 'unterminated",
  ];
}
