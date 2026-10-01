# Engineering Intern Interview Questions

## Introduction

Thank you for your interest in the Nucleus Security Engineering
internship program! This document contains 2 primary interview
challenges for you. The first is a code review question, and the second
is a coding challenge.

For both, we absolutely encourage the use of AI. If you do use AI, we
would like for you to share your prompts and then answer the follow-up
questions about how you thought through your prompts.

We know this time of the year is crazy for college students and that
your time is very valuable. Please try not to spend more than about 1
total hour collectively on this.

------------------------------------------------------------------------

## Contents

-   Introduction
-   Code Review (10 minutes)
    -   Task
    -   PHP
    -   Python
    -   Code comments
    -   Follow-up Questions
-   Coding Challenge (\~50 minutes)
    -   Exercise
    -   Follow-up questions
-   Delivery

------------------------------------------------------------------------

# Code Review (10 minutes)

You are welcome and encouraged to use AI for this section. If you do,
please provide your prompts and answer the questions in the follow-up
section.

## Task

Your colleague or team member was given the following task:

1.  Add a `/webhook` endpoint to receive vendor events about users who
    are vendors.

2.  Input data will look like:

    ``` json
    {"email":"a@b.com","role":"admin","metadata":{"source":"vendor"}}
    ```

3.  Verify signature header `X-Signature`.

4.  Parse JSON and upsert the user data.

5.  Store the raw payload for audit/debug.

They have opened a PR with the code below. Review the code and comment
on any issues you find.

**Note:** Both the PHP and Python do the same thing. You can choose to
review whichever one you want. It is not intended for you to review
both.

------------------------------------------------------------------------

## PHP

``` php
<?php
// webhook.php
require_once "db.php"; // provides $pdo (PDO instance)

// Config (dev defaults)
$WEBHOOK_SECRET = getenv("WEBHOOK_SECRET") ?: "dev-secret";
$DB_AUDIT_ENABLED = getenv("AUDIT_ENABLED") ?: "true";

function verify_signature($sig, $body, $secret) {
    // Vendor docs: SHA256(secret + body)
    $expected = hash("sha256", $secret . $body);
    return $expected == $sig; // simple compare
}

$method = $_SERVER["REQUEST_METHOD"] ?? "GET";
$path = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);

// Basic routing
if ($method !== "POST" || $path !== "/webhook") {
    http_response_code(404);
    echo "not found";
    exit;
}

$raw = file_get_contents("php://input"); // raw body string
$sig = $_SERVER["HTTP_X_SIGNATURE"] ?? "";

if (!verify_signature($sig, $raw, $WEBHOOK_SECRET)) {
    http_response_code(401);
    echo "bad sig";
    exit;
}

// Decode JSON
$payload = json_decode($raw, true);
$email = $payload["email"] ?? "";
$role = $payload["role"] ?? "user";

// Store raw payload for auditing / debugging
if ($DB_AUDIT_ENABLED) {
    $pdo->exec("INSERT INTO webhook_audit(email, raw_json) VALUES ('$email', '$raw')");
}

// Upsert user (simple)
$pdo->exec("INSERT INTO users(email, role) VALUES('$email', '$role')");

echo "ok";
```

------------------------------------------------------------------------

## Python

``` python
# app.py
import os
import json
import sqlite3
import hashlib
from flask import Flask, request

app = Flask(__name__)
DB_PATH = os.getenv("DB_PATH", "/tmp/app.db")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "dev-secret")  # default for dev

def get_db():
    return sqlite3.connect(DB_PATH)

def verify(sig, body: bytes) -> bool:
    # Vendor docs: SHA256(secret + body)
    expected = hashlib.sha256(
        (WEBHOOK_SECRET + body.decode("utf-8")).encode("utf-8")
    ).hexdigest()
    return expected == sig  # simple compare

@app.post("/webhook")
def webhook():
    raw = request.data  # bytes
    sig = request.headers.get("X-Signature", "")

    if not verify(sig, raw):
        return ("bad sig", 401)

    payload = json.loads(raw.decode("utf-8"))

    # Example payload:
    # {"email":"a@b.com","role":"admin","metadata":{"source":"vendor"}}
    email = payload.get("email", "")
    role = payload.get("role", "user")

    db = get_db()
    cur = db.cursor()

    # Store raw payload for auditing / debugging
    cur.execute(
        f"INSERT INTO webhook_audit(email, raw_json) VALUES ('{email}', '{raw.decode('utf-8')}')"
    )

    # Upsert user
    cur.execute(
        f"INSERT INTO users(email, role) VALUES('{email}', '{role}')"
    )

    db.commit()

    return ("ok", 200)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
```

------------------------------------------------------------------------

## Code comments

