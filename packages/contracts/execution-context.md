# Preview execution context

An application or panel preview carries `X-Ontomato-Execution-Context` with exactly
`{"kind":"preview"}`. The header is the preview identity used for write admission. It does not
route reads, change the read target, or participate in cache keys; reads always use the caller's
live authority.

Preview hosts reject panel operations before dispatch. Java `/action/execute` rejects a request
carrying the preview header before parameters, temporary files or an action runtime are prepared:
“预览里不执行写操作，动作的对错用动作试跑验”.

A callback proxy for a run whose authority is `preview` injects the same header. A caller-supplied
different value is refused; values are never merged.
