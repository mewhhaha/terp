import { interpreter, op } from "../mod.ts";

type ParseResult<value> =
  | {
    readonly ok: true;
    readonly value: value;
    readonly rest: string;
  }
  | {
    readonly ok: false;
    readonly expected: string;
    readonly rest: string;
  };

const parser_tag = Symbol("terp.parser");

type Parser<value> = {
  (input: string): ParseResult<value>;
  readonly label: string;
  readonly [parser_tag]: true;
};

type Mapper<value = unknown, result = unknown> = (value: value) => result;

const digit = regex_parser("digit", /^[0-9]/);
const letter = regex_parser("letter", /^[A-Za-z]/);
const integer = text_algebra((digits) => Number(digits.join("")))(
  "convert <$> some digit",
);
const word = text_algebra((letters) => letters.join(""))(
  "convert <$> some letter",
);
const coordinate = record_algebra(
  (x: number) => (y: number) => ({ x, y }),
  integer,
  literal(","),
  integer,
)("construct <$> first <* separator <*> second");
const tag = record_algebra(
  (name: string) => (id: number) => ({ name, id }),
  word,
  literal("-"),
  integer,
)("construct <$> first <* separator <*> second");
const choices = interpreter({
  "<|>": op(
    "infixr 2 ?",
    (left: Parser<number>, right: Parser<string>) => alternative(left, right),
  ),
}, { values: { integer, word } });
const number_or_word = choices("integer <|> word");

console.log("applicative-parser", {
  integer: integer("123px"),
  coordinate: coordinate("12,34!"),
  tag: tag("alpha-42 "),
  fallback: number_or_word("hello123"),
});

// Each small algebra fixes its operand types while sharing generic combinators.
function text_algebra<value>(convert: Mapper<readonly string[], value>) {
  return interpreter({
    "<$>": op(
      "infixl 5 ?",
      (
        fn: Mapper<readonly string[], value>,
        parser: Parser<readonly string[]>,
      ) => map(parser, fn),
    ),
    many: op("prefix 8 ?", (parser: Parser<string>) => many(parser)),
    some: op("prefix 8 ?", (parser: Parser<string>) => some(parser)),
  }, { values: { convert, digit, letter } });
}

function record_algebra<first, second, result>(
  construct: Mapper<first, Mapper<second, result>>,
  first: Parser<first>,
  separator: Parser<string>,
  second: Parser<second>,
) {
  return interpreter({
    "<$>": op(
      "infixl 5 ?",
      (fn: Mapper<first, Mapper<second, result>>, parser: Parser<first>) =>
        map(parser, fn),
    ),
    "<*": op(
      "infixl 5 ?",
      (left: Parser<Mapper<second, result>>, right: Parser<string>) =>
        keep_left(left, right),
    ),
    "<*>": op(
      "infixl 5 ?",
      (left: Parser<Mapper<second, result>>, right: Parser<second>) =>
        apply_parser(left, right),
    ),
  }, { values: { construct, first, separator, second } });
}

const expect_parser_types = () => {
  const integer_parser: Parser<number> = integer;
  const word_parser: Parser<string> = word;
  const coordinate_parser: Parser<{ x: number; y: number }> = coordinate;
  const tag_parser: Parser<{ name: string; id: number }> = tag;
  const choice_parser: Parser<number | string> = number_or_word;
  // @ts-expect-error The expression yields numeric values.
  const wrong_result: Parser<string> = integer;
  // @ts-expect-error This alternative expects a numeric parser on the left.
  choices("word <|> integer");
  // @ts-expect-error Mapping requires a mapper on the left, not a parser.
  text_algebra((parts) => parts.join(""))("digit <$> some letter");
  void integer_parser;
  void word_parser;
  void coordinate_parser;
  void tag_parser;
  void choice_parser;
  void wrong_result;
};
void expect_parser_types;

function map<left, right>(
  parser: Parser<left>,
  fn: (value: left) => right,
): Parser<right> {
  check_parser(parser);
  if (typeof fn !== "function") {
    throw new TypeError("map expected a function");
  }
  return make_parser("(" + parser.label + " mapped)", (input) => {
    const result = parser(input);

    if (!result.ok) {
      return result;
    }

    return success(fn(result.value), result.rest);
  });
}

