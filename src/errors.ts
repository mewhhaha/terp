/** Character offsets in the original expression (end is exclusive). */
export interface SourceSpan {
  /** Zero-based character offset. */
  readonly start: number;
  /** Exclusive end offset. */
  readonly end: number;
}

/** Stable categories for syntax, binding, application, and composition errors. */
export type InterpreterErrorCode =
  | "syntax"
  | "unknown_value"
  | "arguments"
  | "operator"
  | "function"
  | "fragment"
  | "limit"
  | "validation";

const implicit_cause = Symbol("syntax cause");

/** An expression failure with its original cause and source location. */
export class InterpreterError extends TypeError {
  /** Short description, without a redundant interpreter prefix. */
  readonly summary: string;
  /** Machine-readable failure category. */
  readonly code: InterpreterErrorCode;
  /** Original expression, when available. */
  readonly source: string;
  /** Offending source range, when available. */
  readonly span?: SourceSpan;
  /** Underlying failures retained for compatibility and inspection. */
  get errors(): readonly Error[] {
    if (this.#errors === undefined) {
      const cause = this.cause;
      this.#errors = [];
      if (cause instanceof Error) this.#errors = [cause];
    }
    return this.#errors;
  }
  /** Original thrown value. */
  override get cause(): unknown {
    if (this.#cause === implicit_cause) {
      this.#cause = new TypeError(this.message);
    }
    return this.#cause;
  }
  #cause: unknown;
  #errors: readonly Error[] | undefined;

  /** Construct a located error while retaining the original failure. */
  constructor(summary: string, options: {
    readonly code?: InterpreterErrorCode;
    readonly source?: string;
    readonly span?: SourceSpan;
    readonly cause?: unknown;
    readonly errors?: readonly Error[];
  } = {}) {
    super(summary);
    this.name = "InterpreterError";
    this.summary = summary.replace(/^interpreter\s+/, "");
    this.code = options.code ?? "syntax";
    this.source = options.source ?? "";
    if (options.span !== undefined) {
      this.span = Object.freeze({
        start: options.span.start,
        end: options.span.end,
      });
    }
    this.#cause = options.cause;
    this.#errors = options.errors;
  }
}

export function failure(
  code: InterpreterErrorCode,
  message: string,
  source = "",
  span?: SourceSpan,
  cause: unknown = implicit_cause,
): InterpreterError {
  return new InterpreterError(message, { code, source, span, cause });
}

export function caught(error: unknown): InterpreterError {
  if (error instanceof InterpreterError) return error;
  if (error instanceof Error) {
    return failure("syntax", error.message, "", undefined, error);
  }
  return failure("syntax", String(error), "", undefined, error);
}
