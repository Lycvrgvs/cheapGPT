---
card: mini-review
state: LOOP
role: root
route: FOCUSED
loads: status, in every loop of a FOCUSED task
---
Mini-review (FOCUSED): you judge the loop yourself, from the real run of the merged, committed HEAD, never from the builders' reports.
- For each target, read its acceptance line and the run's real output. MET only with evidence that excludes the nearest counterfeit (the look-alike that would pass without the property) and its boundary case run. NOT_MET with a case someone can rerun.
- Write one line per target to `cheapgpt/mini.md`, in the reviewer's format:
`<ID> | MET | evidence: <run or output> | counterfeit: <the look-alike excluded> | boundary: <boundary case run, and its result>`
`<ID> | NOT_MET | case: <input; command; observed output>`
- Then `{{cmd}} review mini`. What a mini-review misses, the release gate's fresh review catches; do not call a reviewer here.
