# CONNECTIONS — wiki

- `claude -p --output-format stream-json --verbose` emits system (hooks, init with session_id), assistant (content: thinking / text / tool_use), user (tool_result), rate_limit_event, result (is_error, result, total_cost_usd). `--resume <id>` continues with full context.
