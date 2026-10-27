# Fun touches and native iPhone ideas

Status: **ideas, not started.** Listed in [`ios-backlog.md`](ios-backlog.md#fun-and-delight). Brainstormed 2026-10-11; checked against `main` on 2026-10-27 (none of these exist yet).

The app already has a playful voice: kitchen-talk lines (`src/lib/kitchenTalk.ts` on the web, ported strings on iOS), the bobbing pot (`CookSpinner.swift`), "Chef's kiss!" when you finish cooking, haptics on ticks. These ideas lean into that. Part 1 is small, self-contained polish that could ship together as one "fun pass"; part 2 is bigger native iPhone features, each its own branch.

---

## Part 1: Fun and cute touches

### 1. Rotating sayings under the loading pot
**Now:** the home loader picks one line at launch (`loadingLine` in `RecipeListView.swift`) and shows it for the whole wait.
**Idea:** cycle through the lines every ~2 seconds with a soft crossfade ("Simmering…" → "Raiding the pantry…" → "Letting the dough rise…"), never repeating the previous line.
**How:** a small `RotatingKitchenTalk` view: `@State` index, a `.task` loop with `Task.sleep(for: .seconds(2))`, `.contentTransition(.opacity)` or `.id(index)` + `.transition(.opacity)`. Start on a random line. Stop when the view disappears (the `.task` cancels itself). Reuse it anywhere there's a wait (e.g. the editor's Save, the nickname prompt's Save).
**Copy:** the web's `talk.loading` lines, plus new ones: "Tasting for salt…", "Finding the good spatula…", "Waiting for the water to boil…", "Licking the spoon…".
**Size:** small.

### 2. Steam that actually steams
**Idea:** the pot's three steam lines (`CookingPot` shape in `CookSpinner.swift`) wiggle and drift up while it bobs, so it looks like it's simmering.
**How:** split the steam into its own `Shape`, draw it separately from the pot, and animate each line's opacity and small vertical offset on staggered timers (e.g. 0.9s, 1.1s, 1.3s, autoreversing). Keep the pot's `cook-bob` motion. Respect Reduce Motion (static steam).
**Size:** small.

### 3. Sprinkles when you finish cooking
**Now:** tapping **Finish** in cook mode shows "Chef's kiss!" (`CookDoneView` in `CookView.swift`) with a success haptic.
**Idea:** a burst of confetti "sprinkles" (little rounded rectangles in plum, pink, chip and gold) falling over the done screen, plus the haptic.
**How:** a lightweight `SprinklesView`: ~60 particles with random angle, speed, spin and color, driven by `TimelineView(.animation)` + `Canvas`, running ~2.5s once. No dependency needed. Respect Reduce Motion (skip the burst, keep the haptic).
**Size:** small to medium.

### 4. Heart pop when favoriting
**Now:** the card heart (`HeartButton` in `RecipeListView.swift`) bounces via `.symbolEffect(.bounce)`.
**Idea:** when a heart turns on, 4–6 tiny hearts float up and fade from the button.
**How:** an overlay that, on `isOn` becoming true, spawns small `heart.fill` images with random x drift, animating offset y −30…−50 and opacity → 0 over ~0.7s. Only on turning on, not off.
**Size:** small.

### 5. Funny "no results" messages
**Now:** iOS shows "Nothing matches. Try another search or tag." (`RecipeListView.swift`); the web shows `talk.noMatch`: *No "kale" in the pantry.* / *We checked every cupboard: no "kale".*
**Idea:** port the web lines with the search text filled in, picked once per search (not re-rolled on every keystroke).
**How:** pick a template when `searchText` changes (debounced), fill `{q}`; keep the generic message when the empty result comes from a tag filter with no search text.
**Size:** tiny.

### 6. Time-of-day greeting
**Idea:** a small line under the "Meals by Maggie" logo that changes with the time:
- morning: *"Good morning, Rob ☕"*
- midday: *"Lunch break?"*
- late afternoon: *"What's for dinner?"*
- evening: *"Something sweet tonight?"*
- late night: *"Midnight snack?"*
**How:** computed from `Calendar.current.component(.hour, from: .now)`; use the kitchen nickname (`auth.nickname`) when signed in, otherwise no name. Keep it to one muted line so the header doesn't grow much. Could also exist on the web.
**Size:** tiny.

### 7. Shake for dinner
**Idea:** shake the phone on the home screen and the app picks a random recipe: *"Can't decide? Fate says: Buffalo Chicken Dip."* with a "Let's cook" button and a "Shake again" hint. Fun and genuinely useful.
**How:** SwiftUI has no shake modifier; add one with a `UIWindow` subclass or `UIViewController` override of `motionEnded(_:with:)` posting a notification, wrapped as `.onShake { }`. Pick from the currently visible list (respects the search/tag/favorites filters), avoiding the last pick. Show a sheet with the recipe card, or push its detail. Add a success haptic. Consider a tappable "🎲" in the header as a non-shake way in (and for accessibility).
**Size:** small to medium.

---

## Part 2: Native iPhone features

### 8. Home Screen widget: "Tonight's pick"
**Idea:** a widget showing a random recipe (photo and title) that changes daily; tapping it opens that recipe.
**How:** a WidgetKit extension target. Recipes are public (`GET /recipes`), so the widget's timeline provider can fetch the list itself; no App Group or login needed. Pick deterministically per day (seed by date) so it doesn't flip on every reload; refresh once a day. Open via the existing Universal Link (`https://mealsbymaggie.com/recipe/<id>`, handled by `DeepLink.swift`) with `widgetURL`. Sizes: small (photo + title), medium (photo + title + time).
**Size:** medium (new target, signing, TestFlight).

### 9. Cook mode on the Lock Screen (Live Activity)
**Idea:** while cooking, the current step and progress ("Step 3 of 6") show on the Lock Screen and in the Dynamic Island, so you can glance without unlocking floury hands.
**How:** ActivityKit + a widget extension (can share the widget target from #8). Start the activity when cook mode opens, update it as steps are ticked (`CookView.swift`), end it on Finish or close. Local updates only (no push server needed).
**Size:** medium.

### 10. Siri and Shortcuts
**Idea:** "Hey Siri, what's for dinner?" picks a random recipe (pairs with #7); "Show me banana bread" opens a recipe by name.
**How:** App Intents (`AppIntent`, `AppShortcutsProvider`) with a recipe `AppEntity` backed by `RecipeStore`/`RecipeAPI`. Phrases are registered automatically, no setup for the user.
**Size:** small to medium.

### 11. Spotlight search
**Idea:** recipes show up in the iPhone's Spotlight search; tapping one opens it in the app.
**How:** index recipes with Core Spotlight (`CSSearchableItem`: title, tags, a few ingredients, thumbnail) after `RecipeStore.load()`; re-index on save/delete; handle `CSSearchableItemActionType` via `.onContinueUserActivity`. Can share the `AppEntity` from #10 (iOS 18 can index App Entities directly).
**Size:** small to medium.

### 12. Grocery list in Reminders
**Idea:** "Add to shopping list" on a recipe (or in cook mode) sends the **unchecked** ingredients, with amounts scaled to the chosen servings, to Apple's Reminders as a "Meals by Maggie – <recipe>" list (or an existing "Groceries" list).
**How:** EventKit (`EKEventStore`, `requestFullAccessToReminders`, `EKReminder`), plus `NSRemindersFullAccessUsageDescription`. Reuse `Quantity.scale` / `displayText(scaledBy:)`.
**Size:** small to medium.

### 13. Seasonal app icons
**Idea:** let people pick an alternate icon in the account sheet: e.g. a pumpkin-spice MbM for fall, a holiday one in December, maybe a "classic" plum.
**How:** alternate app icon sets in `Assets.xcassets` + `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES`, switched with `UIApplication.shared.setAlternateIconName`. Needs the artwork (1024×1024 each).
**Size:** small (plus design time).

### 14. Offline recipes
**Idea:** keep the last-loaded recipes (and their photos) on the phone, so the list, recipe pages and cook mode work in a kitchen with poor signal.
**How:** cache the `/recipes` JSON to disk (or SwiftData) on each successful load and show it immediately at launch, then refresh in the background; let `AsyncImage` use a larger `URLCache`, or prefetch thumbnails. Writes still need a connection; show a gentle "You're offline" note.
**Size:** medium.

---

## Considered and left out

- **Step timers** ("Bake 20 minutes" → tap to start a timer): the web's cook timers were deliberately removed (PR #102, `remove-cook-timers`), so not reintroducing them on iOS without revisiting that decision.

## Suggested order

1. A **"fun pass"** branch with #1, #2, #5, #6 (tiny/small, all in existing files), then #3, #4, #7.
2. Native features one branch each, by value: #14 offline recipes, #8 widget (then #9 Live Activity reusing its target), #12 grocery list, #10 Siri, #11 Spotlight, #13 icons.
