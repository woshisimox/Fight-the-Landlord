# Advanced Bot Roadmap

This roadmap collects implementation notes for four strength upgrades to the Dou Dizhu bot stack.  Each section summarises the intended use cases, integration points, and an MVP cut that can be tackled incrementally.

## Logistic Regression / GBDT / Random Forest Classifiers

**Use cases**

* Bid / double binary decisions (`phase === 'bid' | 'double'`).
* Play-phase follow-up such as "follow vs pass" classification or scoring of a short candidate list prior to greedy resolution; blend outputs from logistic, gradient boosted, and random forest ensembles for stability.

**Integration hooks**

* Extend `BotCtx` to expose the feature vector that the model expects (counts, seen / seenBySeat, handsCount, role, leader, require).
* In the engine, swap the heuristic call site for a lightweight inference adapter; continue to delegate to `greedy-min` once scores are produced to keep fallback behaviour intact.

**MVP delivery**

1. Export an offline-trained model (logistic regression coefficients, GBDT leaf table, or random forest trees) into a JSON/TypeScript module consumable by the front-end runtime.
2. Implement pure-JS inference helpers that reconstruct the dot product / tree walk using only standard library math; keep tree walkers generic enough to evaluate both boosted and bagged ensembles.
3. Add unit tests that feed recorded contexts through the helper to verify parity with the offline evaluation notebook and to validate that ensemble blending behaves as expected.

## Heuristic Beam Search (Width 3–5)

**Use cases**

* Play-phase search over legal combinations to improve sequencing beyond greedy heuristics.

**Integration hooks**

* Reuse the existing legal move generator (or bolt on a fast enumerator) to emit candidate singletons / pairs / sequences.
* Drive the beam with a configurable width (default 3–5) and a state evaluator that scores (estimated remaining hands + bomb/rocket retention + teammate follow-up probability).
* Honour the existing `botTimer` deadline: abort the search when the timer elapses and fall back to greedy-min.

**MVP delivery**

1. Implement partial expansion that only considers singles, pairs, and straights; track bombs separately as insurance plays.
2. Build an iterative beam loop that stores `(state, score, depth)` tuples and expands until depth / timer limits trigger.
3. Surface diagnostics (depth reached, final candidate) in dev builds to aid tuning.

## Opponent Hand Particle Filter

**Use cases**

* Produce sharper probability distributions for remaining cards and teammate relay chances during the play phase.

**Integration hooks**

* Consume `seen`, `seenBySeat`, and `handsCount` from `BotCtx` to ensure samples obey public information.
* Expose a sampling API such as `sampleHands(ctx, seed, numParticles)` that returns `P(seat, card)` tables ready for downstream evaluators.

**MVP delivery**

1. Each trick, resample 200–500 complete assignments consistent with counts and forbidden cards.
2. Aggregate the samples into marginal probabilities per seat and per combo type.
3. Plug the probabilities into the beam-search evaluator to estimate whether teammates or opponents can beat a proposed move.

## Endgame DFS with Memoisation

**Use cases**

* Solve or closely approximate outcomes when all seats hold seven or fewer cards.

**Integration hooks**

* Detect when every hand count is `<= 7` and divert to the endgame solver.
* Encode state keys as `(seatToMove, compactHands, require)` and cache the resulting win rate / plies remaining in a hash map for reuse.

**MVP delivery**

1. Compress hands into sortable bitmasks to keep keys stable across recursion.
2. Implement DFS with alpha-beta style pruning to cut symmetrical branches.
3. Persist the memo table across calls within the same round so the solver can reuse work when similar states recur.

