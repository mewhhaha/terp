import { interpreter, op } from "../mod.ts";

const pricing = interpreter({
  plus: op("infixl 6 ?", (left: number, right: number) => left + right),
  minus: op("infixl 6 ?", (left: number, right: number) => left - right),
  times: op("infixl 7 ?", (left: number, right: number) => left * right),
  over: op("infixl 7 ?", (left: number, right: number) => left / right),
  pct: op("prefix 8 ?", (value: number) => value / 100),
});

const quote = {
  base: 5_000,
  seats: 12,
  seat_price: 75,
  discount: 10,
};

const monthly_expression =
  "(?base plus ?seats times ?seat_price) times (1 minus pct ?discount)";
const seat_share_expression =
  "?seats times ?seat_price over (?base plus ?seats times ?seat_price)";

const monthly = pricing(monthly_expression, quote);
const seat_share = pricing(seat_share_expression, quote);

console.log("pricing", {
  monthly,
  seat_share,
});
