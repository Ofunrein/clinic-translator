---
name: feature-addition-with-unit-tests
description: Workflow command scaffold for feature-addition-with-unit-tests in clinic-translator.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-addition-with-unit-tests

Use this workflow when working on **feature-addition-with-unit-tests** in `clinic-translator`.

## Goal

Implements a new feature or enhancement and adds corresponding unit tests to ensure correctness.

## Common Files

- `lib/deepgram.ts`
- `lib/providers/registry.ts`
- `lib/tts-request.ts`
- `tests/unit/deepgram-url.test.ts`
- `tests/unit/providers-registry.test.ts`
- `tests/unit/tts-request.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Modify or create implementation files in lib/ or lib/providers/
- Add or update corresponding unit test files in tests/unit/

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.