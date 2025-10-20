# Stop horizontal scroll on mobile (runbook)

This guide explains how to diagnose and eliminate horizontal scrolling on mobile. It’s tailored to this repo’s CSS and components but applies broadly to responsive web apps.

## TL;DR fixes

Apply these safe defaults to prevent most horizontal overflow issues. They’re additive and won’t break layouts:

```css
/* 1) Prevent page from scrolling horizontally */
html, body {
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;               /* fallback */
  overscroll-behavior-x: none;      /* blocks horizontal rubber-banding */
}
@supports (overflow-x: clip) {
  html, body { overflow-x: clip; }  /* preferred: prevents creating a x-scroll context */
}

/* 2) Flex/Grid children should be allowed to shrink instead of forcing overflow */
/* Add min-width:0 to common containers & children that can overflow */
.recipe-list, .recipe-card, .recipe-body, .left, .right, main, .container, .row, .grid { min-width: 0 }

/* 3) Media normalization */
img, video, canvas, svg { max-width: 100%; height: auto }

/* 4) Long content shouldn’t expand layout */
body, .app, .recipe-card, .modal, .prose { overflow-wrap: anywhere; word-break: break-word }

/* 5) Tables/code blocks scroll within themselves (not the page) */
pre, code, .code, table, .table-scroll { max-width: 100%; overflow-x: auto }

/* 6) Overlays stay within their containers */
.recipe-image { position: relative; overflow: hidden }
.recipe-card-actions--overlay { top: 8px; right: 8px }

/* 7) Avoid 100vw; use 100% instead to prevent scrollbar width overflow */
.full-bleed, .section-bleed { width: 100% }
```

Repo note: We already have some of these in `src/styles.css` (e.g., `html, body { overflow-x: hidden }`, media normalization, and `overflow: hidden` on `.recipe-image`). If horizontal scroll persists, continue with the diagnosis below.

## Why horizontal overflow happens

Common culprits:
- Containers set to `width: 100vw` (includes the scrollbar/visual viewport quirks on some browsers)
- Flex/grid children with `min-width: auto` (default) that contain long, unbreakable content
- Absolutely positioned elements or transforms that push content outside the viewport
- Negative margins or wide box-shadows on elements near the edges
- Long URLs, unbroken words, or preformatted text (code) inside narrow containers

## Step-by-step diagnosis

1) Find offenders in DevTools Console:

```js
// Elements wider than they’re allowed to be
[...document.querySelectorAll('*')]
  .filter(el => el.scrollWidth > el.clientWidth)
  .slice(0, 50)
```

Tip: Hover each returned node to see it highlighted; look for items near the page edges.

2) Add a quick visual helper (optional):

```css
/* Temporary: outline any element that overflows its parent */
/* Remove after debugging */
.debug-overflow { outline: 2px solid red }
```
Then in DevTools, toggle `.debug-overflow` on suspects via the element panel.

3) Inspect container patterns:
- Flex/grid rows: ensure children have `min-width: 0`
- Replace `width: 100vw` with `width: 100%`
- For overlays (like our image action buttons): parent needs `position: relative; overflow: hidden`
- For long content: use `overflow-wrap: anywhere`

4) Validate on iOS Safari (Responsive Design Mode):
- Test small viewports and rotate
- Verify no left/right panning occurs

## Repo-specific checklist (updated)

- Global page overflow
  - [x] Ensure `html, body { overflow-x: clip; }` (with hidden fallback) is in `src/styles.css` (also added `overscroll-behavior-x: none`)
- Flex/Grid containers
  - [x] Add `min-width: 0` to `.recipe-list`, `.recipe-card`, `.recipe-body`, `.left`, `.right`, and any custom rows/containers; also added a defensive `:where(main, .container, .row, .grid) > * { min-width: 0 }`
- Media
  - [x] Keep `img, svg, video, canvas { max-width: 100%; height: auto }`
- Overlay actions
  - [x] `.recipe-image { overflow: hidden }` and the overlay `.recipe-card-actions--overlay` is positioned from the top/right, not using negative offsets
  - [x] On touch devices, we already hide the overlay: `@media (hover: none) and (pointer: coarse) { .recipe-card-actions--overlay { display: none } }`
- Full-bleed sections
  - [x] Avoid `100vw`; prefer `width: 100%` — replaced `width: min(92vw, 900px)` with `min(100%, 900px)` and `.cook-fullscreen` from `98vw` to `100%` to prevent viewport scrollbar-induced overflow.

Changes implemented in this PR:

- html/body: `overflow-x: clip` with `hidden` fallback and `overscroll-behavior-x: none`
- Defensive `min-width: 0` on common flex/grid containers and children
- `overflow-wrap: anywhere; word-break: break-word` on common content wrappers
- `pre, code, table` constrained to `max-width: 100%` with `overflow-x: auto`
- Avoided `vw` widths in cook modal and fullscreen variants

## Optional: defensive utility snippet

Consider adding a one-time utility to the base stylesheet to prevent future regressions:

```css
/* Defensive: prevents accidental layout blowouts */
:where(main, .container, .row, .grid) > * { min-width: 0 }
:where(img, video, canvas, svg) { max-width: 100%; height: auto }
@supports (overflow-x: clip) { html, body { overflow-x: clip } }
```

## Verification

- Desktop + mobile browsers: try to pan left/right — view should not move
- Use DevTools to confirm no element has `scrollWidth > clientWidth` at runtime
- Re-check after adding new components with overlays, long text, or flex rows

## Notes on modern viewport units

- Prefer `svh/svw` over `vh/vw` for stable mobile viewports when using height-based layouts (`100svh` is already used in this repo)
- If you must use full-viewport width sections, constrain with padding/margins rather than `100vw`

---

If you want, we can open a small PR (e.g., `no-horizontal-scroll`) that adds the TL;DR CSS block and the defensive utility snippet so it’s locked in.