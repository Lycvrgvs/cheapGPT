---
card: loop-full
state: LOOP
level: full
role: root
loads: status, in a loop at level full
---
Full: a fresh loop-breaker takes the full step back and the one-block, then builds alone. No builders, no merge of parallel work.
1. `{{cmd}} call breaker`. Append to its packet: the plan, the vetoes, BASE and its diff, every real-run result, finding and dropped attempt (the saved candidates in temporary/), and your own reading labelled an unverified hypothesis.
2. When it returns, record its prevent: `{{cmd}} stepback full --targets <IDs> "<its step back>"` and `{{cmd}} block "<its one-block>"`. A target that already failed: `run --before` on BASE.
3. `{{cmd}} merge <id>`, run the affected path, then the same review as a tiny loop (step 4 of the loop-tiny card) and reproduce.
If every item is established, the loop-breaker has nothing to fix: `advance GATE`.