function apply_parser<left, right>(
  fn_parser: Parser<(value: left) => right>,
  value_parser: Parser<left>,
): Parser<right> {
  check_parser(fn_parser);
  check_parser(value_parser);
  return make_parser(
    "(" + fn_parser.label + " <*> " + value_parser.label + ")",
    (input) => {
      const fn_result = fn_parser(input);

      if (!fn_result.ok) {
        return fn_result;
      }

      if (typeof fn_result.value !== "function") {
        return failure("function", fn_result.rest);
      }

      const value_result = value_parser(fn_result.rest);

      if (!value_result.ok) {
        return value_result;
      }

      return success(fn_result.value(value_result.value), value_result.rest);
    },
  );
}

function keep_left<left>(
  left_parser: Parser<left>,
  right_parser: Parser<unknown>,
): Parser<left> {
  check_parser(left_parser);
  check_parser(right_parser);
  return make_parser(
    "(" + left_parser.label + " <* " + right_parser.label + ")",
    (input) => {
      const left_result = left_parser(input);

      if (!left_result.ok) {
        return left_result;
      }

      const right_result = right_parser(left_result.rest);

      if (!right_result.ok) {
        return right_result;
      }

      return success(left_result.value, right_result.rest);
    },
  );
}

function alternative<left, right>(
  left_parser: Parser<left>,
  right_parser: Parser<right>,
): Parser<left | right> {
  check_parser(left_parser);
  check_parser(right_parser);
  return make_parser<left | right>(
    "(" + left_parser.label + " <|> " + right_parser.label + ")",
    (input) => {
      const left_result = left_parser(input);

      if (left_result.ok) {
        return left_result;
      }

      const right_result = right_parser(input);

      if (right_result.ok) {
        return right_result;
      }

      return failure(
        left_result.expected + " or " + right_result.expected,
        input,
      );
    },
  );
}

function many<value>(parser: Parser<value>): Parser<readonly value[]> {
  check_parser(parser);
  return make_parser("many " + parser.label, (input) => {
    const values: value[] = [];
    let rest = input;

    while (true) {
      const result = parser(rest);

      if (!result.ok) {
        return success(values, rest);
      }

      if (result.rest === rest) {
        throw new TypeError("many parser must consume input");
      }

      values.push(result.value);
      rest = result.rest;
    }
  });
}

function some<value>(parser: Parser<value>): Parser<readonly value[]> {
  const tail = many(parser);
  return make_parser("some " + parser.label, (input) => {
    const first = parser(input);

    if (!first.ok) {
      return first;
    }

    const rest = tail(first.rest);

    if (!rest.ok) {
      return rest;
    }

    return success([first.value, ...rest.value], rest.rest);
  });
}

function literal(expected: string): Parser<string> {
  return make_parser(JSON.stringify(expected), (input) => {
    if (input.startsWith(expected)) {
      return success(expected, input.slice(expected.length));
    }
    return failure(JSON.stringify(expected), input);
  });
}

function regex_parser(label: string, regex: RegExp): Parser<string> {
  return make_parser(label, (input) => {
    const match = regex.exec(input);

    if (match !== null && match.index === 0) {
      return success(match[0], input.slice(match[0].length));
    }
    return failure(label, input);
  });
}

function make_parser<value>(
  label: string,
  parse: (input: string) => ParseResult<value>,
): Parser<value> {
  const parser = ((input: string) => parse(input)) as Parser<value>;

  Object.defineProperty(parser, parser_tag, { value: true });
  Object.defineProperty(parser, "label", { value: label });

  return parser;
}

function success<value>(value: value, rest: string): ParseResult<value> {
  return { ok: true, value, rest };
}

function failure(expected: string, rest: string): ParseResult<never> {
  return { ok: false, expected, rest };
}

function check_parser(value: unknown): void {
  if (
    typeof value !== "function" ||
    (value as Partial<Parser<unknown>>)[parser_tag] !== true
  ) {
    throw new TypeError("expected parser value");
  }
}
