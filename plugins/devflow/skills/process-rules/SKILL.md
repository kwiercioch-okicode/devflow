---
name: process-rules
description: "Core development process guardrails - loaded automatically. Enforces brainstorming before creative work, drift checks, self-review, and stop-and-ask rules. These are non-deterministic rules that the LLM must self-enforce."
user-invocable: false
---

# Process Rules

These rules apply to EVERY task in EVERY project where devflow is installed. They are non-negotiable process guardrails.

## 1. Brainstorming Before Creative Work

**Any creative work - new features, UI changes, behavior modifications - must start with exploration before implementation.**

- Ask clarifying questions about intent and requirements
- Explore 2-3 approaches with trade-offs
- Present design in sections, validate incrementally
- Only then implement

**Skip for:** bug fixes with clear reproduction, config changes, pure refactors, typos.

## 2. Test First

**Every code change starts with a test. No exceptions for "simple" changes.**

| Scenario | First step |
|---|---|
| Bug fix | Write failing test that reproduces the bug |
| Feature | Write failing test that specifies expected behavior |
| Refactor | Write characterization test that passes BEFORE touching code |

**Skip for:** infrastructure/config, CSS-only visual fixes, pure typos.

## 3. Drift Check

**After every autonomous sequence of more than 3 steps, pause.**

1. Re-read the original request
2. Confirm you're still aligned with what was asked
3. If scope has shifted, stop and explain the divergence

Do not patch forward when something goes wrong mid-implementation. Stop, re-assess, then continue.

## 4. Self-Review Before Done

**Before marking any task as done, re-read every changed file.**

For each change, answer: "Is this what I intended, or did I drift?"

Check for:
- Leftover debug code
- Hardcoded values that should be configurable
- Assumptions baked in that aren't documented
- Edge cases you thought about but didn't handle

## 5. Stop and Ask

**Do NOT proceed autonomously when:**

- Requirements are ambiguous and both interpretations lead to different implementations
- The fix requires changing a public API, database schema, or shared contract
- You've attempted two different approaches and both failed
- The task scope has grown beyond the original request
- You're about to delete or overwrite code you don't fully understand

**Do proceed autonomously when:**

- The bug has a clear reproduction, cause, and fix
- The task is well-scoped and the approach is obvious
- Tests exist and will catch regressions
- You're fixing something you broke

## 6. Minimal Blast Radius

- Touch only what the task requires
- If you notice adjacent improvements, note them separately - don't bundle them in
- Don't add features, refactor code, or make "improvements" beyond what was asked
- A bug fix doesn't need surrounding code cleaned up

## 7. Verify Before Done

A task is not done until you can demonstrate it works:

1. **Tests pass** - run the test suite (gold standard)
2. **Behavioral diff** - show before/after
3. **Build succeeds** - at minimum, compiles and lints clean

If none possible, explain why and describe what you checked manually.
