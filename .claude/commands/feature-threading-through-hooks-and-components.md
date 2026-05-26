---
name: feature-threading-through-hooks-and-components
description: Workflow command scaffold for feature-threading-through-hooks-and-components in clinic-translator.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-threading-through-hooks-and-components

Use this workflow when working on **feature-threading-through-hooks-and-components** in `clinic-translator`.

## Goal

Propagates new configuration or data (such as STT model or TTS voice) through React components and custom hooks to ensure end-to-end feature support.

## Common Files

- `components/PatientPane.tsx`
- `components/StaffPane.tsx`
- `lib/hooks/useStt.ts`
- `lib/hooks/useTts.ts`
- `lib/providers/deepgram-voices.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Update React component(s) in components/ to accept or use new prop/data
- Update or create custom hook(s) in lib/hooks/ to handle new prop/data
- Optionally update provider files in lib/providers/ if provider logic is affected

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.