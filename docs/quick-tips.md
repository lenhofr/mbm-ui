# Quick Tips (tabled)

Status: **Design only — not started.** Parked on branch `feature/quick-tips`.

## Idea

Short, one-or-two-line answers to cooking questions that come up a lot — not full recipes.

> **Boiled eggs** — Into boiling water: 6 min soft, 7 jammy, 11–12 hard. Ice bath after.
>
> **Boiled chicken breast** — Simmer 12–15 min to 165°F inside.
>
> **Roasted carrots** — 425°F, 25–30 min, flip halfway.

Explicitly out of scope: timers, steps, images, AI answers.

## Constraints

- App is mostly used on iPhones (mobile-first PWA).
- Tips are bundled with the SPA: instant, offline via the service worker, no backend or Terraform changes.
- Visible to everyone (logged in or not), since no API is involved.

## Placement — Option B (chosen)

A small text link **"💡 Quick Tips"** directly under the search box in `src/App.tsx` (search row is around lines 255–363).

```
┌─────────────────────────────────┐
│        Meals by Maggie          │
│ [🔍 Search your recipes…] ⬇ ⊕   │
│ 💡 Quick Tips                   │
│ ┌─────────┐ ┌─────────┐         │
│ │ recipe  │ │ recipe  │         │
```

Why not a third icon in the search row (Option A): on an iPhone SE the row already holds Import + Add (44pt each); a third button squeezes the search input to ~160px, and an icon alone (💡 / chef hat) doesn't explain itself. A labeled link costs no row space and sits in thumb reach.

## Interaction

- Tap the link → **bottom sheet** slides up (rendered into `#modal-root` via `createPortal`, like `ImportModal`).
- Sheet contents: a filter input at the top, then a plain scrollable list of tips. Typing "egg" filters to the egg tip (simple substring or Fuse.js over title + keywords).
- Close via ✕, tapping the backdrop, or swipe down.
- Mobile details: tap targets ≥ 44pt, large readable text, respect `env(safe-area-inset-bottom)`, add the sheet to `npm run test:ios-overflow`.
- No bottom-sheet pattern exists yet — all current modals are centered — so this introduces one.

## Files

- `src/lib/quickTips.ts` — tip data: `{ id, title, text, keywords: string[] }`.
- `src/components/QuickTips.tsx` + `QuickTips.css` — the bottom sheet.
- `src/App.tsx` — link under the search box + open/close state.

## Starter tips (~12)

1. Boiled eggs — soft → hard
2. Boiled / poached chicken breast & thighs
3. Roasted vegetables (carrots, potatoes, broccoli, brussels sprouts, squash)
4. Roast chicken — whole and pieces
5. Safe internal temps — chicken, pork, beef, fish, ground meat
6. Steak doneness by temp
7. Rice & grains — water ratio and time
8. Pasta — salting and timing
9. Baked potatoes
10. Salmon / white fish fillets
11. Oven bacon
12. Common conversions — tbsp/tsp/cup, oz/g, °F/°C

Verify every time/temp before shipping, especially food-safety numbers (USDA).

## Later (not part of v1)

- Let Maggie add/edit her own tips (store alongside recipes in DynamoDB with a `type` marker).
- Surface matching tips inside the main recipe search results.
