# Fact-Check Yourself

Never assume an API, method signature, config option, or library behavior from memory alone.

When in doubt:
1. Read the actual source code
2. Check the types/interfaces in the project
3. Verify documentation

"I think this method takes X" is not good enough. Read the definition.

## No Guessing - blank is better than wrong

A wrong answer (hallucinated code, invented API, guessed behavior) is **3x worse** than saying "I need to check this." Apply these rules to every claim about code:

| Rule | Action |
|---|---|
| **Force blank** | When you cannot verify something from source, say so explicitly. Do not fill the gap with plausible-sounding code. |
| **Penalize guessing** | "I'm not sure, let me check" is always better than a confident wrong answer. Never trade certainty theater for accuracy. |
| **Show the source** | For every technical claim, know whether it is EXTRACTED (read from code/docs) or INFERRED (assumed from patterns/memory). Flag inferences explicitly. |

## Common hallucination areas

- Method signatures and parameter order
- Config option names and default values
- Library version differences
- Framework convention changes between versions
- Database column names and types
- Route paths and HTTP methods
- Environment variable names
