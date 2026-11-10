// A small arithmetic grammar. Never evaluate JavaScript or model-generated code.
export function calculate(expression: string): number {
  const tokens =
    expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[()+\-*/%]/gi) ||
    [];
  if (tokens.join("") !== expression.replace(/\s/g, "") || tokens.length > 200)
    throw Error("Use numbers, parentheses and + - * / % only.");
  let i = 0;
  function atom(): number {
    const token = tokens[i++];
    if (token === "+") return atom();
    if (token === "-") return -atom();
    if (token === "(") {
      const n = sum();
      if (tokens[i++] !== ")") throw Error("Close each parenthesis.");
      return n;
    }
    if (!token || !/^[\d.]/.test(token)) throw Error("Expected a number.");
    return Number(token);
  }
  function product(): number {
    let n = atom();
    while (["*", "/", "%"].includes(tokens[i])) {
      const op = tokens[i++],
        b = atom();
      n = op === "*" ? n * b : op === "/" ? n / b : n % b;
    }
    return n;
  }
  function sum(): number {
    let n = product();
    while (["+", "-"].includes(tokens[i])) {
      const op = tokens[i++],
        b = product();
      n = op === "+" ? n + b : n - b;
    }
    return n;
  }
  const result = sum();
  if (i !== tokens.length || !Number.isFinite(result))
    throw Error("Expression is incomplete or has a non-finite result.");
  return result;
}
