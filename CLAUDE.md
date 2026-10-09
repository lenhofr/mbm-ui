# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Meals by Maggie (mbm-ui) is a React + TypeScript SPA for storing, searching, and sharing recipes with images and ratings. It runs as a PWA backed by AWS (Cognito auth, API Gateway + Lambda, DynamoDB, S3 images, CloudFront CDN). Infrastructure is fully managed via Terraform.

A native SwiftUI iPhone/iPad app lives in `ios/` (see "iOS App" below). It is a second client for the same API.

## Commands

```bash
npm run dev          # Vite dev server on localhost:5173
npm run build        # Build SPA to dist/
npm run preview      # Preview built app on port 4173
npm test             # Vitest (jsdom environment)

# iOS-specific testing
npm run test:ios-overflow   # Check horizontal overflow on iPhone 12/SE via WebKit
npm run browser:install-webkit  # Install WebKit engine (run once)
npm run ios:open            # Open in iPhone 15 Pro Safari simulator
npm run ios:open:pwa        # Open as PWA on iOS

# Infrastructure
npm run tf:fmt              # Format Terraform files
npm run install-hooks       # Set up git pre-commit hooks (runs tf:fmt check)
```

## Architecture

```
Browser/PWA → CloudFront → S3 (static SPA)
                        → API Gateway → Lambda functions → DynamoDB + S3 (images)
                                     → Cognito (auth)
```

**Auth flow:** Cognito SRP via AWS Amplify. `src/hooks/useCognitoAuth.ts` manages auth state, sign-in/out, and token refresh. JWTs are passed as `Authorization` headers for writes.

**Storage abstraction** (`src/lib/storage.ts`): Defines a common interface (`listRecipes`, `getRecipe`, `createRecipe`, `updateRecipe`, `deleteRecipe`) with two adapters:
- `LocalAdapter` — localStorage with in-memory fallback (used in local dev)
- `RemoteAdapter` — makes authenticated calls to the deployed API

**Search:** Fuse.js with debouncing. Supports scoped queries: `tag:<term>` and `ing:<term>` in addition to full-text.

**Modal pattern:** Modal components render into `document.getElementById('modal-root')` (separate from `#root`).

**PWA:** Service worker at `/sw.js` handles offline caching. `manifest.webmanifest` + Apple-specific meta tags support "Add to Home Screen" on iOS.

## Key Source Layout

```
src/
├── App.tsx                  # Root: recipe CRUD, search state, auth gating
├── main.tsx                 # React root + service worker registration
├── auth/amplify.ts          # Amplify + Cognito SRP config (reads VITE_ env vars)
├── hooks/
│   ├── useCognitoAuth.ts    # Auth state management
│   └── useWakeLock.ts       # Keep screen on during cook mode
├── lib/storage.ts           # Storage adapter abstraction
├── components/              # One .tsx + .css per component
│   ├── RecipeList.tsx       # Card grid with search result highlighting
│   ├── RecipeForm.tsx       # Add/edit form
│   ├── DetailsModal.tsx     # Recipe detail view (editable)
│   ├── CookModal.tsx        # Read-only cook mode
│   └── LoginModal.tsx       # Cognito sign in/up
└── icons/Icons.tsx          # Custom SVG icon components
```

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in:

```
VITE_COGNITO_USER_POOL_ID=
VITE_COGNITO_CLIENT_ID=
VITE_COGNITO_DOMAIN=
VITE_COGNITO_REDIRECT_URI=
VITE_COGNITO_REGION=
VITE_API_BASE=          # API Gateway base URL
```

## iOS App

`ios/MealsByMaggie.xcodeproj` is a native SwiftUI port of the web app (iPhone/iPad only, bundle ID `com.mealsbymaggie.app`). It calls the same API Gateway endpoints; GET routes are public, writes need a Cognito JWT. Login uses Amplify Swift (pinned exact version via Swift Package Manager) against the same user pool and app client as the web (SRP, email as username).

```bash
open ios/MealsByMaggie.xcodeproj    # then ⌘R to run in the simulator
xcodebuild -project ios/MealsByMaggie.xcodeproj -scheme MealsByMaggie \
  -destination 'generic/platform=iOS Simulator' -skipPackagePluginValidation build
```

The first build in Xcode shows a one-time "Trust & Enable" prompt for the `smithy-swift` build plugin (an AWS SDK dependency); `-skipPackagePluginValidation` is the command-line equivalent. Amplify stores the session in the Keychain, so builds must be signed (Xcode does this; for CLI simulator builds use `CODE_SIGN_IDENTITY=-`, not `CODE_SIGNING_ALLOWED=NO`).

The project uses Xcode's synchronized folders: any file added under `ios/MealsByMaggie/` is part of the app automatically, no project file edits needed.

```
ios/MealsByMaggie/
├── MealsByMaggieApp.swift   # App entry; configures Amplify, light mode + plum tint
├── amplifyconfiguration.json # Cognito pool/client IDs (public, same as the web bundle)
├── AuthModel.swift          # Mirrors useCognitoAuth.ts: sign in/up/confirm/out, idToken()
├── LoginView.swift          # Mirrors LoginModal.tsx (invite code sign-up) + AccountView
├── Theme.swift              # Colors/fonts ported from src/tokens.css, TagChip, FlowLayout
├── Fonts/                   # Lobster, Poppins, Inter (registered at runtime, no Info.plist entries)
├── Recipe.swift             # Mirrors Recipe in src/types.ts; imageURL mirrors resolveImageUrl
├── RecipeAPI.swift          # Mirrors RemoteAdapter (storage.ts) + uploadImage (images.ts)
├── RecipeStore.swift        # Shared recipe list + save/delete + toast (AppContext.tsx)
├── RecipeDraft.swift        # Editor state + conversions (draft.ts), parseIngredientLine port (quantity.ts)
├── RecipeListView.swift     # HomeScreen.tsx + floating "+" add button
├── RecipeDetailView.swift   # DetailScreen.tsx; edit pencil when signed in
├── RecipeEditorView.swift   # EditorScreen.tsx (manual add/edit/delete, camera/library photo)
├── CookView.swift           # CookScreen.tsx (screen stays on, progress saved in UserDefaults)
└── IngredientChecklist.swift
```

When porting a web screen, read its `.tsx` + `.css` and keep the Swift view's comments pointing at the web source. Styling comes from `Theme.swift`, not ad-hoc colors.

## Conventions

- **Styling:** Each component has its own `.css` file. No CSS-in-JS or utility framework — plain CSS with `theme.css` for light/dark variables.
- **Storage ops are always async** — even `LocalAdapter` returns Promises.
- **Error messages** use kitchen-themed text (see `App.tsx`).
- **Pre-commit hook** enforces `terraform fmt` — run `npm run install-hooks` after cloning.
- **Terraform state** is remote (S3 + DynamoDB locking); see `terraform/README.md` before running `plan`/`apply`.
