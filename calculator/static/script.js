const expressionEl = document.getElementById("expression");
const resultEl = document.getElementById("result");

const DISPLAY_SYMBOLS = { "*": "×", "/": "÷", "-": "−" };

let expression = "";
let lastEvaluated = "";
let isError = false;

function toDisplay(expr) {
  return expr.replace(/[*/-]/g, (match) => DISPLAY_SYMBOLS[match]);
}

function getCurrentNumberSegment(expr) {
  const match = expr.match(/(\d*\.?\d*)$/);
  return match ? match[0] : "";
}

function renderDisplay() {
  expressionEl.textContent = lastEvaluated;
  resultEl.textContent = isError ? expression : toDisplay(expression) || "0";
  resultEl.classList.toggle("result--error", isError);
}

function appendValue(value) {
  if (isError) {
    expression = "";
    isError = false;
  }
  lastEvaluated = "";

  const isDigit = /^[0-9]$/.test(value);
  if (isDigit) {
    const segment = getCurrentNumberSegment(expression);
    if (segment === "0") {
      // Replace a lone leading zero instead of producing "05".
      expression = expression.slice(0, -1) + value;
      renderDisplay();
      return;
    }
  }

  if (value === ".") {
    const segment = getCurrentNumberSegment(expression);
    if (segment.includes(".")) {
      return; // ignore a second decimal point in the same number
    }
    if (segment === "") {
      expression += "0"; // show "0.5" rather than ".5"
    }
  }

  expression += value;
  renderDisplay();
}

function clearAll() {
  expression = "";
  lastEvaluated = "";
  isError = false;
  renderDisplay();
}

function backspace() {
  if (isError) {
    clearAll();
    return;
  }
  expression = expression.slice(0, -1);
  renderDisplay();
}

function formatResult(value) {
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded);
}

async function calculate() {
  if (!expression.trim()) return;

  try {
    const response = await fetch("/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expression }),
    });
    const data = await response.json();

    if (!response.ok) {
      isError = true;
      lastEvaluated = "";
      expression = data.error || "Couldn't calculate that";
      renderDisplay();
      return;
    }

    lastEvaluated = `${toDisplay(expression)} =`;
    expression = formatResult(data.result);
    isError = false;
    renderDisplay();
  } catch (networkError) {
    isError = true;
    lastEvaluated = "";
    expression = "Couldn't reach the calculator service";
    renderDisplay();
  }
}

document.querySelectorAll("[data-digit]").forEach((button) => {
  button.addEventListener("click", () => appendValue(button.dataset.digit));
});

document.querySelectorAll("[data-operator]").forEach((button) => {
  button.addEventListener("click", () => appendValue(button.dataset.operator));
});

document.querySelector('[data-action="clear"]').addEventListener("click", clearAll);
document.querySelector('[data-action="backspace"]').addEventListener("click", backspace);
document.querySelector('[data-action="paren-open"]').addEventListener("click", () => appendValue("("));
document.querySelector('[data-action="paren-close"]').addEventListener("click", () => appendValue(")"));
document.querySelector('[data-action="equals"]').addEventListener("click", calculate);

window.addEventListener("keydown", (event) => {
  if (/^[0-9.()]$/.test(event.key)) {
    appendValue(event.key);
  } else if (["+", "-", "*", "/"].includes(event.key)) {
    appendValue(event.key);
  } else if (event.key === "Enter" || event.key === "=") {
    event.preventDefault();
    calculate();
  } else if (event.key === "Backspace") {
    backspace();
  } else if (event.key === "Escape") {
    clearAll();
  }
});

clearAll();
