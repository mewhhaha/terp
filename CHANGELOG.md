# Changelog

All notable changes to this package will be documented in this file.

## 0.4.0 - 2026-10-17

- Replaced repeated runtime parsing with compiled expression trees and bounded,
  precedence-aware literal type analysis. Fixed optional/rest calls, grouped
  arguments, literal results, and placeholder binding consistency.
- Snapshot interpreter vocabulary; enforce own callable properties and word
  boundaries; validate syntax and arguments before callbacks execute.
- Added located errors with stable codes and preserved causes, lazy boolean
  operators, typed independent fragment composition, checked runtime boundaries,
  single-execution traces, and vocabulary completion.
- Simplified operator declarations, made dynamic declarations explicit with
  `op.raw`, and reduced the public export surface. Custom hooks now yield
  `unknown` results. Source fragments group their text; structural combinations
  retain independent arguments and execute through `run` or further `combine`.
- Added generated conformance, asserted example outputs, reproducible CPU/wall
  benchmarks, and a type-checking budget. CI checks each test graph once.

- Added typed named-placeholder scopes: literal expressions now infer the scope
  object with one required key per named placeholder, each adopting the operand
  type expected by its operator.
- Fixed positional `?` placeholders colliding with indexed placeholder slots.
  Positional placeholders now read the slots after the highest indexed
  placeholder, matching the inferred argument tuple, so `? + ?0` works with two
  values.
- Fixed type-level placeholder inference degrading to `unknown[]` when a
  registered operator token is a prefix of another (for example `+` and `++`).
- Fixed the type level accepting expressions with empty operands, such as
  trailing binary operators (`"1 +"`); these are now compile-time errors.
- Fixed conflicting placeholder reuse across primitive operand types widening to
  `unknown` instead of rejecting the value.
- Registries typed as plain `Record<string, ...>` (no literal tokens) now skip
  literal type checking instead of failing it.
- Cached the sorted operator token list per registry to avoid re-sorting on
  every token read.
- Unified the internal reference scanners for placeholders and callable words.
- Added typed operand and result generics to operator definitions.
- Added typed placeholder arguments for literal expressions, indexed
  placeholders, and chains.
- Added type-level checks for known operands in literal expressions.
- Fixed grouped literal subexpressions so parentheses force type-level
  placeholder inference.
- Added validated expression fragments and `raw` tagged-template composition.
- Added feature flag, form validation, and applicative parser example DSLs.
- Hardened named placeholders and operator lookup to ignore inherited prototype
  properties.
- Hardened runtime operator registry validation for malformed definitions and
  empty overload sets.
- Fixed grouped expression parsing when string literals contain parentheses.

## 0.1.0 - 2026-07-05

- Initial release of the typed expression interpreter.
- Added the default `terp` interpreter and helpers for custom operator tables.
- Added interpreter-level named values for DSL constants and functions.
- Added standard numeric, equality, ordering, and boolean operators.
