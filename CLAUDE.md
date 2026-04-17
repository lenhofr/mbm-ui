# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Meals by Maggie (mbm-ui) is a React + TypeScript SPA for storing, searching, and sharing recipes with images and ratings. It runs as a PWA backed by AWS (Cognito auth, API Gateway + Lambda, DynamoDB, S3 images, CloudFront CDN). Infrastructure is fully managed via Terraform.

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

## Conventions

- **Styling:** Each component has its own `.css` file. No CSS-in-JS or utility framework — plain CSS with `theme.css` for light/dark variables.
- **Storage ops are always async** — even `LocalAdapter` returns Promises.
- **Error messages** use kitchen-themed text (see `App.tsx`).
- **Pre-commit hook** enforces `terraform fmt` — run `npm run install-hooks` after cloning.
- **Terraform state** is remote (S3 + DynamoDB locking); see `terraform/README.md` before running `plan`/`apply`.
