```markdown
# clinic-translator Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches you how to contribute effectively to the `clinic-translator` TypeScript codebase. You'll learn the project's coding conventions, feature development workflows, and testing patterns. The repository focuses on speech-to-text (STT) and text-to-speech (TTS) translation logic, with a modular structure and a strong emphasis on unit testing and clear, conventional commits.

## Coding Conventions

- **File Naming:**  
  Use `camelCase` for file names.  
  _Example:_  
  ```
  lib/ttsRequest.ts
  lib/providers/registry.ts
  ```

- **Import Style:**  
  Use alias imports for clarity and maintainability.  
  _Example:_  
  ```typescript
  import { fetchTtsVoice as getVoice } from './providers/deepgram-voices';
  ```

- **Export Style:**  
  Prefer named exports for all modules.  
  _Example:_  
  ```typescript
  // lib/deepgram.ts
  export function transcribeAudio(...) { ... }
  export function getSupportedLanguages() { ... }
  ```

- **Commit Messages:**  
  Follow [Conventional Commits](https://www.conventionalcommits.org/) with prefixes like `feat`, `fix`, `test`, `docs`.  
  _Example:_  
  ```
  feat: add support for custom TTS voices
  fix: correct language code mapping in registry
  ```

## Workflows

### Feature Addition with Unit Tests
**Trigger:** When adding a new feature or enhancement and validating it with automated tests.  
**Command:** `/add-feature-with-tests`

1. Modify or create implementation files in `lib/` or `lib/providers/`.
2. Add or update corresponding unit test files in `tests/unit/`.
3. Ensure all tests pass using the test runner.
4. Commit changes with a conventional commit message.

_Example:_
```typescript
// lib/ttsRequest.ts
export function buildTtsRequest(params: TtsParams) { ... }

// tests/unit/tts-request.test.ts
import { buildTtsRequest } from '../../lib/ttsRequest';

test('builds correct request', () => {
  // test logic
});
```

### Feature Threading Through Hooks and Components
**Trigger:** When making a new setting or feature available throughout the UI and logic layers.  
**Command:** `/thread-feature-through-ui`

1. Update React component(s) in `components/` to accept or use the new prop/data.
2. Update or create custom hook(s) in `lib/hooks/` to handle the new prop/data.
3. Optionally update provider files in `lib/providers/` if provider logic is affected.
4. Ensure the new feature is threaded end-to-end from provider to UI.
5. Add or update tests as needed.

_Example:_
```typescript
// lib/hooks/useTts.ts
export function useTts(voice: string) { ... }

// components/PatientPane.tsx
import { useTts } from '../lib/hooks/useTts';

function PatientPane({ voice }) {
  const tts = useTts(voice);
  // ...
}
```

## Testing Patterns

- **Framework:** [Vitest](https://vitest.dev/)
- **Test Files:** Use the `.test.ts` suffix and place tests in `tests/unit/`.
- **Structure:**  
  - Import the function/module under test.
  - Use descriptive test names.
  - Cover both positive and negative cases.

_Example:_
```typescript
// tests/unit/deepgram-url.test.ts
import { buildDeepgramUrl } from '../../lib/deepgram';

test('builds URL with correct params', () => {
  expect(buildDeepgramUrl('en')).toContain('language=en');
});
```

## Commands

| Command                   | Purpose                                                      |
|---------------------------|--------------------------------------------------------------|
| /add-feature-with-tests   | Start a feature addition and create/update unit tests         |
| /thread-feature-through-ui| Propagate a new setting or feature through UI and hooks       |
```
