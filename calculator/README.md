# Calculator

A small calculator web app: a vanilla HTML/CSS/JS frontend, and a Flask
backend that does the actual arithmetic.

## Run it

```
pip install flask
python app.py
```

Then open http://127.0.0.1:5000 in a browser.

## How it works

The frontend builds up an expression string as you press keys (digits,
`+ - × ÷`, parentheses, decimal point) and shows it live. Pressing `=` (or
Enter) sends that string to `POST /calculate` as JSON, e.g.
`{"expression": "2+2*3"}`, and the backend returns `{"result": 8}` or
`{"error": "..."}`.

**The backend never calls `eval()` on the expression.** It parses the
string into a Python AST (`ast.parse(expr, mode="eval")`) and walks the
tree itself, only ever evaluating numeric literals and `+ - * / **`
(including their unary forms). Anything else in the tree - a function call,
a name lookup, a string, an import - has no matching case in the walker and
is rejected with a plain "that expression isn't valid" error. So something
like `__import__('os').system('rm -rf /')` parses fine as Python syntax,
but never executes: it just gets rejected the same as any other
unsupported expression. This was deliberately tested, see below.

Other things the backend guards against: division by zero, expressions
over 200 characters, exponents large enough to be a resource-exhaustion
risk (`2**99999`), non-numeric constants (strings, booleans, lists), and
malformed or missing JSON in the request body. All of these return a 400
with a plain-language error message rather than a stack trace.

## What I tested

- Correctness: operator precedence, parentheses, negative numbers,
  exponents, decimals, floating-point division.
- Errors: division by zero, empty input, incomplete expressions, wrong
  types, oversized input, malformed JSON, missing fields.
- Security: the `__import__`/`os.system` style injection attempt above,
  plus `open(...).read()`, bare name lookups, and boolean/list literals.
  All rejected without executing anything.
- The full HTTP path end to end (not just the Python function in
  isolation): started the Flask server and hit `/`, `/style.css`,
  `/script.js`, and `/calculate` with curl for each case above.
- The frontend's input-shaping logic (preventing "05", allowing ".5" to
  display as "0.5", ignoring a duplicate decimal point) extracted and
  tested standalone in Node, independent of the DOM.

## Known limitations / what I'd add with more time

- No keyboard-only operation indicator / screen-reader announcements
  beyond `aria-live` on the expression line.
- No calculation history.
- No percent (`%`) key - left out deliberately to avoid an ambiguous
  implementation (percent-of-current-value vs. modulo) within scope.
- The exponent-size guard (`abs(exponent) > 1000`) is a blunt instrument;
  a production version would check intermediate result magnitude on every
  operation, not just at the `**` step, since a long chain of ordinary
  multiplications can also produce an unreasonably large number.
