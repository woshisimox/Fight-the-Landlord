# Multi-phase Dou Dizhu Bot Support

This project now drives all Dou Dizhu bots through three explicit phases:

1. **Bid (`ctx.phase === 'bid'`)** – decide whether to take the landlord role by
   returning `{ phase: 'bid', bid: boolean }`.
2. **Double (`ctx.phase === 'double'`)** – decide whether to double after the
   bottom cards are revealed by returning
   `{ phase: 'double', double: boolean }`.
3. **Play (`ctx.phase === 'play'` or undefined)** – play cards by returning
   `{ move: 'play' | 'pass', cards?: string[] }`.

The engine builds rich contexts for each phase and forwards them to the
configured bot.  If a bot does not recognise the phase, the engine falls back to
its built-in heuristics.

## Engine entrypoints

* `lib/doudizhu/engine.ts` constructs a bid context (`ctx.phase = 'bid'`) before
  invoking the bot for each seat and honours the boolean result that the bot
  returns.【F:lib/doudizhu/engine.ts†L1202-L1260】
* The same file later emits a double context (`ctx.phase = 'double'`) and again
  uses the bot's decision to update the multiplier.【F:lib/doudizhu/engine.ts†L1330-L1400】

## Reference bot updates

Every bundled bot has been updated so that it can understand and respond to the
new phases:

* `lib/bots/http_bot.ts` forwards the entire context, including `ctx.phase`, to
  an external HTTP service and accepts `{ phase: 'bid' | 'double', ... }`
  responses, so remote AIs can decide whether to bid or double.【F:lib/bots/http_bot.ts†L12-L43】
* `lib/bots/openai_bot.ts`, `gemini_bot.ts`, `grok_bot.ts`, `kimi_bot.ts`,
  `qwen_bot.ts`, and `deepseek_bot.ts` adjust their prompts and parsers so that
  LLMs can return bid/double decisions in strict JSON form.【F:lib/bots/openai_bot.ts†L1-L123】【F:lib/bots/deepseek_bot.ts†L1-L110】
* `lib/bots/mininet_bot.ts` exposes internal heuristics for the additional
  phases to remain compatible with scripted tournaments.【F:lib/bots/mininet_bot.ts†L540-L607】

With these changes, any external AI (HTTP or LLM-based) can make landlord and
double decisions by respecting `ctx.phase` and returning the corresponding JSON
shape.