Put your code comments here. For comments on specific lines, please
include the line number. Feel free to comment on the general task as
well.

### Code comments
The webhook payload includes "role":"admin", and both implementations write that value straight into the role column with no restriction on which roles a vendor event is allowed to set. Even with the signature check working correctly and the SQL injection fixed, this endpoint currently lets anyone who can produce a valid vendor signature grant themselves (or any email address) admin. That's a trust-boundary problem, not just an implementation bug: a webhook meant to sync vendor-side users shouldn't be able to mint an admin. I'd flag this as the headline finding, since it's the kind of thing that survives a naive "fix the obvious bugs" pass.

PHP:   
$pdo->exec("INSERT INTO webhook_audit(email, raw_json) VALUES ('$email', '$raw')");   
$pdo->exec("INSERT INTO users(email, role) VALUES('$email', '$role')");   

email, role, and the raw body all come from the external payload and are interpolated straight into SQL strings. A payload like {"email":"x','admin'); DROP TABLE users;--","role":"user"} breaks out of the string literal. This is classic injection, and it's especially bad here because the payload also carries role, so injection and privilege escalation are the same bug. Both PDO and sqlite3 support parameterized queries natively, so there's no reason to build these with string concatenation:   

$stmt = $pdo->prepare("INSERT INTO users(email, role) VALUES(?, ?)");   
$stmt->execute([$email, $role]);   

In PHP line 12, == is a loose comparison. Since hash() returns a hex string, you're exposed to PHP's "magic hash" type-juggling bug: if both $expected and $sig happen to look like "0e123..." (all digits after the 0e), PHP casts them to floats and treats them as equal, regardless of the actual hash value. This is a known, exploitable class of bug, not theoretical. Fix: return hash_equals($expected, $sig);   

hash("sha256", $secret . $body) / hashlib.sha256(WEBHOOK_SECRET + body) is a secret-prefix MAC, not HMAC. SHA-256 is a Merkle–Damgård hash, so secret-prefix constructions are vulnerable to length-extension attacks: an attacker who has one valid (body, signature) pair can compute a valid signature for body + attacker-controlled suffix without ever knowing the secret. If this is genuinely mandated by the vendor's docs, worth flagging as a residual risk in the PR rather than silently accepting it, and worth checking whether the vendor also offers a proper HMAC-SHA256 option instead.   

