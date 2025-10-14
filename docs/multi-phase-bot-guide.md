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
  returns.【F:lib/doudizhu/engine.ts†L1246-L1329】
* The same file later emits a double context (`ctx.phase = 'double'`) and again
  uses the bot's decision to update the multiplier.【F:lib/doudizhu/engine.ts†L1461-L1559】

### What the bot sees in each phase

During **bid**, the bot receives:

* Its 17-card starting hand (`ctx.hands`).
* Seat index, current landlord (always `-1` during bidding), and teammate/opponent indices for convenience (`ctx.seat`, `ctx.landlord`, `ctx.teammates`, `ctx.opponents`).
* Per-rank counts for its own hand and the remaining deck (`ctx.counts.handByRank`, `ctx.counts.remainingByRank`).
* The current bidding heuristic, including the heuristic score, default threshold, running multiplier, whether the engine recommends bidding, how many attempts have occurred, and previously successful bidders (`ctx.bid`).【F:lib/doudizhu/engine.ts†L1251-L1283】

During **double**, once the bottom cards are revealed, each bot receives:

* Its updated hand (landlord already merged with the bottom), public bottom cards, and a per-seat breakdown of revealed cards (`ctx.hands`, `ctx.bottom`, `ctx.seen`, `ctx.seenBySeat`).
* Role, teammates, opponents, and per-rank tallies for hand/seen/remaining cards (`ctx.role`, `ctx.teammates`, `ctx.opponents`, `ctx.counts`).
* The current base multiplier, who the landlord is, and whether the engine recommends doubling based on its heuristics (`ctx.double.baseMultiplier`, `ctx.double.landlordSeat`, `ctx.double.recommended`).
* Additional diagnostic information: landlords receive the score delta of adding the bottom, while farmers get Monte Carlo estimates and counter-strength metrics (`ctx.double.info`).【F:lib/doudizhu/engine.ts†L1461-L1549】

During **play**, the engine attaches the follow-up requirement as a rich `ctx.require` object:

* `type`, `rank`, and `len` continue to mirror the tabled combo, so scripted bots can keep comparing ranks numerically.
* For LLM or HTTP services, the engine now supplements the combo with `label`, `rankLabel`, `minRankLabel`, `maxRankLabel`, and a short `description`, making rules such as “需跟大于对3的对子” explicit in the payload.【F:lib/doudizhu/engine.ts†L1765-L1789】【F:lib/doudizhu/engine.ts†L200-L282】
* The helper object also exposes the full Dou Dizhu ordering via `rankOrder` and its condensed `orderHint` string (`"3<4<5<6<7<8<9<T<J<Q<K<A<2<x<X"`), so external bots can confirm that `2` outranks `K` without hard-coding suit logic.【F:lib/doudizhu/engine.ts†L200-L282】

When the front-end toggles **Farmer cooperation**, every play-phase context also carries `ctx.coop`:

* `ctx.coop.enabled` flags the mode, while `teammate`, `landlord`, and their respective histories aggregate all public plays for quick teammate/opponent lookups.【F:lib/doudizhu/engine.ts†L1184-L1211】
* Built-in farmers additionally receive `ctx.coop.recommended`, which mirrors the move that the bundled `AllySupport` bot would make; the built-in `RandomLegal`, `GreedyMin/Max`, and `EndgameRush` bots follow this suggestion automatically when cooperation is enabled.【F:lib/doudizhu/engine.ts†L58-L111】【F:lib/doudizhu/engine.ts†L642-L726】【F:lib/doudizhu/engine.ts†L750-L1188】【F:lib/doudizhu/engine.ts†L1383-L1448】
* When the engine invokes an external AI (LLM or HTTP), it keeps the rest of `ctx.coop` intact but strips `ctx.coop.recommended`, ensuring the service reads the public histories and hand counts to devise its own cooperative move.【F:lib/doudizhu/engine.ts†L1774-L1858】
* External services can therefore inspect `ctx.coop.teammateHistory`, `ctx.coop.teammateLastPlay`, `ctx.coop.landlordLastPlay`, and the remaining hand counts to implement custom teamwork heuristics without relying on hidden signalling channels.【F:lib/doudizhu/engine.ts†L1184-L1211】

For an external AI that plays as a farmer, a lightweight cooperative heuristic might be:

