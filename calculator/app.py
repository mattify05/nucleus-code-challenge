"""Calculator web app backend.

Serves the static frontend and exposes a single POST /calculate endpoint
that evaluates basic arithmetic expressions.

The expression is never passed to eval()/exec(). It's parsed into a Python
AST and walked manually, allowing only numeric literals and +, -, *, /, **
(and their unary +/- forms). Any other node type - a name lookup, a function
call, a string, an attribute access, and so on - is rejected before it can
run. That's what keeps something like "__import__('os').system('ls')" from
being a problem: ast.parse happily parses it (it's valid Python syntax), but
evaluate_node has no case for ast.Call, so it's rejected with a plain error
instead of executing.
"""
import ast
import operator

from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="")

MAX_EXPRESSION_LENGTH = 200

BINARY_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
}

UNARY_OPERATORS = {
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def evaluate_node(node):
    """Recursively evaluate one node of a parsed arithmetic expression."""
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise ValueError("Only numbers are allowed")
        return node.value

    if isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in BINARY_OPERATORS:
            raise ValueError("That operator isn't supported")
        left = evaluate_node(node.left)
        right = evaluate_node(node.right)
        if op_type is ast.Div and right == 0:
            raise ZeroDivisionError("Can't divide by zero")
        if op_type is ast.Pow and (abs(left) > 1e6 or abs(right) > 1000):
            raise OverflowError("That result is too large to calculate")
        return BINARY_OPERATORS[op_type](left, right)

    if isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in UNARY_OPERATORS:
            raise ValueError("That operator isn't supported")
        return UNARY_OPERATORS[op_type](evaluate_node(node.operand))

    raise ValueError("That expression isn't valid")


def evaluate_expression(expression):
    """Validate and evaluate a user-supplied arithmetic expression string."""
    if not expression or not expression.strip():
        raise ValueError("Enter an expression to calculate")
    if len(expression) > MAX_EXPRESSION_LENGTH:
        raise ValueError("Expression is too long")

    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        raise ValueError("That expression isn't valid")

    result = evaluate_node(tree.body)

    if isinstance(result, float):
        if result != result:  # NaN
            raise ValueError("That expression doesn't have a real result")
        if result in (float("inf"), float("-inf")):
            raise OverflowError("That result is too large to calculate")

    return result


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/calculate")
def calculate():
    data = request.get_json(silent=True)
    if not data or "expression" not in data:
        return jsonify(error="No expression provided"), 400

    expression = data["expression"]
    if not isinstance(expression, str):
        return jsonify(error="Expression must be text"), 400

    try:
        result = evaluate_expression(expression)
    except (ValueError, ZeroDivisionError, OverflowError, RecursionError) as exc:
        return jsonify(error=str(exc)), 400

    return jsonify(result=result)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