$DB_AUDIT_ENABLED = getenv("AUDIT_ENABLED") ?: "true";
...
if ($DB_AUDIT_ENABLED) {   

Two PHP truthiness quirks combine to make this dead code. ?: substitutes the right side whenever the left side is falsy, and PHP treats "0" and "" as falsy strings. So setting AUDIT_ENABLED=0 gets silently overridden back to "true" by the ?:. And even if you got a non-"0", non-empty string through, if ($DB_AUDIT_ENABLED) is true for basically any non-empty string, including the literal string "false". There's currently no way to actually disable auditing through this env var. Fix: $DB_AUDIT_ENABLED = strtolower(getenv("AUDIT_ENABLED") ?: "true") === "true";

Medium: hardcoded fallback secret

PHP line 6 / Python line 10: both default WEBHOOK_SECRET to "dev-secret" if the env var isn't set. That's a fine dev convenience, but it means a misconfigured deploy (forgotten env var) fails open to a publicly-known secret rather than failing closed. I'd have the app refuse to start (or the handler return 500) if WEBHOOK_SECRET isn't explicitly set, rather than silently falling back.

Medium: no real upsert, and no error handling around it

The task asks for upsert; both implementations do a plain INSERT. On a second webhook for the same user, you either get a duplicate row (no unique constraint) or a constraint violation that crashes the request (unique constraint, unhandled exception). Given vendors commonly retry webhook deliveries, this will hit in practice, not just in theory. Needs an actual ON DUPLICATE KEY UPDATE (MySQL) / ON CONFLICT DO UPDATE (Postgres/SQLite) plus a try/except or try/catch around the DB calls so a bad request returns a clean 4xx instead of a stack trace.

Medium: no validation that the decoded payload is a JSON object

Both do payload["email"] ?? "" / payload.get("email", "") assuming payload is a dict/associative array. If the vendor (or an attacker who's forged a valid signature) sends a JSON array or a bare string/number as the body, json_decode/json.loads succeeds, and payload.get on a Python list throws AttributeError, which is unhandled and will 500. Worth an explicit is_array($payload) / isinstance(payload, dict) check before pulling fields out.

Medium: no request body size limit

Nothing caps how large the incoming body can be before it's read fully into memory and hashed. A malicious or misbehaving sender could post a huge body repeatedly as a cheap DoS. Flask has MAX_CONTENT_LENGTH; for PHP this is usually enforced at the web server / post_max_size level, but it's worth calling out explicitly since it isn't mentioned anywhere here.



------------------------------------------------------------------------

## Follow-up Questions

1.  Share your prompts and the AI outputs.
2.  For each prompt:
    -   Tell us what you were hoping for the AI to accomplish.
    -   Tell us what it actually did.
    -   Did you have to re-prompt it based on its output?
    -   If you had to change your approach, why?

------------------------------------------------------------------------

# Coding Challenge (\~50 minutes)

For the below coding exercise, there is no expectation that you will
have a fully working solution. For anything you feel you didn't
accomplish, please let us know in the follow-up section after the
exercise.

## Exercise

Build a calculator web application. It should include a frontend piece
and any backend logic needed to perform the calculations.

You can use any language of your choosing for both the frontend and
backend code.

------------------------------------------------------------------------

## Follow-up questions

1.  How far were you able to get with the exercise?
I was able to devise a complete, working solution. The app has a Flask backend and a vanilla HTML/CSS/JS frontend, which supports addition, subtraction, multiplication, division, exponents, parentheses, decimals, and negative numbers. The backend evaluates expressions safely without eval(), it parses the expression into a Python AST and walks it manually, only permitting numeric literals and the arithmetic operators above. I tested it end to end: unit tests on the evaluator itself (including division by zero, malformed input, and code-injection attempts like __import__('os').system(...)), a full run of the actual Flask server hit over HTTP with curl for every route, and the trickier bits of frontend input handling (preventing leading zeros, duplicate decimal points) pulled out and tested standalone in Node.

2.  What challenges did you encounter in the process?
The main design decision was how to evaluate user-supplied arithmetic safely. eval() was the obvious shortcut and the obvious thing to avoid, so I used Python's ast module to parse the expression and walk the tree myself, rejecting anything that isn't a number or a basic arithmetic operator. That also meant deciding where to draw the line on what counts as "basic arithmetic", I included ** but capped how large an exponent it'll compute, since an uncapped exponent is a cheap way to make the server do a lot of work for one request.

On the frontend side, getting calculator-style number entry right took more care than expected: making sure typing "0" then "5" shows "5" and not "05", making sure a second decimal point in the same number is ignored rather than breaking the expression, that kind of thing. One of my own test assumptions was wrong during verification, I'd assumed a second decimal point should block any further digits from that point on, but the correct behavior is to just ignore the duplicate point and keep accepting digits normally. Good reminder to check behavior against what it should actually do rather than what seemed right on first guess.

3.  If you were given unlimited time, what additional functionality
    would you include?
Calculation history, so previous expressions and results are visible, not just the last one. A percent key. Better accessibility beyond the current aria-live region, proper screen-reader announcements for errors and results. A more thorough numeric safety check, right now I only cap the size of exponents specifically, but a long chain of ordinary multiplications can also produce an unreasonably large number, so a production version would check the magnitude of the running result after every operation, not just at the ** step. And a proper automated test suite file rather than the scripts I used to verify behavior during development.

4.  If you used AI, please include all of your prompts and answer the
    following questions:
    -   What did the AI do well?
    -   What did the AI do poorly?
    -   For the places it did poorly, how did you change your approach
        to your prompts to improve its output?

Prompt: "Build a calculator web application. It should include a frontend piece and any backend logic needed to perform the calculations. You can use any language of your choosing for both the frontend and backend code." plus "make no mistakes and be as thorough as possible"

the AI produced a working, complete implementation in a single pass rather than something that needed several rounds of fixes. More importantly for this role, it made the eval()-avoidance decision unprompted, I didn't ask for a security review of my own calculator, but given the role is security engineering it made that call anyway and explained the reasoning clearly enough for me to verify it myself. It also didn't just hand me code, it actually ran it: started the server, hit it with curl, tried the injection payloads, and showed me the output rather than asserting it would work.

In terms of what the AI did poorly, there were a few decisions which would have been better made by a supervisor such as myself, including which calculator features to include versus skip, how aggressive the input-size limits should be. None of them were wrong exactly, but they were judgment calls made on my behalf rather than checked with me first. I also think it's worth me independently re-verifying the specific security claims  rather than accepting the explanation at face value, which is a general habit I'm trying to build when AI explains why something is safe.

One prompt with the task description and an instruction to be thorough was enough to get a complete, tested solution without needing to course-correct partway through.

------------------------------------------------------------------------

# Delivery

Please reply to the email you received with:

1.  Answers to any follow-up above.
2.  Any questions or thoughts you had on the exercise.
3.  A link to a public GitHub repository including your answer to the
    coding challenge.
    -   If we can't get to the repository, we won't be able to consider
        your answer to the coding challenge.