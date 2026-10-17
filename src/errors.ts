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
  readonly errors: readonly Error[];
  /** Original thrown value. */
  override readonly cause: unknown;

  /** Construct a located error while retaining the original failure. */
  constructor(summary: string, options: {
    readonly code?: InterpreterErrorCode;
    readonly source?: string;
    readonly span?: SourceSpan;
    readonly cause?: unknown;
    readonly errors?: readonly Error[];
  } = {}) {
    super(summary, { cause: options.cause });
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
    this.cause = options.cause;
    this.errors = options.errors ?? [];
    if (options.errors === undefined && options.cause instanceof Error) {
      this.errors = [options.cause];
    }
  }
}

export function failure(
  code: InterpreterErrorCode,
  message: string,
  source = "",
  span?: SourceSpan,
  cause: unknown = new TypeError(message),
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
