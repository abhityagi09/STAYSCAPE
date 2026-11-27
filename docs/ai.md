# AI travel assistant

`/account/assistant` helps travellers find and compare stays. Implementation:
`apps/api/src/modules/assistant/`.

## Providers

| `AI_PROVIDER`     | Behaviour                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules` (default) | Deterministic assistant: parses destination, dates and party size and calls the same search/quote services. No external calls; used in development, tests and as the fallback.                          |
| `anthropic`       | Claude via the official Anthropic SDK (`@anthropic-ai/sdk`), model `AI_MODEL` (default `claude-opus-5-5`), effort `AI_EFFORT`. Requires `ANTHROPIC_API_KEY` (backend only — never sent to the browser). |

## Grounding: the assistant cannot invent facts

- **Tools only**: `search_hotels`, `get_hotel`, `quote_stay` call the real search, detail and
  pricing services. Tool arguments are validated with Zod before use.
- **Read-only**: it cannot book, pay, cancel or change anything; it sends travellers to the
  property page to book and never claims a booking is confirmed.
- **Untrusted data**: tool results are wrapped as `{"untrusted_data": …}`, and the system prompt
  states that tool results, property descriptions and earlier messages are data, not
  instructions (prompt-injection defence).
- **Verified output**: the answer is structured JSON. Properties it recommends must have
  appeared in tool results in this conversation; every currency amount in the answer must match a
  price produced by the pricing engine — otherwise the answer is replaced by the verified quotes.
- **Failure-safe**: timeouts (`AI_REQUEST_TIMEOUT_MS`, `AI_TURN_DEADLINE_MS`), an iteration limit
  (`AI_MAX_TOOL_ITERATIONS`) and provider errors fall back to the deterministic assistant.

## Limits, cost and privacy

- Per-user limits: `AI_REQUESTS_PER_MINUTE_PER_USER`, `AI_DAILY_REQUESTS_PER_USER`; optional
  monthly platform budget `AI_MONTHLY_BUDGET_MICRO_USD` (cost tracked from token usage with
  `AI_PRICE_*`).
- Prompt caching on the stable system prompt and tools.
- Logs record counts, tool names, timing and cost only — never message text or ids.

## Status

The deterministic path is tested end to end. The live Claude path is tested against a scripted
client (`assistant.test.ts`); verifying it against the real API needs an `ANTHROPIC_API_KEY`
(docs/known-limitations.md).
