# Mobile App Options for MBM

This document summarizes viable paths to ship an iOS app (and optionally Android), reusing as much of the existing web app as practical. It covers effort, pros/cons, and decision inputs.

## TL;DR
- Fastest ship: Capacitor wrapper (1–2 days to run, ~1–2 weeks polish). Reuses the SPA in a WKWebView and ships to the App Store.
- Balanced native feel + reuse: React Native (Expo) parity in ~3–6 weeks; polished 1.0 in ~6–10 weeks.
- Best native fit: SwiftUI rewrite ~8–14 weeks MVP; ~12–20 weeks polished.

---

## Option A: Capacitor (wrap SPA)
Run the existing Vite/React app inside a native shell (WKWebView) with access to native APIs via plugins.

- Effort
  - Initial integration: 1–2 days
  - Stabilization, TestFlight, App Store assets, fixes: 1–2 weeks
- Pros
  - Reuse ~95% of current code and UI
  - Very fast to store; minimal architectural change
  - Keep existing upload/auth flows; presigned POST/PUT continues to work
  - Can add targeted native plugins later (camera, share)
- Cons
  - UX is still “web in a webview”; not full native
  - Some iOS quirks in WKWebView (history, file inputs) need testing
  - Hosted-UI OAuth requires custom scheme + ASWebAuthenticationSession bridge
- Key considerations
  - Auth: Cognito Hosted UI vs in-app username/password; configure redirect URI and URL scheme
  - Info.plist: NSCameraUsageDescription, NSPhotoLibraryUsageDescription
  - Icons/splash: reuse current branding assets
  - App Transport Security: all endpoints HTTPS (OK with API Gateway/S3/CloudFront)

---

## Option B: React Native (Expo)
Rebuild the UI using native components while reusing TypeScript logic and service calls.

- Effort
  - MVP parity: 3–6 weeks (single dev)
  - Polished 1.0: 6–10 weeks
- Pros
  - Native UI performance and feel
  - Cross-platform: Android becomes feasible with limited extra work
  - Good ecosystem for image picking, resizing, file uploads
  - Can reuse a lot of business logic and TypeScript types
- Cons
  - Rebuild UI screens, navigation, and modals
  - Some libraries differ from web; learning curve around RN specifics
  - Extra work to match refined web styles
- Key considerations
  - Auth: Amplify/Auth helpers for RN, or use hosted UI + deep links
  - Image upload: use S3 presigned POST via fetch; client-side resize with RN libraries
  - Offline: MMKV/SQLite; reconcile with current storage expectations
  - Testing: E2E with Detox

- Rough timeline (single dev)
  - Week 1: Scaffold (Expo), navigation, theming; Cognito wiring; API client
  - Weeks 2–3: Screens (list, details, add/edit, cook mode), image picker/upload, resize, caching
  - Week 4: Edge cases (HEIC, large files), error states, a11y, basic E2E
  - Weeks 5–6: Perf polish, TestFlight, App Store assets/privacy; bugfixes
  - Weeks 7–10 (optional): Nice-to-haves (push, deep links, iPad layouts)

---

## Option C: SwiftUI (full native)
Rewrite in Swift/SwiftUI for the most native experience.

- Effort
  - MVP parity: 8–14 weeks (single dev)
  - Polished 1.0: 12–20 weeks
- Pros
  - Best platform fit, animations, HIG alignment
  - First-class iOS APIs (ShareSheet, Widgets, Background tasks) with minimal friction
- Cons
  - Full rewrite, least reuse of existing code
  - Larger testing surface and longer dev time
- Key considerations
  - Auth: Amplify/AuthKit or raw OAuth with ASWebAuthenticationSession
  - Image pipeline: PHPicker/Camera → CoreImage/CIImage → JPEG resize → presigned POST (URLSession)
  - Persistence: Core Data, SQLite, or GRDB
  - Testing: XCTest + XCUITest; snapshot tests for views

- Rough timeline (single dev)
  - Weeks 1–2: Project structure, networking, models, Cognito, keychain/session
  - Weeks 3–6: Screens/state, image picker/camera, HEIC→JPEG, upload, caching, offline
  - Weeks 7–8: A11y, iPad/landscape, error states, testing
  - Weeks 9–10: QA, perf, TestFlight; App Store assets/privacy
  - Weeks 11–20 (optional): advanced UX, background tasks, deep links, widgets

---

## Shared App Store considerations
- Apple Developer Program membership
- App Store listing: icons, screenshots, description, keywords, support URL, privacy policy
- Privacy nutrition label; tracking declarations if analytics used
- Review timeline: typically 3–7 days on first submission; resubmissions faster
- Sign in with Apple: required if you add third-party sign-in providers (Google/Facebook). Not required for email/password only.

## Decision drivers
- Time-to-store vs native fidelity
- Team familiarity (React Native vs SwiftUI)
- Future Android support needs
- Willingness to maintain two UI stacks vs one

## Suggested next step
- If speed-to-store is priority: prototype Capacitor in a spike branch and test auth + uploads on a real device (1–2 days).
- If native is the goal: start a 1-week spike in React Native (Expo) to validate auth, image picker, and upload; then commit to RN or pivot to SwiftUI if you prefer full native.
