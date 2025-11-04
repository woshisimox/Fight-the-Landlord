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
* The current bidding heuristic, including the heuristic score, historical threshold, running multiplier, the engine's internal recommendation, how many attempts have occurred, and previously successful bidders (`ctx.bid`).  When the engine detects a phase-aware external bot it removes `threshold`/`recommended` before invoking it and leaves a boolean `ctx.bid.default` as a purely informational fallback.【F:lib/doudizhu/engine.ts†L1251-L1329】

During **double**, once the bottom cards are revealed, each bot receives:

* Its updated hand (landlord already merged with the bottom), public bottom cards, and a per-seat breakdown of revealed cards (`ctx.hands`, `ctx.bottom`, `ctx.seen`, `ctx.seenBySeat`).
* Role, teammates, opponents, and per-rank tallies for hand/seen/remaining cards (`ctx.role`, `ctx.teammates`, `ctx.opponents`, `ctx.counts`).
* The current base multiplier, who the landlord is, and the engine's own doubling heuristics (`ctx.double.baseMultiplier`, `ctx.double.landlordSeat`, `ctx.double.recommended`).  As with bidding, phase-aware external bots only receive a sanitized payload where `ctx.double.recommended` is stripped and its value copied into `ctx.double.default` for reference.【F:lib/doudizhu/engine.ts†L1461-L1559】
* Additional diagnostic information: landlords receive the score delta of adding the bottom, while farmers get Monte Carlo estimates and counter-strength metrics (`ctx.double.info`).【F:lib/doudizhu/engine.ts†L1461-L1549】

During **play**, the engine attaches the follow-up requirement as a rich `ctx.require` object:

* `type`, `rank`, and `len` continue to mirror the tabled combo, so scripted bots can keep comparing ranks numerically.
* For LLM or HTTP services, the engine now supplements the combo with `label`, `rankLabel`, `minRankLabel`, `maxRankLabel`, and a short `description`, making rules such as “需跟大于对3的对子” explicit in the payload.【F:lib/doudizhu/engine.ts†L1765-L1789】【F:lib/doudizhu/engine.ts†L200-L282】
* The helper object also exposes the full Dou Dizhu ordering via `rankOrder` and its condensed `orderHint` string (`"3<4<5<6<7<8<9<T<J<Q<K<A<2<x<X"`), so external bots can confirm that `2` outranks `K` without hard-coding suit logic.【F:lib/doudizhu/engine.ts†L200-L282】
* `ctx.rules` summarises every legal combo, including the minimum length of sequences (e.g. `pair_seq` requires at least three consecutive pairs) and example layouts, so external services can validate shapes before constructing a move.【F:lib/doudizhu/engine.ts†L1794-L1923】

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

The engine still evaluates every seat before contacting a bot so it can fall back to
the legacy heuristics when necessary:

* **Bid** – `ctx.bid.score` is compared against a threshold derived from the seat's configured
  bot, and the boolean result is stored in `ctx.bid.recommended`.  Phase-aware external bots
  receive a sanitized copy that omits the numeric threshold and recommended flag, leaving a
  `ctx.bid.default` hint solely for error recovery; built-in bots continue to use the raw
  values.【F:lib/doudizhu/engine.ts†L1221-L1329】
* **Double** – the landlord calculation measures the bottom-card delta, while farmers combine
  Monte Carlo estimates with counterplay strength.  Those results populate `ctx.double.recommended`
  for internal logic, while the sanitized context exposes the boolean as `ctx.double.default`
  when calling external services.【F:lib/doudizhu/engine.ts†L1434-L1559】

Bundled LLM prompts now emphasise that external services should rely on their own evaluation of
the hand, seating order, and public information instead of the engine's heuristic thresholds, only
using the provided context as raw data.【F:lib/bots/openai_bot.ts†L46-L108】【F:lib/bots/deepseek_bot.ts†L44-L97】

## 计分与对局倍数（中文）

斗地主的最终得分由多个阶段累积出来，前端日志里看到的“叫抢倍数”“对局倍数”也对应着引擎中的几个变量：

1. **叫抢倍数 (`bidMultiplier`)**：在抢地主阶段，每当一名玩家选择“抢”时，对局倍数就会乘 2，并同步到日志中的“叫抢xN”。【F:lib/doudizhu/engine.ts†L1287-L1337】【F:lib/doudizhu/engine.ts†L1345-L1357】
2. **对局倍数 (`multiplier`)**：这是在抢地主阶段实时累计的基础倍数，完成抢地主后会通过 `multiplier-sync` 事件通知前端，所以你会看到“对局xN”的提示。这个数值还会作为后续加倍与结算的基础倍数。【F:lib/doudizhu/engine.ts†L1345-L1371】【F:lib/doudizhu/engine.ts†L1399-L1406】
3. **明牌加倍（地主/农民）**：亮底后，地主和两位农民会分别根据手牌与底牌评估是否再加倍，结果记录在 `__doubleMulY` 和 `__doubleMulB` 中；它们与基础倍数相乘，得到地主对乙、对丙两条线的结算倍数基准。【F:lib/doudizhu/engine.ts†L1411-L1559】【F:lib/doudizhu/engine.ts†L1565-L1579】
4. **炸弹 / 王炸加倍**：对局过程中只要有人出炸弹或王炸，就会把 `bombTimes` 加 1；最后结算时再用 `1 << bombTimes`（即 2 的 `bombTimes` 次方）额外放大倍数，这就是常见的“出炸弹翻倍”。【F:lib/doudizhu/engine.ts†L1821-L1897】【F:lib/doudizhu/engine.ts†L1912-L1940】
5. **春天 / 反春天**：若地主一方或农民一方满足春天条件，`springMul` 会乘 2；最终倍数再乘上 `springMul`。所以除了抢地主和明牌加倍之外，炸弹与春天也会让“对局倍数”进一步放大。【F:lib/doudizhu/engine.ts†L1898-L1940】

总结来说，前端显示的“对局倍数”是在抢地主阶段累计的基础值；真正结算时还要再乘上各方明牌加倍的结果、炸弹/王炸的 2 倍数，以及春天/反春天的额外 2 倍。因此看到倍数突然翻倍，很可能是对局中有人炸弹或者出现春天，并不仅仅来自抢地主或加倍阶段。

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
