# Plan implementacji | {{TICKET_ID}}

## Diagnoza
{{techniczny opis problemu z plikami i liniami}}

## Taski

### Group 1: {{nazwa}} [sonnet]
Depends on: none
- [ ] 1.1 Write test: {{co testujemy}}
- [ ] 1.2 Implement: {{co zmieniamy}} ({{plik:linia}})
- [ ] 1.3 Verify: {{komenda}}

## E2E Test Plan
Scenariusze z perspektywy użytkownika, język behawioralny:
- [ ] {{co użytkownik robi i co widzi - happy path}}
- [ ] {{co użytkownik robi i co widzi - edge case}}

## Ryzyka
{{niskie/średnie/wysokie - dlaczego}}

## OpenSpec
Rekomendacja: TAK / NIE
Powód: {{nowa funkcjonalność / zmiana zachowania = TAK, bugfix / config = NIE}}

## Environment
- Branch: {{ticket-lower}}-{{short-description}} (z staging)
- Repos: {{fotigo / api-fotigo / oba}}
- Worktree: {{repo}}/.worktrees/{{ticket-lower}}-{{short-description}}
