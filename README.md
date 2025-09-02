# Suits Add-on for v1.6.3-hotfix3

This add-on introduces *physical cards with suits* while keeping the on-screen rules unchanged.
- Cards now have: `{ id, suit, label, rank }`
- `label` is per-suit (e.g. `♠A`), jokers are `SJ`/`BJ`
- Pair/bomb enumeration uses *rank grouping*, so `♦K + ♣K` forms a valid **pair**, `xxxx` forms **bomb**.

## Files
Copy these three files into your project (overwrite):
```
lib/types.ts
lib/cards.ts
lib/combos.ts
```

## Engine hook
Where you deal cards, switch to:
```ts
import { deal3 } from '@/lib/cards';
const { hands, bottom } = deal3();
```

## Notes
- UI and logs can continue to render `card.label`.
- No suit-based power; comparison is by `rank` only.
