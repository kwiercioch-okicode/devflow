# E2E Coverage

Any change that modifies user-facing behavior requires at least one E2E test.

## When E2E Is Required

| Change type | E2E required |
|---|---|
| New page or route | Yes |
| New modal, wizard, or multi-step flow | Yes |
| Modified user flow (different steps, different outcome) | Yes |
| New or changed API behavior visible to user | Yes |
| Bugfix reproducing a user-visible regression | Yes |
| Backend-only change (no user-facing effect) | No |
| Config, infra, CSS-only visual fix | No |
| Refactor with identical behavior | No |

## Mapping from OpenSpec

If the OpenSpec change has `spec.md` with `#### Scenario:` entries, each scenario maps to one E2E test.

Rule: **one spec scenario = one E2E test** (minimum).

## E2E Task Format in tasks.md

The last section of every user-facing OpenSpec `tasks.md` must be:

```markdown
## N. E2E Tests

- [ ] N.1 Write fixtures: api-fotigo/scripts/tests/<ticket>-fixtures.php
- [ ] N.2 E2E: <Scenario name from spec> (e2e-tests/<ticket>-<feature>.spec.ts)
- [ ] N.3 E2E: <another scenario>
- [ ] N.4 Run: npx playwright test e2e-tests/<ticket>-<feature>.spec.ts
```

## Exceptions

Skip E2E when:
- No Docker dev environment is available
- Change is purely backend with no user-visible effect
- It is a hotfix to production with a direct reproduction script

Document the exception as a comment in `tasks.md`:
```markdown
## N. E2E Tests
<!-- Skipped: backend-only change, no user-visible effect -->
```
