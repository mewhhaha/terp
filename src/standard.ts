import { type Interpreter, interpreter } from "./interpreter.ts";
import { standard_operators, type StandardOperators } from "./operators.ts";

/** Standard numeric, string, comparison, and short-circuit boolean language. */
export const terp: Interpreter<StandardOperators> = interpreter(
  standard_operators,
);