```ts
const teammateJustSpentBomb = ctx.coop?.teammateLastPlay?.combo?.type === 'bomb';
const landlordDownToFewCards = (ctx.coop?.landlordHandCount ?? 20) <= 2;
if (ctx.role === 'farmer' && ctx.coop?.enabled) {
  // 轮到我跟牌且队友压住了地主，可考虑让牌；否则结合历史自己选最优出牌。
  if (ctx.canPass && ctx.coop.teammateLastPlay?.trick === ctx.trick) {
    return { move: 'pass', reason: '让队友继续控场' };
  }
  // ...根据 landlordDownToFewCards、teammateJustSpentBomb 等信号挑选更合适的出牌...
}
```

This keeps both built-in and external implementations on the same public-information footing while still allowing sophisticated cooperation logic.

### How the thresholds and recommendations are produced

The `score`, `threshold`, and `recommended` fields are computed by the engine before the
bot is called, so every implementation receives the same baseline heuristics:

* **Bid** – the engine evaluates each hand and chooses a threshold according to the
  configured bot name/choice.  `ctx.bid.recommended` is simply `ctx.bid.score >= ctx.bid.threshold`,
  and the built-in fallback also relies on this comparison.【F:lib/doudizhu/engine.ts†L1221-L1325】
* **Double** – the landlord recommendation is based on the score delta of the bottom cards,
  while farmers combine Monte Carlo estimates with counterplay strength; these values feed into
  `ctx.double.recommended` for each seat.【F:lib/doudizhu/engine.ts†L1434-L1559】

Bundled LLM prompts now remind the model that the default decision is to follow the provided
recommendation (e.g. “启发分 ≥ 阈值时会抢地主”) and to justify any deviation, so logs will show
the same threshold that the engine supplied even when the AI elects to override it.【F:lib/bots/openai_bot.ts†L53-L70】【F:lib/bots/deepseek_bot.ts†L51-L70】

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

## Coordination between seats

The engine does not broadcast any implicit “team orders” between bots.  Every
seat receives the full public context (hands, table history, landlord seat,
teammate/opponent indices, and per-rank tallies) and must decide on its own
move.  Built-in examples such as `AllySupport` simply read those fields and
choose to yield when the teammate currently leads the trick, but this is a
local heuristic rather than a hidden signalling channel.【F:lib/doudizhu/engine.ts†L1045-L1114】

External services receive the same inputs through `ctx`/`require` and may
implement their own cooperative logic (e.g. prioritising safe follow-ups when a
teammate leads).  There is no extra API for orchestrating joint plays beyond
the shared state that each bot already receives.【F:lib/doudizhu/engine.ts†L1687-L1789】

### 中文速览：内置算法与外置 AI 的配合差异

* **公共信息来源一致**：无论是内置算法还是外置 AI，只能看到 `ctx.coop` 提供的公开信息（例如队友/地主的历史出牌、剩余手牌估计等），不存在额外的暗号或隐藏信道。【F:lib/doudizhu/engine.ts†L1184-L1211】
* **内置农民默认跟随推荐**：当勾选“农民配合”开关时，引擎会把 `AllySupport` 的建议写入 `ctx.coop.recommended`，并仅提供给内置农民 Bot；随机、贪心等农民算法会调用 `maybeFollowCoop` 优先执行这份建议，实现统一的合作行为。【F:lib/doudizhu/engine.ts†L58-L111】【F:lib/doudizhu/engine.ts†L642-L726】【F:lib/doudizhu/engine.ts†L750-L1188】
* **外置 AI 自主决策**：调用外部服务时，引擎会保留 `ctx.coop.enabled` 等上下文字段，但移除 `recommended`，促使 AI 基于公共数据（如 `teammateLastPlay`、`landlordHandCount`）自行设计配合策略，避免被动照抄内置建议。【F:lib/doudizhu/engine.ts†L1774-L1858】
* **可扩展的协作逻辑**：如果外置 AI 需要更复杂的配合，可以结合 `ctx.coop.teammateHistory` 与当前 `require` 规则评估局势，例如让出主导权、帮队友拆分牌型，完全由外置服务决定实现方式。【F:lib/doudizhu/engine.ts†L1765-L1789】【F:lib/doudizhu/engine.ts†L1184-L1211】

综上所述，内置算法默认遵循统一的协作建议，而外置 AI 则在同样的公共数据基础上自主选择配合策略，从而保证公平性与可拓展性。
