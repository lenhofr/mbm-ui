# PWA Setup for iPhone

This document explains the Progressive Web App (PWA) configuration for optimal display on iPhone devices, particularly those with notches and Dynamic Island (iPhone X and later).

## Issue: Black Bar at Top in PWA Mode

When the app was installed as a PWA on iPhone, users reported seeing a black bar at the top of the screen. This did not occur in Safari's browser mode.

## Root Cause

The issue was caused by the `apple-mobile-web-app-status-bar-style` meta tag being set to `black-translucent`. This setting:
- Makes the status bar overlay the content with a translucent black background
- Is intended for apps where content extends under the status bar
- Creates a black bar appearance when the app doesn't properly account for the overlay

## Solution

Changed `apple-mobile-web-app-status-bar-style` from `black-translucent` to `default` in `index.html`:

```html
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

### What This Does

With `content="default"`:
- iOS displays the standard light status bar
- The status bar uses the page's theme color (specified in the `theme-color` meta tag)
- Content starts **below** the status bar instead of behind it
- No black overlay appears
- The app properly utilizes the full screen while respecting safe areas

### Manifest Updates

Also updated `public/manifest.webmanifest` to have consistent theme colors:
- `background_color`: `#fff5f8` (light pink matching the app's lover theme)
- `theme_color`: `#ffffff` (white for clean status bar appearance)

Previously these were mismatched (`#ffffff` and `#0f172a` respectively).

## Safe Area Handling

The app already properly handles iPhone safe areas (notch, home indicator) through:

1. **Viewport meta tag** with `viewport-fit=cover`:
   ```html
   <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
   ```

2. **CSS safe-area insets** throughout the app:
   ```css
   padding-top: calc(env(safe-area-inset-top, 0px) + 1rem);
   padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem);
   ```

These ensure content is properly inset from the notch and home indicator areas.

## Status Bar Style Options

For reference, the three values for `apple-mobile-web-app-status-bar-style` are:

- **`default`** ✅ (current): Light status bar with theme-color background. Content starts below status bar.
- **`black`**: Black status bar. Content starts below status bar.
- **`black-translucent`** ❌ (previous): Black translucent status bar that overlays content. Requires careful safe-area handling.

## Testing PWA on iPhone

To test the PWA experience:
1. Open the app in Safari on iPhone
2. Tap the Share button
3. Select "Add to Home Screen"
4. Launch from the home screen icon
5. Verify no black bar appears at top
6. Verify content respects notch/Dynamic Island areas

## Resources

- [Apple Web Apps Documentation](https://developer.apple.com/documentation/webkit/safari_web_extensions)
- [Viewport meta tag reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag)
- [CSS env() for safe areas](https://developer.mozilla.org/en-US/docs/Web/CSS/env)
