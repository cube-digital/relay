---
name: pre-pr-quiz
description: Use before opening a pull request for agent-written changes, or when the user asks to be quizzed on a change.
---
# Pre-PR quiz

The user merges only what they can explain. Show the evidence, quiz the user on the change, then ask them which evidence they want next. Do not open the pull request in this skill.

## 1. Evidence before summary

Read the diff against the base branch. List each check that ran on the current working state: the exact command, the result, and what it returned. A check that ran before later edits is historical; say so. Write `NOT RUN` for checks that did not run. Do not run new checks here.

For each green check, state what it checked and what it did not check. Name the changed behavior that no check covers.

## 2. Decisions and assumptions

List the decisions and assumptions made during the work that the user did not state. Include changed order of operations, edge conditions, defaults, error handling and removed code. Point each to a file and line.

## 3. Quiz

Ask 3 to 5 questions about this diff, not about general knowledge. Cover:

- a line picked at random: what does it do, and what breaks without it?
- one edge case or failure path;
- one decision from step 2: why this choice, and what is the alternative?
- one gap from step 1: what could fail that no check shows?

Ask all questions in one message. Do not hint at the answers. Wait for the user's answers. Grade each answer as correct or wrong against the code and explain each wrong answer with a file and line. Ask again about every wrong answer until all answers are correct. The user can stop the quiz. Then record the quiz as `skipped` and do not call it passed.

## 4. Next action: ask for evidence

End by asking the user which evidence they want before the pull request. Offer two or three concrete requests drawn from the gaps in step 1, for example "run the failing-input case and show me the output" or "show me the log of the retry path". Open the pull request only when the user asks for it.
