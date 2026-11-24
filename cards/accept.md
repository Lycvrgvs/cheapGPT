---
card: accept
state: ACCEPT
role: root
loads: status, in ACCEPT
---
The release gate passed: deliver to the user.
- `{{cmd}} report --final` opens your message: what changed, the real runs and checks, the split acceptance table, and each criterion left to the user's judgment with what to try.
- Record their reply: `{{cmd}} answer "<their words>"`. Acceptance → `advance DONE`. Feedback → `advance LOOP` (a re-plan seeded by their words).
