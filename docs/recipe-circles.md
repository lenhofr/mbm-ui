# Recipe Circles: Groups, Sharing & Per-Recipe Visibility

**Status:** Phase 0 (groundwork) shipped in #136, 2026-10-23. Open questions decided (§14, 2026-10-23); Phase 1 is next. Design Written 2026-10-11 against `main` at the time; current-state notes updated 2026-10-16 for #120 (delete permissions, admins group, recipes backups).
**Scope:** Backend (Lambda + DynamoDB + Terraform), Cognito triggers, web SPA, iOS app, data migration.
**Audience:** The next engineer or AI session that implements this. Read the whole doc once, then work phase by phase (§13). Every decision below has a stated reason. If you change a decision, update this doc in the same PR.

---

## 0. TL;DR

- Today every recipe is world-readable, and **any signed-in user can edit any recipe**. Only deletes are limited: to the recipe's creator or the `admins` Cognito group (#120). There are no other per-user boundaries.
- We introduce:
  - **Owners.** Every recipe has exactly one `ownerSub`.
  - **Circles.** A circle is a named group of users with roles `owner | editor | member`.
  - **Visibility.** The owner can share a recipe into any number of circles they belong to and/or mark it public. New recipes are shared the way the owner shared their last one, starting as public plus all their circles (§14.3), so most recipes stay public. Private is an option, not the default.
- Home shows **"Your kitchen"**: your recipes plus everything shared into your circles, with a filter chip for each circle. Public recipes from strangers move to a separate **Discover** view, so a big public catalog never crowds Home.
- **Deletes:** the recipe owner; super admins (the `admins` Cognito group) for any recipe; a circle owner (Chef de cuisine) for a recipe that's only in circles they run (§14.7).
- Storage:
  - Keep `mbm-recipes` (PK `recipeId`). Add attributes and two GSIs.
  - Add one new single-table `mbm-circles` that holds circles, memberships and share edges.
  - Extend `mbm-invites` codes so a code can drop the user into a circle.
- All authorization lives server-side in one pure module (`authz.py`). Public routes only ever return public data and never read the `Authorization` header. Private data is served only from JWT-authorized `/me/*` routes.
- Migration:
  - Create a founding circle ("Maggie's Kitchen") containing every existing user as `editor`.
  - Share every existing recipe into it and keep it public.
  - Result: **zero visible behavior change on day one**, and old iOS builds keep working.

---

## 1. Current state (verified in code)

File references are relative to the repo root.

### 1.1 Infrastructure (`terraform/app_account/backend_api.tf`)

| Resource | Details |
|---|---|
| `aws_dynamodb_table.recipes` | `mbm-recipes`, PAY_PER_REQUEST, hash key `recipeId` (S). No sort key. GSIs `gsi_owner` and `gsi_public` (§4.3) since Phase 0; both empty until the migration sets `ownerSub`/`publicPk`. |
| `aws_dynamodb_table.circles` | `mbm-circles` (§4.4), added in Phase 0. Empty; nothing reads or writes it yet. |
| `aws_dynamodb_table.ratings` | `mbm-ratings`, hash key `ratingId`. **No client uses ratings** (grep `src/` and `ios/`: no references). |
| `aws_dynamodb_table.invites` | `mbm-invites`, hash `code`, range `sk` (`META` / `USE#<iso>#<email>`). GSI `gsi_email` (email, usedAt). Supports `maxUses`, `uses`, `unlimited`, `revoked`, `expiresAt`. |
| `aws_lambda_function.recipes_fn` | `mbm-recipes-fn`, python3.10, `lambda/recipes/app.py`. Handles recipes and AI extract (ratings removed in #126). Role `lambda_exec`. |
| `aws_lambda_function.images_fn` | `mbm-images-fn`. Own role `images_exec` (S3 get/put + logs, no DynamoDB) since Phase 0. |
| `aws_lambda_function.cognito_pre_signup` | `lambda/auth/pre_sign_up.py`. Consumes the invite code atomically with `TransactWriteItems`. |
| `aws_cognito_user_pool.mbm` | Email as the username. Custom attribute `custom:invite`. Only the `pre_sign_up` trigger is configured. |
| `aws_apigatewayv2_authorizer.cognito_jwt` | JWT authorizer. Audience is the SPA client id. Clients send the **ID token** (`storage.ts` `getAuthHeader`, `RecipeAPI.swift`). |
| IAM `lambda_policy` | `PutItem, GetItem, Query, Scan, UpdateItem, DeleteItem` on the recipes and ratings table ARNs only. No index ARNs, no batch or transact actions. |

Routes (see `aws_apigatewayv2_route.*`):

| Route | Auth |
|---|---|
| `GET /recipes`, `GET /recipes/{id}`, `GET /ratings`, `GET /images/{key+}` | **none** |
| `POST /recipes`, `PUT /recipes/{id}`, `DELETE /recipes/{id}`, `POST /ratings`, `POST /ai/extract-recipe`, `POST /images` | JWT |

### 1.2 Recipes Lambda (`terraform/app_account/lambda/recipes/app.py`)

> **Since #126 and Phase 0** several bullets below describe the old code and are kept for the reasoning. Now: `router.py` matches the event to a `ROUTES` dict in `app.py` (one handler per route); `repo.py` holds DynamoDB access (`scan_all`, `query_all`, `batch_get`, `to_jsonable`; table names read from env when used); `recipe_input.py` is the §7.3 validation (the plan called it `validation.py`); `authz.py` is §5, tested but not yet called. The list is paginated, bodies are allow-listed, PUT is an `UpdateItem`, and identity comes only from verified claims.

- **Routing.** A long chain of `if route_key == ...` blocks, plus fallback path matching for tests. Tests invoke with only `requestContext.http.method` and `rawPath`, with no `routeKey`.
- **`GET /recipes`** runs `table.scan()` **without pagination**. DynamoDB returns at most 1 MB per scan page, so past roughly 200–500 recipes the list will be **silently truncated**. This is a latent bug that exists independently of this feature.
- **`POST /recipes`** builds the item as `{'recipeId': ..., **body, 'createdAt': ..., ...}`. The body is spread in **unfiltered**, so clients can write arbitrary attributes. This is mass assignment.
- **`PUT /recipes/{id}`**:
  - Does `get_item` and then `put_item` of `{**kept, **body, created*..., updated*...}`.
  - `kept` holds the non-editable existing fields. `body` is spread in **unfiltered**, so a client can overwrite any non-`created*`/`updated*` attribute.
  - It also replaces the whole item, so a concurrent change to any other attribute is lost (last writer wins).
  - **No ownership check.**
- **`DELETE /recipes/{id}`** (since #120): allowed only if the caller's `sub` equals the recipe's `createdBySub`, or the caller is in the `admins` Cognito group (read from the `cognito:groups` claim). Otherwise 403. Recipes with no `createdBySub` are admin-only; as of 2026-10-16 all recipes have one. A missing recipe returns 204. The web and iOS editors hide Delete for callers who can't use it.
- **`admins` Cognito group** (`aws_cognito_user_group.admins`, #120): two members as of 2026-10-16. Members are added by hand in the Cognito console. It is the admin role §6.8 and §14.2 refer to.
- **Backups:** `mbm-recipes` has point-in-time recovery on (#120).
- **`get_identity()`**:
  - Reads JWT claims from `requestContext.authorizer.jwt.claims`.
  - Falls back to **decoding the bearer token without verifying it**. That's safe today only because identity is used solely on JWT-authorized routes.
  - **Never use that fallback for authorization.** §7.1 removes it from decision paths.
- `EDITABLE_FIELDS = ('title','description','image','tags','ingredients','instructions','servings','cookTime')` already exists. Reuse it as the allow-list.

### 1.3 Images (`lambda/images/app.py`)

- Uploads go to keys of the form `uploads/<uuid4hex><ext>`. That's 128 bits, so the keys are unguessable.
- `GET /images/{key}` 302-redirects to a presigned GET URL. It is a public route. Images are never deleted by the recipes Lambda.

### 1.4 Clients

- **Web.**
  - `src/lib/storage.ts`: `RemoteAdapter.listRecipes()` calls `GET /recipes`. It sends the ID token when signed in, which is ignored today.
  - `src/state/AppContext.tsx`: `reload()` runs once on mount (`useEffect(() => { reload() }, [reload])`) and **does not re-run on sign-in/out**. That has to change once the list depends on identity.
  - `src/screens/DetailScreen.tsx:92`: the edit pencil shows whenever `app.auth.isAuthed`.
  - Favorites live in localStorage, keyed by sub (`src/lib/favorites.ts`).
  - Routes are in `src/App.tsx`: `/`, `/favorites`, `/recipe/:id`, `/recipe/:id/cook`, `/recipe/:id/edit`, `/new`, `/scan`, `/import`, `/import/failed`.
  - `TabBar` has Recipes, a "+" button, and Favorites.
- **Service worker** (`public/sw.js`). It only caches same-origin GETs. The API is cross-origin (API Gateway domain), so **API responses are not cached by the SW**. Keep it that way: private recipe JSON must never land in a shared Cache Storage.
- **iOS.**
  - `RecipeAPI.listRecipes()` calls `GET /recipes` **anonymously** (no token).
  - `RecipeDetailView` shows edit whenever `auth.isSignedIn`.
  - **Installed old builds can't be force-updated**, so the public routes must stay backward compatible (§8.1).

---

## 2. Goals / non-goals

**Goals**
1. Users can keep recipes private, share them with specific groups, and/or publish them.
2. Users can belong to several circles (family, friends, book club).
3. Home is scoped to "my world" by default. Public content is opt-in.
4. Authorization is enforced server-side, centralized, unit-tested, and fails closed.
5. No visible behavior change at migration time. Old clients keep working.
6. Operational simplicity: serverless, PAY_PER_REQUEST, no new services.

**Non-goals (for v1)**
- Nested or transitive groups. See §12 for "linked circles" as a future, explicit, one-hop alternative.
- Per-recipe ACLs to individual users. Use a 2-person circle instead.
- Real-time collaboration or edit history. Optimistic locking is enough.
- Server-side full-text search. Fuse.js stays client-side over the user's feed.
- Org-level billing or admin consoles.

---

## 3. Domain model & vocabulary

- **User**: a Cognito identity, keyed by `sub` (immutable). Never key anything by email, because email is mutable.
- **Recipe**: owned by exactly one user (`ownerSub`). Ownership can be transferred (§6.6).
- **Circle**: a named group. In code it's always called `circle`. In the UI it's a **brigade** (§3.2).
- **Membership**: (circle, user, role).
- **Share edge**: (circle, recipe). It means the recipe is visible to the circle's members.
- **Public**: a recipe flag. Public recipes are readable by anyone, including anonymous users.

A recipe's **audience** is `{owner} ∪ members(c) for c in recipe.circleIds ∪ (everyone if public)`.

### 3.1 Roles & permission matrix

Roles rank as `member < editor < owner`.

| Action | Recipe owner | Circle `owner` | Circle `editor` | Circle `member` | Signed-in stranger | Anonymous |
|---|---|---|---|---|---|---|
| Read recipe | ✅ | ✅ if shared to circle | ✅ if shared | ✅ if shared | public only | public only |
| Edit recipe content (`EDITABLE_FIELDS`) | ✅ | ✅ if shared | ✅ if shared | ❌ | ❌ | ❌ |
| Delete recipe | ✅ | ✅ if every circle it's in is one they own | ❌ | ❌ | ❌ | ❌ |
| Change sharing (public flag, add/remove circles) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Remove a recipe from *this* circle (unshare) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Share *own* recipe into circle | – | ✅ | ✅ | ✅ | ❌ | ❌ |
| Copy ("Save to my recipes") | ✅ | ✅ if readable | ✅ if readable | ✅ if readable | ✅ if public | ❌ |
| Create invite code for circle | – | ✅ | ✅ | ❌ | ❌ | ❌ |
| Change member roles / remove others | – | ✅ | ❌ | ❌ | ❌ | ❌ |
| Leave circle | – | ✅ unless last owner | ✅ | ✅ | – | – |
| Rename / delete circle | – | ✅ | ❌ | ❌ | ❌ | ❌ |

**Super admins** (the `admins` Cognito group, members added by hand) can read and delete any recipe, as since #120 (§14.7). They get no edit or sharing rights from that alone.

The `member` (Commis, read-only) role exists in code but isn't offered in the v1 UI: everyone joins as `editor`, so brigade members can edit each other's shared recipes (§14.4).

Rationale:
- **Editors may edit content but not sharing.** Otherwise an editor in circle A could make a recipe public, or push it into circle B. That is privilege escalation across audiences, so content edits and sharing are **separate endpoints** (§7).
- **Deleting is narrow.** The owner and super admins can delete. A circle owner can delete only a recipe that lives entirely in circles they run, because deleting a recipe that's also in another brigade would destroy it for people that chef doesn't answer for. Otherwise a circle owner or editor can unshare it from their circle, which removes it from that audience without destroying it.
- `editor` keeps today's family behavior, where everyone edits everything. The migration (§10) makes all current users editors of the founding circle.

### 3.2 UI naming: the kitchen brigade

**Decision (2026-10-17):** in the UI, a circle is a **brigade**, after Escoffier's *brigade de cuisine*. Escoffier brought the discipline he saw in the French army during the Franco-Prussian War into the kitchen and gave every cook a defined station. The three circle roles map onto the brigade's best-known ranks.

**Only display strings change.** Code, API paths, table keys, item types and log fields all keep `circle`, `owner`, `editor` and `member`. Renaming a label later should be a one-file change; renaming stored keys never should be.

| Code | UI label | Short form (chips, badges) | Plain description, shown under the label |
|---|---|---|---|
| `circle` | Brigade (plural: Brigades) | – | A group of people who share recipes |
| `owner` | Chef de cuisine | Chef | Runs the brigade: renames it, sets roles, removes people |
| `editor` | Sous-chef | Sous-chef | Edits the brigade's recipes and invites people |
| `member` | Commis | Commis | Cooks from the brigade's recipes and shares their own. **Not offered in the v1 UI** (§14.4). |

**Copy rules**
- **Always pair a French role with its plain description** wherever someone picks or reads a role: the role picker, the member list, and the invite role selector. Many users won't know the terms, and the description is what tells them what they can do.
- **Keep the hierarchy light.** Escoffier's brigade was strict; this app is a family sharing recipes. In the UI:
  - say "Change role", "Make Sous-chef" or "Make Commis", not "promote", "demote" or "rank";
  - keep "Leave brigade" visible on the brigade screen, never buried in a menu.
- **Brigade names stand alone.** Home filter chips show only the brigade's name ("Lenhof Family"), not "Lenhof Family Brigade", to keep chips short on an iPhone SE.
- **The founding circle keeps its name**, "Maggie's Kitchen". A brigade called Maggie's Kitchen reads fine.
- **No accents needed.** "Sous-chef", "Chef de cuisine" and "Commis" are written without diacritics in English, so there's no special handling for search or sorting.

**Strings** (keep them in one module per client, `src/lib/brigadeCopy.ts` and `ios/MealsByMaggie/BrigadeCopy.swift`, so a future rename touches only those two files):

| Where | String |
|---|---|
| Account sheet entry | Your brigades |
| Brigades list, empty state | You're not in a brigade yet. Start one, or ask for an invite code. |
| Create button / name placeholder | Start a brigade / e.g. Lenhof Family |
| Explainer (one tappable line on `/brigades`) | What's a brigade? Chef Auguste Escoffier organized his kitchens into a *brigade de cuisine*, where every cook had a role. Yours works the same way, with less shouting. |
| Invite button / share-sheet text | Invite to brigade / Join my brigade on Meals by Maggie: {url} |
| Join screen title / button | You're invited to join {brigadeName} / Join the brigade |
| Join success toast | Welcome to {brigadeName}! |
| Role change notice | {actorName} made you a {roleLabel} |
| Leave button / confirm | Leave brigade / Your recipes stay with the brigade. You can still edit them or stop sharing them. (matches §6.5) |
| Delete button / confirm | Delete brigade / Recipes stay with their owners; they're just no longer shared here. |
| ShareSheet heading | Share with your brigades |
| Editor sharing row | Sharing: {brigadeName or "Only me"} ▸ |
| Detail badge | In {brigadeName} (or "In {n} brigades") |
| Last owner can't leave (400 from I3) | Every brigade needs a Chef. Make someone else Chef before you leave. |

---

## 4. Data design

### 4.1 Why two tables instead of one single table

The canonical single-table design would move recipes into `pk=RECIPE#id, sk=META`. That would mean:
- rewriting every item,
- changing the key schema, which needs a new table plus a copy, and
- breaking the existing tests and any ad-hoc scripts (`scripts/backfill-recipe-names.mjs`, `scripts/optimize-s3-images.mjs`).

Recipes are large documents and have no item-collection access pattern of their own. So:
- **Keep `mbm-recipes`** as the document store, keyed by `recipeId`, and add GSIs.
- **Add `mbm-circles`** as a single table for the *relationship graph*: circles, memberships and share edges. This is where item collections pay off (`pk=CIRCLE#id` returns the meta, members and shares in one partition).

DynamoDB transactions work across tables in the same account and region, so the two stores can still be updated atomically (§6.3).

### 4.2 `mbm-recipes`: new attributes

| Attribute | Type | Meaning | Written by |
|---|---|---|---|
| `ownerSub` | S | Cognito sub of the owner. **Required** after migration. | server only |
| `ownerName` | S | Display name at creation or transfer, for UI only | server only |
| `publicPk` | S | Literal `"PUBLIC"` when the recipe is public. **Attribute absent when private.** It's the sparse GSI hash key. | server only |
| `circleIds` | SS | String set of circle ids the recipe is shared into. **Absent when empty** (DynamoDB sets can't be empty). | server only |
| `version` | N | Optimistic-lock counter, starting at 1 and incremented on every write | server only |
| `sourceRecipeId` | S | Set when the recipe was copied from another | server only |
| `sourceOwnerName` | S | Attribution for copies | server only |
| `schemaV` | N | `2` after migration. It makes the migration script idempotent. | server only |

Existing attributes are unchanged: `recipeId`, `EDITABLE_FIELDS`, `created*`, `updated*`, `createdAt` and `updatedAt` (N, epoch seconds).

**API shape vs storage shape.** The API never exposes `publicPk` or raw `circleIds`. `map_recipe_out()` converts them (§7.4):
- `publicPk` becomes `isPublic: boolean`.
- `circleIds` becomes `sharedIn: string[]`, filtered to circles the caller belongs to. The owner sees all of them.
- An `access` object is added.

### 4.3 `mbm-recipes`: new GSIs

```hcl
# Add to aws_dynamodb_table.recipes
attribute { name = "ownerSub"  type = "S" }
attribute { name = "publicPk"  type = "S" }
attribute { name = "updatedAt" type = "N" }

global_secondary_index {
  name            = "gsi_owner"
  hash_key        = "ownerSub"
  range_key       = "updatedAt"
  projection_type = "ALL"
}

global_secondary_index {
  name            = "gsi_public"        # sparse: only items with publicPk
  hash_key        = "publicPk"
  range_key       = "updatedAt"
  projection_type = "ALL"
}
```

Notes:
- **`projection_type = ALL`** is deliberate. The feed needs full documents for client-side Fuse search. Items are a few KB and traffic is tiny, so storage cost doesn't matter.
- `gsi_public` has a single hash key value, which makes it a hot partition in theory. At this scale (well under 1,000 WCU / 3,000 RCU per partition) it's fine. If it ever matters, write-shard with `publicPk = "PUBLIC#<0-9>"` and fan out the query.
- `updatedAt` must exist for an item to appear in either GSI, because the range key is required in the index. The migration backfills `updatedAt = createdAt or now` wherever it's missing.
- Adding GSIs to an existing table is an in-place update. DynamoDB backfills the index automatically. Terraform allows **only one GSI create per apply** on a table in some provider versions, so if `apply` fails with `LimitExceededException`, add them in two applies.

### 4.4 `mbm-circles`: single table

```hcl
resource "aws_dynamodb_table" "circles" {
  name         = "mbm-circles"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute { name = "pk"     type = "S" }
  attribute { name = "sk"     type = "S" }
  attribute { name = "gsi1pk" type = "S" }
  attribute { name = "gsi1sk" type = "S" }

  global_secondary_index {
    name            = "gsi1"          # inverted index: user -> circles
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }   # mbm-recipes already has it (#120)

  tags = { Name = "mbm-circles" }
}
```

Item types:

| Entity | `pk` | `sk` | `gsi1pk` | `gsi1sk` | Other attributes |
|---|---|---|---|---|---|
| Circle meta | `CIRCLE#<cid>` | `META` | – | – | `name`, `emoji?`, `createdBySub`, `createdAt`, `memberCount` (N), `ownerCount` (N), `deleting?` (BOOL), `version` (N) |
| Membership | `CIRCLE#<cid>` | `MEMBER#<sub>` | `USER#<sub>` | `CIRCLE#<cid>` | `role` (`owner`/`editor`/`member`), `displayName`, `circleName` (denormalized), `joinedAt`, `invitedBy?`, `inviteCode?` |
| Share edge | `CIRCLE#<cid>` | `RECIPE#<rid>` | – | – | `sharedBySub`, `sharedAt` |

- `cid` is a `uuid4` hex. `rid` is the existing `recipeId`.
- **Share edges carry no recipe content.** That way there's nothing to go stale. Recipes are always read from `mbm-recipes`.
- `circleName` is denormalized onto memberships so that "list my circles" is a single GSI query. A rename fans out to every membership item. Renames are rare and circles are small.
- `memberCount` and `ownerCount` are maintained with `ADD` inside the same transactions that add or remove members. `ownerCount` enforces invariant I3 ("at least one owner") with a condition expression instead of a read-then-write.

### 4.5 Invariants

| ID | Invariant | Enforced by |
|---|---|---|
| I1 | A share edge `CIRCLE#c / RECIPE#r` exists **iff** `c ∈ recipes[r].circleIds` | Every mutation touches both in one `TransactWriteItems`. `scripts/reconcile-circles.mjs` detects and repairs drift. |
| I2 | A recipe is *added* to `c` only by an owner who is a member of `c` at that moment. It stays shared after the owner leaves or is removed (§14.6). | `ConditionCheck` on the owner's `MEMBER#` item in the sharing transaction. No cascade on leave/remove (§6.5). |
| I3 | Every non-deleting circle has `ownerCount ≥ 1` | Condition `ownerCount > :one` on demote, remove or leave of an owner |
| I4 | `ownerSub`, `publicPk`, `circleIds`, `version`, `created*`, `updated*`, `recipeId` are never taken from a request body | Allow-list in `parse_recipe_body()` (§7.3) |
| I5 | Public routes never return a non-public recipe and never read `Authorization` | Route design (§7.1) plus tests |
| I6 | Circle ids stored on a recipe are not leaked to non-members | `map_recipe_out()` intersects with the caller's memberships |

### 4.6 Access patterns

| # | Pattern | Operation |
|---|---|---|
| AP1 | Get recipe by id | `mbm-recipes` GetItem `recipeId` |
| AP2 | List my own recipes, newest first | `mbm-recipes` Query `gsi_owner` `ownerSub = :sub`, `ScanIndexForward=false` |
| AP3 | List public recipes, newest first | `mbm-recipes` Query `gsi_public` `publicPk = "PUBLIC"`, `ScanIndexForward=false` |
| AP4 | List my circles (with role and name) | `mbm-circles` Query `gsi1` `gsi1pk = USER#<sub>` and `begins_with(gsi1sk, "CIRCLE#")` |
| AP5 | Circle meta, members and shares in one call | `mbm-circles` Query `pk = CIRCLE#<cid>` |
| AP6 | Members of a circle | Query `pk = CIRCLE#<cid>`, `begins_with(sk, "MEMBER#")` |
| AP7 | Recipe ids shared into a circle | Query `pk = CIRCLE#<cid>`, `begins_with(sk, "RECIPE#")` |
| AP8 | Is user X a member of circle C, and with what role? | GetItem `CIRCLE#<cid>` / `MEMBER#<sub>` |
| AP9 | Fetch many recipes by id | `BatchGetItem` on `mbm-recipes`, chunks of 100, retry `UnprocessedKeys` |
| AP10 | Look up an invite or join code | `mbm-invites` GetItem `code` / `META` (existing) |

---

## 5. Authorization module (`lambda/recipes/authz.py`)

This module is pure and does no I/O, so it's trivially unit-testable. Every handler loads the recipe and the caller's memberships, then asks this module.

Built in Phase 0: [`terraform/app_account/lambda/recipes/authz.py`](../terraform/app_account/lambda/recipes/authz.py), tested by `tests/test_authz.py` against the §3.1 matrix. The code is the spec; in short:

- `Caller(sub, name, memberships, is_admin)`. `is_admin` comes from `cognito:groups` containing `admins`.
- `recipe_access(caller, recipe) -> Access(can_read, can_edit, can_delete, can_share, relation)`, where `relation` is `owner | circle-editor | circle-member | public | admin | none`.
  - Owner: everything.
  - Best role across the recipe's circles the caller is in: `editor`/`owner` can read and edit, `member` can read.
  - `can_delete` also holds for a super admin, and for a circle owner when the recipe is in at least one circle and the caller owns every one of them.
  - Public: read. A super admin with no other relation: read and delete (`admin`).
- `can_share_into`, `can_unshare_from`, `can_manage_circle`, `visible_circle_ids` as named.
- `Access.to_json()` is the `access` object in responses (§7.4).


**Fail-closed rules**
- A missing `ownerSub` means nobody is treated as the owner. The migration must set it on every item, and the reconcile script flags any item without it.
- An unknown role string ranks as 0.
- A membership in a circle with `deleting = true` is filtered out when loading memberships, so it grants nothing.

**Status codes**
- Not readable: return **404** (same body as a truly missing recipe), so recipe ids can't be used to probe whether something exists.
- Readable but the action isn't allowed: **403**.
- Optimistic-lock conflict: **409** with the current recipe in the body.

**Loading the caller** (`load_caller(event)`):
1. Read `sub` and `name` **only** from `requestContext.authorizer.jwt.claims`. On public routes, the caller is always anonymous.
2. Run AP4 to get memberships. Paginate, but expect one page.
3. Cache the memberships in a module-level dict keyed by `(sub, request_id)`, scoped to the invocation. **Don't cache across invocations.** A revoked membership has to take effect immediately.

---

## 6. Write flows (transactions)

All multi-item writes use the low-level `boto3.client('dynamodb').transact_write_items`. Conditions always include the caller-derived facts that the authz decision relied on, so a race between the check and the write fails safely.

### 6.1 Create recipe: `POST /recipes`

Request body:

```json
{ "...EDITABLE_FIELDS": "...",
  "sharing": { "isPublic": false, "circleIds": ["c1"] } }
```

`sharing` is optional. Without it the recipe is **public with no circles** (or the founding circle too, while `LEGACY_DEFAULT_SHARE=founding`, §8.1). New clients always send it: the user's last choice, starting as public plus all their circles (§14.3, §9.1).

1. `fields = parse_recipe_body(body)`. This keeps the allow-list only, validates types and sizes (§7.3), and drops everything else.
2. Validate `sharing.circleIds`: there can be at most 20, and each needs `can_share_into(caller, cid)`.
3. Transaction:
   - `Put` the recipe, with the condition `attribute_not_exists(recipeId)`. Item: `recipeId`, fields, `ownerSub = caller.sub`, `ownerName`, `created*`, `updated*`, `version = 1`, `schemaV = 2`, plus `publicPk` if public and `circleIds` if non-empty.
   - For each cid:
     - `ConditionCheck` that `CIRCLE#cid / MEMBER#caller.sub` exists. This enforces I2.
     - `ConditionCheck` that `CIRCLE#cid / META` has `attribute_not_exists(deleting)`.
     - `Put` the share edge.
4. Return `201` with `map_recipe_out(item, caller)`.

The transaction limit is 100 actions. 20 circles × 3 actions + 1 = 61 actions, which is fine.

### 6.2 Edit recipe content: `PUT /recipes/{id}`

The body contains only `EDITABLE_FIELDS`, plus an optional `version`. Any sharing keys are **ignored** (I4).

1. GetItem the recipe. If missing, return 404.
2. Run `recipe_access`. If `!can_read`, return 404. If `!can_edit`, return 403.
3. Build an **UpdateItem**. **Don't use PutItem.** It replaces the whole item, which would clobber concurrent sharing changes and server attributes.
   - `SET` each editable field present in the body.
   - `REMOVE` each editable field absent from the body. This preserves the current "cleared in editor means removed" semantics from `test_update_clears_fields_left_out_of_the_body`.
   - `SET updatedAt, updatedBySub, updatedByName`, and `ADD version :one`.
   - `ConditionExpression`:
     - always: `attribute_exists(recipeId)`
     - if the client sent `version`: `AND version = :v`
     - if the caller's access came from a circle and not ownership: `AND (ownerSub = :sub OR contains(circleIds, :cid1) OR contains(circleIds, :cid2) ...)`, listing the caller's editor-or-higher circles that granted access.

     The circle condition makes sure the recipe wasn't unshared between the read and the write. Cap the condition at the first 10 granting circles. That's plenty.
   - `ReturnValues = ALL_NEW`.
4. If `ConditionalCheckFailed` and `version` was sent, return 409 with the current item. Otherwise re-evaluate: return 404 if the recipe disappeared, or 403 if access was lost.

Helper sketch:

```python
def build_content_update(fields: dict, ident: dict, now: int):
    sets, removes, names, values = [], [], {}, {}
    for i, f in enumerate(EDITABLE_FIELDS):
        names[f"#f{i}"] = f
        if f in fields:
            sets.append(f"#f{i} = :f{i}")
            values[f":f{i}"] = fields[f]
        else:
            removes.append(f"#f{i}")
    sets += ["updatedAt = :now", "updatedBySub = :usub", "updatedByName = :uname"]
    values |= {":now": now, ":usub": ident["sub"], ":uname": ident["name"], ":one": 1}
    expr = "SET " + ", ".join(sets)
    if removes:
        expr += " REMOVE " + ", ".join(removes)
    expr += " ADD version :one"
    return expr, names, values
```

Use `boto3.resource` Table `update_item` here. It handles Python types and `Decimal`. Use the low-level client only for transactions. With the client, use `boto3.dynamodb.types.TypeSerializer` to marshal values.

**Legacy clients and `version`.** Old clients don't send `version`, so their writes are unconditional on version: last writer wins, exactly as today. New clients always send it.

### 6.3 Change sharing: `PUT /recipes/{id}/sharing`

Body: `{ "isPublic": bool, "circleIds": [..], "version"?: n }`. This is the **full desired state**, not a delta, which makes it idempotent.

1. GetItem the recipe. It must be readable (else 404), and `access.can_share` must hold, meaning owner only (else 403).
2. Compute `toAdd = desired - current` and `toRemove = current - desired`.
   - Every cid in `toAdd` must pass `can_share_into`. If not, return 400 with the list of invalid ids.
   - Ids in `toRemove` don't need a membership check, because the owner may always unshare.
3. Transaction:
   - `Update` the recipe:
     - `SET circleIds = :set` (or `REMOVE circleIds` if empty)
     - `SET publicPk = :pub` or `REMOVE publicPk`
     - `SET updatedAt = :now`
     - `ADD version :one`
     - Condition: `ownerSub = :sub` (plus `version = :v` if sent)
   - For each add: `ConditionCheck` the owner's membership exists, `ConditionCheck` the circle isn't deleting, and `Put` the edge.
   - For each remove: `Delete` the edge with no condition, so the operation is idempotent.
4. If the total number of actions exceeds 100, return 400. That needs more than about 33 added circles, and the cap is 20.

Making a recipe public is a meaningful privacy action, so the UI needs an explicit confirmation (§9.3).

### 6.4 Delete recipe: `DELETE /recipes/{id}`

1. GetItem. Not readable gives 404. Not `can_delete` gives 403. `can_delete` holds for the owner, a super admin, or a circle owner of every circle the recipe is in (§3.1).
2. Transaction: `Delete` the recipe, plus `Delete` the edge for each cid in `circleIds`. The recipe's condition restates why the delete was allowed:
   - owner: `ownerSub = :sub`
   - circle owner: `circleIds = :seen` (the set read in step 1), so a recipe shared into another brigade in the meantime isn't deleted. Also `ConditionCheck` each `MEMBER#caller` still has `role = owner`.
   - super admin: `attribute_exists(recipeId)`

Today's check (#120) compares `createdBySub` instead. The migration copies `createdBySub` into `ownerSub` (§10), so switching the check over is safe once it has run.
3. Images are not deleted. That's the current behavior, and copies may reference the same key if §6.7 option B is chosen. Image garbage collection is out of scope.

### 6.5 Circle lifecycle

**Create: `POST /circles {name, emoji?}`**
- One transaction:
  - `Put` `META` with condition `attribute_not_exists(pk)`, `memberCount = 1`, `ownerCount = 1`.
  - `Put` `MEMBER#caller` with `role = owner` and `gsi1*` set.
- Each user can belong to at most 50 circles. Check the AP4 count first. This is a soft limit, so a race is acceptable.

**Rename: `PATCH /circles/{cid} {name?, emoji?}`** (circle owner)
- Update `META`, then fan out a `circleName` update to every membership (AP6 + UpdateItem per member).
- The fan-out is not transactional. If it partially fails, the names are only cosmetically stale, and the reconcile script fixes them.

**Add member.** This happens via a join code (§6.8) or the post-confirmation trigger (§6.9). Transaction:
- `Put` `MEMBER#sub`, condition `attribute_not_exists(sk)`.
- `Update` `META`: `ADD memberCount :one`, condition `attribute_not_exists(deleting)`.

**Change role: `PUT /circles/{cid}/members/{sub} {role}`** (circle owner)
- Transaction: `Update` the member's `role`. If an owner is being demoted, also `Update` `META` with `ADD ownerCount :neg1` and condition `ownerCount > :one`. If someone is being promoted to owner, `ADD ownerCount :one`.

**Remove member or leave: `DELETE /circles/{cid}/members/{sub}`**
- Allowed when caller == sub (leaving) or the caller is a circle owner.
- Steps:
  1. Transaction:
     - `Delete` `MEMBER#sub`.
     - `Update` `META` with `ADD memberCount :neg1`.
     - If the member was an owner, also `ADD ownerCount :neg1` with condition `ownerCount > :one` (I3).
- **No cascade.** The departing cook's recipes stay shared into the circle (§14.6), so the family keeps grandma's recipes when grandma leaves.
  - The departed cook loses access to the circle's other recipes immediately, because their membership is gone.
  - They still own their recipes, so they can still edit them or unshare them from the circle. They can't share anything new into it.
  - The circle's owners can unshare those recipes, or delete one that's only in circles they run (§6.4).

**Delete circle: `DELETE /circles/{cid}`** (circle owner)
1. `Update` `META` with `SET deleting = :true`. From now on, authz ignores this circle (§5).
2. Query `pk = CIRCLE#cid` and handle each item by type:
   - `RECIPE#rid`: transaction `Update` the recipe with `DELETE circleIds :cidSet` and `Delete` the edge.
   - `MEMBER#sub`: `Delete`. Batch these with `BatchWriteItem` in groups of 25.
3. Delete `META` last.
4. The whole process is idempotent and restartable. If it's interrupted, the reconcile script resumes any circle that still has `deleting = true`.

### 6.6 Transfer ownership: `POST /recipes/{id}/transfer {toSub}`

This is v1.1 and optional. Allowed when the caller is the owner and `toSub` shares at least one circle with the caller.
- Update `ownerSub` and `ownerName` with condition `ownerSub = :caller`.
- Sharing is left as it is (I2 only applies when adding a circle).

This is useful when a cook wants someone else to look after their recipes, e.g. before deleting their account.

### 6.7 Copy a recipe: `POST /recipes/{id}/copy`

1. The source must be readable by the caller. Otherwise return 404.
2. New item:
   - copy the `EDITABLE_FIELDS` and set a new `recipeId`
   - `ownerSub = caller`
   - private, with no circles
   - `sourceRecipeId`, `sourceOwnerName`
   - `version = 1`
3. Image handling:
   - **Option A (recommended).** Server-side S3 `CopyObject` to `uploads/<newuuid><ext>`. Ownership of the bytes is clean and future image GC stays simple. The recipes Lambda already has `s3:GetObject`/`PutObject` on the bucket, and `IMAGES_BUCKET` is already in its env.
   - Option B. Reference the same key. Cheaper, but any future image deletion would then need reference counting.
4. Return 201 with the new recipe. The client navigates to it in edit mode.

### 6.8 Circle invites & join codes (reuse `mbm-invites`)

Extend `META` items in `mbm-invites` with these optional attributes:

| Attribute | Meaning |
|---|---|
| `circleId` | Joining with this code adds the user to this circle |
| `circleRole` | `member` or `editor` (never `owner`). Default `editor`; the v1 UI never mints `member` codes (§14.4). |
| `allowSignup` | BOOL. If false or absent, **the code can't be used to create an account**. It only works for existing users. |
| `createdBySub` | Who minted it, for audit |
| `kind` | `"signup"` (today's codes) or `"circle"` |

Why reuse this table:
- The atomic uses/maxUses/expiry/revoked logic and the `USE#` audit records already exist and are tested in `pre_sign_up.py`.
- One code format, one "join" UX.

**Security decision.** The app is invite-only today, and Rob controls who gets in. Circle editors can mint circle codes, but those codes **cannot create accounts** unless `allowSignup` is true. Only an admin script (or a member of the `admins` Cognito group, §2) sets that. Otherwise any circle editor could open sign-ups. Update `pre_sign_up.py` so that a code with `kind = "circle"` and no `allowSignup` is rejected. **Decided (§14.2):** only admins mint sign-up codes; brigade codes never create accounts.

Endpoints:
- **`POST /circles/{cid}/invites {maxUses?=10, ttlDays?=14, role?="editor"}`** (circle editor or higher)
  - Generates the code server-side with `secrets.token_urlsafe(9)`, about 72 bits, prefixed `C-`.
  - Puts `META`. Returns `{code, url: "https://mealsbymaggie.com/join?code=..."}`.
  - Cap active codes at 20 per circle.
- **`GET /circles/{cid}/invites`** (editor or higher): lists codes. This needs a way to find a circle's codes. Two options:
  - add a GSI to `mbm-invites` on `circleId`, or
  - write a pointer item `CIRCLE#cid / INVITE#code` into `mbm-circles`.

  **Recommend the pointer item.** It avoids touching the invites table's indexes and keeps circle data in one collection.
- **`DELETE /circles/{cid}/invites/{code}`** sets `revoked = true` and deletes the pointer.
- **`POST /circles/join {code}`** (JWT, existing users). One transaction:
  - `Update` the invite `META` using the same condition as `pre_sign_up.py`, plus `circleId = :cid`.
  - `Put` a `USE#<iso>#<email>` audit item.
  - `Put` `MEMBER#sub`, with condition `attribute_not_exists(sk)`. Already a member returns 200 as a no-op. To keep that idempotent, check membership first and skip the transaction.
  - `Update` `META` `memberCount`.

  Returns the circle summary.

Code lookup is by the exact key, so a brute-force guess needs about 2^72 attempts. Add an API Gateway route throttle on `POST /circles/join` anyway (default stage settings, `throttling_burst_limit = 5`, `throttling_rate_limit = 2` per route).

### 6.9 Cognito post-confirmation trigger (new)

`lambda/auth/post_confirmation.py`:

```python
def handler(event, _ctx):
    if event.get("triggerSource") != "PostConfirmation_ConfirmSignUp":
        return event                     # ignore forgot-password confirmations
    attrs = event["request"]["userAttributes"]
    sub, code = attrs["sub"], attrs.get("custom:invite")
    if not code:
        return event
    meta = invites.get_item(Key={"code": code, "sk": "META"}).get("Item") or {}
    cid = meta.get("circleId")
    if cid:
        add_member(cid, sub, role=meta.get("circleRole", "editor"),
                   display_name=attrs.get("nickname") or attrs.get("email","").split("@")[0],
                   invited_by=meta.get("createdBySub"), invite_code=code)
    return event                         # never raise: a failure here must not block confirmation
```

- The pre-sign-up trigger already consumed the code, so this trigger only **reads** it. `add_member` is idempotent because of the condition `attribute_not_exists(sk)`, and `ConditionalCheckFailed` is swallowed.
- Wrap everything in try/except, log failures, and return the event. Cognito retries triggers. A thrown error would leave the user confirmed but would show an error on the client.
- Terraform: add `post_confirmation = aws_lambda_function.cognito_post_confirmation.arn` to `lambda_config`, plus an `aws_lambda_permission` like `allow_cognito_pre_signup`, and a dedicated IAM role with `GetItem` on invites and `PutItem`/`UpdateItem`/`TransactWriteItems` on circles.
- ⚠️ **Do not modify the existing `schema` block on the user pool.** Changes to schema attributes can force replacement of the user pool, which deletes every user. Changing `lambda_config` is an in-place update. Always read `terraform plan` for `forces replacement` on `aws_cognito_user_pool.mbm` before applying.

---

## 7. API surface

### 7.1 Route table (final)

| Route | Auth | Handler | Notes |
|---|---|---|---|
| `GET /recipes` | none | public list | **Public recipes only.** Query `gsi_public` and paginate fully. Never reads `Authorization`. |
| `GET /recipes/{id}` | none | public get | 404 unless public |
| `GET /me/recipes` | JWT | feed | §7.2. Query params: `scope=all|mine|circle|public` (default `all`), `circleId`, `includePublic=0|1` |
| `GET /me/recipes/{id}` | JWT | get | Any recipe the caller can read, including public ones. Includes `access`. |
| `POST /recipes` | JWT | create | §6.1 |
| `PUT /recipes/{id}` | JWT | edit content | §6.2 |
| `PUT /recipes/{id}/sharing` | JWT | sharing | §6.3 |
| `DELETE /recipes/{id}` | JWT | delete | §6.4 |
| `POST /recipes/{id}/copy` | JWT | copy | §6.7 |
| `POST /recipes/{id}/transfer` | JWT | transfer | §6.6 (v1.1) |
| `GET /me/circles` | JWT | list | AP4. `[{id, name, emoji, role, memberCount}]` |
| `POST /circles` | JWT | create | |
| `GET /circles/{cid}` | JWT, member | detail | Meta plus members `[{sub, displayName, role}]`. **Never return emails.** |
| `PATCH /circles/{cid}` | JWT, owner | rename | |
| `DELETE /circles/{cid}` | JWT, owner | delete | §6.5 |
| `PUT /circles/{cid}/members/{sub}` | JWT, owner | change role | |
| `DELETE /circles/{cid}/members/{sub}` | JWT, self or owner | remove/leave | |
| `DELETE /circles/{cid}/recipes/{rid}` | JWT | unshare from circle | `can_unshare_from`. Same transaction as the remove branch of §6.3. |
| `POST /circles/{cid}/invites` | JWT, editor+ | mint code | |
| `GET /circles/{cid}/invites` | JWT, editor+ | list codes | |
| `DELETE /circles/{cid}/invites/{code}` | JWT, editor+ | revoke | |
| `POST /circles/join` | JWT | join by code | throttled |
| `GET /ratings`, `POST /ratings` | – | **remove** | §11.2 |

**Why `/me/*` instead of optional auth on the existing GETs.** The HTTP API JWT authorizer is all-or-nothing per route: if the token is missing, the request gets a 401 before the Lambda runs. Optional auth would mean verifying JWTs inside the Lambda, which requires packaging `PyJWT` + `cryptography`, fetching and caching the JWKS, and checking `iss`, `aud`/`client_id`, `exp` and `token_use`. Or it would mean a Lambda authorizer on every public call. The split routes:
- reuse the existing, battle-tested API Gateway authorizer,
- keep public routes trivially safe (I5), and
- leave old clients untouched.

Terraform: each new route is an `aws_apigatewayv2_route` targeting `recipes_integration` with `authorization_type = "JWT"` and `authorizer_id = aws_apigatewayv2_authorizer.cognito_jwt.id`. The existing `allow_apigw_recipes` permission already covers `/*/*/*`.

### 7.2 Feed algorithm: `GET /me/recipes`

```
caller   = load_caller(event)                          # AP4 → memberships {cid: role}
owned    = query_all(gsi_owner, ownerSub = caller.sub)  # AP2

if scope == "mine":            result = owned
elif scope == "circle":        require cid in caller.memberships else 404
                               rids = query_all(CIRCLE#cid, begins_with RECIPE#)   # AP7
                               result = batch_get(rids)
elif scope == "public":        result = query_all(gsi_public)
else (all):
    rid_sets = parallel( query_all(CIRCLE#c, begins_with RECIPE#) for c in memberships )
    rids     = union(rid_sets) - {r.recipeId for r in owned}
    result   = owned + batch_get(rids)
    if includePublic: result += query_all(gsi_public) minus ids already present

result = [r for r in result if recipe_access(caller, r).can_read]   # defense in depth
return sorted(result, key=updatedAt desc), each passed through map_recipe_out(r, caller)
```

Implementation notes:
- **Parallelism.** Use `concurrent.futures.ThreadPoolExecutor(max_workers=8)`. **`boto3` clients are thread-safe. `boto3.resource` objects are not.** Use a module-level `boto3.client('dynamodb')` for the parallel queries and deserialize with `TypeDeserializer`. Alternatively, create one resource per thread.
- **`query_all`** loops on `LastEvaluatedKey`. Today's `table.scan()` doesn't, and that's the 1 MB truncation bug.
- **`batch_get`**:
  - chunks of 100 keys
  - retry `UnprocessedKeys` with exponential backoff and jitter, up to 5 attempts
  - at most 16 MB per response
  - recipes that disappeared since the edge was written are just missing, so skip them silently and let reconcile clean up the edge
- **Response size.** A Lambda proxy response is capped at about 6 MB. At 2–5 KB per recipe that's over 1,000 recipes, far beyond today's corpus. When it matters, add cursor pagination (`?cursor=` as an opaque base64 of per-source `LastEvaluatedKey`s) or slim list items (drop `instructions`/`ingredients` and load them on detail). Leave a `TODO(pagination)` comment.
- **Cost.** For a user with N circles, a feed load is roughly `1 + 1 + N + ceil(R/100)` requests. With N ≤ 10 this is trivial.
- The old `GET /recipes` must also switch from `scan` to `query_all(gsi_public)`. The migration makes everything public, so its output equals today's.

### 7.3 Request validation (`parse_recipe_body`)

Validate every write body, because the body is currently spread straight into the item:

```python
LIMITS = dict(title=200, description=4000, image=1024, servings=50, cookTime=50,
              tag=40, tags=30, ingredients=200, ingredient_field=500,
              instructions=200, instruction=4000)

def parse_recipe_body(body: dict) -> dict:
    out = {}
    for f in EDITABLE_FIELDS:
        if f not in body or body[f] in (None, "", []):
            continue
        v = body[f]
        # type + length checks per field; raise BadRequest(f"{f} invalid") on failure
        ...
        out[f] = v
    if not out.get("title"):
        raise BadRequest("title required")
    return out
```

- `image` must be either an `uploads/...` key or an `https://` URL. Look at how `src/lib/images.ts` `resolveImageUrl` treats legacy values before tightening this, and match it.
- `ingredients` must be a list of `{name: str, amount?: str}`. `instructions` must be a list of str. `tags` must be a list of str, de-duplicated case-insensitively.
- Reject bodies over 256 KB. API Gateway allows 10 MB, but recipes never need that much.

### 7.4 Response shape

```jsonc
{
  "id": "…", "recipeId": "…",            // both kept for backward compat (map_recipe_out)
  "title": "…", "...EDITABLE_FIELDS": "…",
  "createdAt": 0, "updatedAt": 0, "createdByName": "…", "updatedByName": "…",
  "createdBySub": "…", "updatedBySub": "…",   // existing; consider dropping subs from public responses (§11.4)
  "ownerSub": "…", "ownerName": "…",
  "isPublic": true,
  "sharedIn": ["cid1"],                  // filtered (I6)
  "version": 3,
  "sourceRecipeId": "…", "sourceOwnerName": "…",
  "access": { "canRead": true, "canEdit": true, "canDelete": false, "canShare": false,
              "relation": "circle-editor" }     // only on /me/* routes
}
```

`publicPk` and raw `circleIds` are **never** serialized.

---

## 8. Backward compatibility

### 8.1 Old clients (installed iOS builds, PWA tabs that haven't reloaded)

| Old behavior | After this change | Outcome |
|---|---|---|
| Anonymous `GET /recipes` | Returns public recipes. After migration that's every pre-existing recipe. | ✅ Same list until someone makes something private. Private recipes then disappear from old clients, which is correct. |
| `GET /recipes/{id}` | Public only | ✅ |
| `POST /recipes` without `sharing` | Created **public, no circles** (§6.1) | ✅ It shows in the anonymous list. With no circle it wouldn't show in the founding brigade's Home, though. **Mitigation:** env var `LEGACY_DEFAULT_SHARE=founding` makes a create *without* a `sharing` key default to `{isPublic: true, circleIds: [FOUNDING_CIRCLE_ID]}`. New clients always send `sharing`. Remove the flag once old builds are gone. |
| `PUT /recipes/{id}` (full body, no `version`) | Content-only UpdateItem with no version check | ✅ Same semantics as today, now with an authz check. Old clients show an edit pencil to everyone, so a non-editor gets a 403 and the client shows its existing generic error toast. Acceptable. |
| `DELETE /recipes/{id}` | Owner, super admin, or chef of every circle it's in | ✅ Others get a 403 |

### 8.2 API versioning

None needed. Everything is additive: new routes, plus new response fields that clients ignore. `Recipe.swift` must decode new fields as optionals. Check that its `Decodable` doesn't fail on unknown keys. Swift's synthesized `Decodable` ignores unknown keys by default, so this is fine.

---

## 9. Client changes

### 9.1 Web: data layer

`src/types.ts`:

```ts
export type RecipeAccess = { canRead: boolean; canEdit: boolean; canDelete: boolean; canShare: boolean;
                             relation: 'owner' | 'circle-editor' | 'circle-member' | 'public' | 'none' }
export type Recipe = { /* existing */ ownerSub?: string; ownerName?: string; isPublic?: boolean;
                       sharedIn?: string[]; version?: number; sourceRecipeId?: string;
                       sourceOwnerName?: string; access?: RecipeAccess }
export type CircleRole = 'owner' | 'editor' | 'member'
export type Circle = { id: string; name: string; emoji?: string; role: CircleRole; memberCount: number }
export type CircleMember = { sub: string; displayName: string; role: CircleRole }
export type Sharing = { isPublic: boolean; circleIds: string[] }
export type FeedScope = { kind: 'all' } | { kind: 'mine' } | { kind: 'circle'; id: string } | { kind: 'public' }
```

`src/lib/storage.ts`, extending the `Storage` interface:
- `listRecipes(scope?: FeedScope)`: signed in calls `GET /me/recipes?...`, anonymous calls `GET /recipes`. Use `fetchAuthSession()`, which `getAuthHeader` already does, to decide.
- `getRecipe(id)`: signed in calls `/me/recipes/{id}`, otherwise `/recipes/{id}`.
- `createRecipe(r, sharing)`, `updateRecipe(id, r, version?)`. Treat a 409 as a typed `ConflictError` carrying the server copy.
- New: `setSharing(id, sharing, version?)`, `copyRecipe(id)`, `listCircles()`, `createCircle(name)`, `getCircle(id)`, `renameCircle`, `deleteCircle`, `setMemberRole`, `removeMember`, `leaveCircle`, `unshareFromCircle`, `createInvite`, `listInvites`, `revokeInvite`, `joinCircle(code)`.
- `LocalAdapter`: implement circles in memory (one implicit "Local" circle) so `npm run dev` without `VITE_API_BASE` still works. Mark every local recipe `access = owner`.

`src/state/AppContext.tsx`:
- Add the `circles` state and `scope` state. Persist `scope` in `localStorage['mbm:scope:<sub>']`.
- **Re-run `reload()` whenever `userSub` changes** (sign-in, sign-out, user switch), and also reload `circles`. Clear `recipes` immediately on sign-out so one user's private data isn't left on screen.
- Add `lastSharing` (localStorage `mbm:lastSharing:<sub>`). It's the default for new recipes. With nothing stored it's `{isPublic: true, circleIds: <all the user's circles>}` (§14.3). iOS keeps the same in `UserDefaults`.

### 9.2 Web: screens

- **HomeScreen.**
  - Add a horizontal chip row under the search bar: `All · Mine · <circle chips…> · Discover`.
  - Fuse search runs over the currently scoped list, so the existing `tag:` and `ing:` syntax keeps working.
  - Each card shows a small "shared in" or globe badge.
  - Check `npm run test:ios-overflow`, because the chip row must scroll horizontally *inside* itself. See `docs/mobile-horizontal-scroll.md`.
- **DetailScreen.**
  - Show the edit pencil only when `r.access?.canEdit`. Today it shows whenever `isAuthed` (line 92).
  - Show the owner ("by Maggie"), the sharing chips, and a share button if `canShare`.
  - Show a "Save a copy" button when the user can read the recipe but isn't its owner.
- **ShareSheet** (new; reuse `components/ui/Sheet.tsx`):
  - a toggle for each of the user's circles
  - a "Public" toggle with a confirm dialog (`ConfirmDialog.tsx`) worded like "Anyone on the internet can see this"
  - Save calls `setSharing`
- **EditorScreen.** On create, show a compact "Sharing: Maggie's Kitchen ▸" row that opens the ShareSheet, defaulting to `lastSharing`. On save, send `sharing`. On a 409, show a kitchen-themed message and reload.
- **Brigades screens.** All copy comes from `src/lib/brigadeCopy.ts` (§3.2). New routes. These are user-facing URLs, so they say "brigades", while the API stays `/circles`:
  - `/brigades` (list + create, with the "What's a brigade?" explainer)
  - `/brigades/:id` (members with role labels and descriptions, invites, leave/delete)
  - `/join` (reads `?code=`, requires sign-in, calls `joinCircle`, then navigates to `/` with that circle's scope)

  Add an entry point from the account sheet or the TabBar. TabBar real estate is tight (Recipes / + / Favorites), so put "Your brigades" in the account sheet.
- **Errors.** Keep the kitchen-themed copy (`src/lib/kitchenTalk.ts`). Add lines for 403 ("That's not your recipe to change") and 409.
- **Tests** (vitest + jsdom, following `screens.test.tsx`):
  - pencil hidden when `canEdit` is false
  - chip filtering
  - ShareSheet public confirmation
  - reload on auth change
  - `/join` flow

### 9.3 iOS

Mirror the web, and keep the Swift comments pointing at the web sources (per `CLAUDE.md`):
- `Recipe.swift`: add the new optional fields plus a `RecipeAccess` struct.
- `RecipeAPI.swift`:
  - `listRecipes(scope:token:)`, which uses `/me/recipes` when a token is available
  - `getRecipe`
  - `setSharing`, `copyRecipe`
  - circles endpoints
  - `joinCircle`
- `RecipeStore.swift`: add `circles`, `scope`, and reload on auth change.
- `RecipeListView.swift`: add the chip row.
- `RecipeDetailView.swift`: gate the edit button on `recipe.access?.canEdit == true` (lines 39–51), and add share and copy buttons.
- Put every brigade string and role label in `BrigadeCopy.swift`, mirroring `src/lib/brigadeCopy.ts` (§3.2).
- Handle universal links for `/join?code=`. That needs Associated Domains, which needs a paid team; until then, add a "Join with code" text field in the account view.
- Add `ios/MealsByMaggieTests` coverage for decoding the new fields, including old payloads without them.

---

## 10. Migration

### 10.1 Script: `scripts/migrate-circles.mjs`

Node with AWS SDK v3, following `scripts/backfill-recipe-names.mjs` and `scripts/seed-invites.mjs`.
- **Dry-run by default.** Pass `--apply` to write.
- **Idempotent.** Skip recipes that already have `schemaV = 2`.

Inputs (env):

```
AWS_REGION=us-east-1
USER_POOL_ID=...            # from `terraform output cognito_user_pool_id`
RECIPES_TABLE=mbm-recipes
CIRCLES_TABLE=mbm-circles
INVITES_TABLE=mbm-invites
FOUNDING_CIRCLE_ID=...      # generate once, then pin; also set as Lambda env
FOUNDING_CIRCLE_NAME="Maggie's Kitchen"
FOUNDING_OWNER_SUBS=sub1,sub2      # Rob, Maggie → role owner
FALLBACK_OWNER_SUB=sub1            # for recipes with no createdBySub
```

Steps:
1. Create the founding circle `META` if it's missing.
2. `ListUsers` on the pool (paginate, 60 per page). For each `UserStatus = CONFIRMED` user, put `MEMBER#sub`:
   - role `owner` if the sub is in `FOUNDING_OWNER_SUBS`, else `editor`
   - `displayName` from `nickname`, falling back to the email local part
   - `circleName`
   - `gsi1*`

   Then set `memberCount` and `ownerCount` from the counts.
3. Scan `mbm-recipes` **with pagination**. For each item without `schemaV = 2`, run a transaction:
   - `Update` the recipe:
     - `SET ownerSub = if_not_exists(ownerSub, :owner)`, where `:owner` is `createdBySub` or `FALLBACK_OWNER_SUB`
     - `ownerName`
     - `publicPk = "PUBLIC"`
     - `circleIds = {FOUNDING}`
     - `updatedAt = if_not_exists(updatedAt, :createdAtOrNow)`
     - `version = if_not_exists(version, :one)`
     - `schemaV = 2`
   - `Put` the edge `CIRCLE#FOUNDING / RECIPE#rid`.
4. Update every unexpired, unrevoked sign-up code in `mbm-invites` so it carries `circleId = FOUNDING`, `circleRole = editor`, `kind = signup` and `allowSignup = true`. New sign-ups then land in the founding circle exactly as everyone does today.
5. Print a summary: users added, recipes migrated, recipes with a fallback owner (list them), and invites updated.

Run order relative to deploys is in §13. Take an **on-demand DynamoDB backup of `mbm-recipes`** before step 3 (`aws dynamodb create-backup`). Also enable PITR on `mbm-recipes` in Terraform as part of Phase 0.

### 10.2 Reconcile script: `scripts/reconcile-circles.mjs`

Report by default. Pass `--fix` to repair.
- **I1.**
  - Recipe has cid in `circleIds` but the edge is missing: put the edge.
  - Edge exists but the recipe is missing or doesn't list cid: delete the edge.
- **I2.** Recipe shared into a circle its owner isn't in: allowed since §14.6. Report the count only, never remove.
- **I3.** Circle with `ownerCount < 1` or a mismatched count: report only. A human decides.
- Recipes without `ownerSub`: report.
- Circles stuck in `deleting = true`: resume deletion.
- Stale `circleName` on memberships: fix.

Run it after migration and whenever something looks off. Optionally, schedule it weekly with EventBridge as report-only, logging to CloudWatch.

---

## 11. Security notes & adjacent fixes

### 11.1 Must fix as part of Phase 1 (independent of circles)

**Status (2026-10-17):** items 2–5 and §11.2 are done in `fix/api-hardening` (validation lives in `lambda/recipes/recipe_input.py`). Item 1 is deliberately left for brigades: Rob chose to keep edits open to everyone signed in until per-recipe edit rights exist, so the family can keep fixing each other's recipes.

1. **Ownership / authorization on PUT** (§5, §6.2). DELETE already has a creator-or-admin check (#120); Phase 1 moves it to `recipe_access()` and `ownerSub` (§6.4).
2. **Mass assignment** on POST and PUT (I4, §7.3).
3. **`put_item` full replace on PUT**: switch to UpdateItem (§6.2).
4. **Unpaginated scan** on `GET /recipes` (§7.2).
5. **Unverified JWT decode in `get_identity()`.** Delete the fallback branch, or restrict it to a `LOCAL_TEST=1` env flag that tests set. Identity must come only from `requestContext.authorizer.jwt.claims`. Update the tests to put claims in `requestContext.authorizer.jwt.claims`.

### 11.2 Ratings
`mbm-ratings` has a public scan (`GET /ratings`), and `POST /ratings` accepts arbitrary bodies with no rater identity. No client uses either one. **Remove both routes and the code** in Phase 1. Leave the table, or destroy it after export. If ratings come back, redesign them as `mbm-circles` items `RECIPE#rid / RATING#sub` that inherit recipe read authz.

### 11.3 Images
- Keys are unguessable (UUIDv4), and the key is only disclosed in recipe JSON. Recipe JSON is now authz-filtered, so a private recipe's image is effectively private.
- Remaining exposure:
  - `GET /images/{key}` is public, so anyone who once had access keeps the URL forever.
  - Presigned GET URLs leak through `Referer` and browser history.
- Accept this for v1 and document it. A v2 hardening would:
  - make `GET /images/{key}` look up which recipe references the key (this needs a `imageKey → recipeId` index) and apply recipe read authz, or
  - have `map_recipe_out` return short-lived presigned URLs directly, and make the bucket accessible only via those URLs.
- **Split the IAM role** (done in Phase 0). `images_fn` used to have the recipes Lambda's DynamoDB permissions through the shared `lambda_exec` role. Give it its own role with S3 permissions only.

### 11.4 PII in responses
- Recipes expose `createdBySub` and `updatedBySub` on public routes. Subs aren't secret, but they're stable identifiers that can link activity across recipes.
- For anonymous `GET /recipes*`, strip `*Sub` fields and keep only names.
- Circle member lists return `displayName` and `sub`, **never email**.

### 11.5 IAM delta for `lambda_policy` (recipes)

```hcl
statement {
  actions = ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem",
             "dynamodb:Query","dynamodb:BatchGetItem","dynamodb:BatchWriteItem",
             "dynamodb:ConditionCheckItem"]
  resources = [
    aws_dynamodb_table.recipes.arn, "${aws_dynamodb_table.recipes.arn}/index/*",
    aws_dynamodb_table.circles.arn, "${aws_dynamodb_table.circles.arn}/index/*",
    aws_dynamodb_table.invites.arn,
  ]
}
statement {
  # TransactWriteItems is authorized per-item against the actions above; it has no resource-level
  # action of its own beyond the item actions, but list it explicitly for clarity.
  actions   = ["dynamodb:TransactWriteItems","dynamodb:TransactGetItems"]
  resources = [aws_dynamodb_table.recipes.arn, aws_dynamodb_table.circles.arn, aws_dynamodb_table.invites.arn]
}
```

- Drop `Scan` once `GET /recipes` uses `gsi_public`. The migration and reconcile scripts run with operator credentials, not the Lambda role.
- The existing `pre_signup_ddb_policy` grants `TransactWriteItems` on `Resource = "*"`. Tighten it to the invites table ARN while you're in there.
- Add Lambda env vars: `CIRCLES_TABLE`, `INVITES_TABLE`, `FOUNDING_CIRCLE_ID`, `LEGACY_DEFAULT_SHARE`.

### 11.6 Abuse limits

| Limit | Value |
|---|---|
| Circles per user | 50 |
| Members per circle | 200 |
| Circles per recipe | 20 |
| Active invite codes per circle | 20 |
| `POST /circles/join` throttle | per-route |
| Body size | 256 KB |

Enforce these server-side and return 400 with a clear message.

---

## 12. Future: relationships between circles ("linked circles")

The original idea included "relationships between groups of people", e.g. two families who want to see each other's shared recipes. **Don't implement nesting.** Inherited, transitive membership is the nested-AD-group problem: it's hard to reason about, hard to audit, and it causes surprise exposure.

If it's ever needed, the design is:
- **Explicit, one-hop, read-only links.** Add an item `CIRCLE#a / LINK#b` with `mode = "read"`, created only when **owners of both circles** approve. The proposal is stored as `LINKREQ#`, and the other side accepts it.
- **Feed.** For each of my circles `a`, also include recipes shared into every `b` where `LINK#b` exists on `a`. **No transitivity:** `a→b→c` does not give `a` access to `c`.
- **Authz.** `recipe_access` gains a `linked-reader` relation. It is computed from `caller.memberships` plus a precomputed `caller.linked: set[cid]`. It grants read only, never edit.
- **Revocation.** Delete the link item and access disappears immediately, because nothing is materialized.
- **Opt-out.** Recipe owners can set `noLinkedShare = true` to keep a recipe within the direct circle only.

Other future items: favorites stored server-side as `USER#sub / FAV#rid` in `mbm-circles` (syncs web and iOS); per-circle recipe collections or "cookbooks" as tags scoped to a circle; activity feed ("Maggie added Chicken Tikka to Family"); image authz (§11.3).

---

## 13. Implementation plan (phases, each shippable)

Each phase is a PR (or a few) with its own tests. Respect the pre-commit `terraform fmt` hook (`npm run install-hooks`). Terraform is applied by `.github/workflows/deploy.yml` on merge to `main` (`terraform/app_account/**`), so **merging Terraform = applying to prod**. Read the PR plan output from `terraform-plan.yml` carefully, especially for Cognito.

### Phase 0: groundwork (no behavior change)
- [x] Terraform: create `mbm-circles` and add GSIs `gsi_owner` and `gsi_public` to `mbm-recipes`. If the provider complains, do one GSI per apply.
- [x] Terraform: enable PITR on `mbm-recipes` (#120).
- [x] Terraform: split the `images_fn` IAM role (§11.3) and tighten the `pre_signup` transact resource.
- [x] Lambda refactor with no behavior change: split `app.py` into `router.py` (a dict of `route_key → handler` that keeps the current path-fallback for tests), `repo.py` (DynamoDB access: `query_all`, `batch_get`, serializers), `authz.py` (§5, unit-tested now, wired in later), and `validation.py` (§7.3; already existed as `recipe_input.py` from #126, kept under that name).
- [x] Tests: add a `conftest.py` fixture creating all three tables **with their GSIs** under `@mock_aws` (sketch in §15).

### Phase 1: ownership & hardening, together with the migration
Order matters:
1. [ ] Merge the Phase 0 infra.
2. [ ] Run `migrate-circles.mjs` (dry-run, review, then `--apply`). Run `reconcile-circles.mjs` and confirm it reports zero issues.
3. [ ] Deploy the Lambda with:
   - authz on PUT/DELETE
   - the allow-list
   - content-only UpdateItem with optional `version`
   - `GET /recipes` from `gsi_public`, fully paginated, with subs stripped
   - `get_identity` fallback removed
   - ratings routes removed
   - `LEGACY_DEFAULT_SHARE=founding`
   - `POST /recipes` accepting `sharing`
   - IAM delta
4. [ ] Acceptance:
   - The family sees an identical list.
   - Everyone can still edit everything, because they're all editors of the founding circle.
   - A user outside the founding circle (create a test user via a non-circle code) can't PUT or DELETE others' recipes: 403.
   - Unit tests for every row of the §3.1 matrix.

### Phase 2: circles API
- [ ] Routes and handlers for `/me/recipes`, `/me/recipes/{id}`, sharing, copy, all circle routes, invites, and join (§7.1).
- [ ] The post-confirmation trigger (§6.9) and the `pre_sign_up.py` `allowSignup` rule (§6.8).
- [ ] Route throttles.
- [ ] Acceptance:
  - Feed correctness across owned, circle and public recipes, with dedupe.
  - Leave and remove keep the departing cook's recipes shared (§14.6).
  - Circle delete is resumable.
  - Join code exhaustion, expiry and revocation.
  - A circle code without `allowSignup` can't create an account.

### Phase 3: web UI
- [ ] Data layer (§9.1), Home chips, Detail gating, ShareSheet, editor sharing row, Brigades screens with `brigadeCopy.ts`, `/join`.
- [ ] `npm test` and `npm run test:ios-overflow` both pass. Update the visual regression snapshots (`src/visual-regression.test.tsx`) intentionally.

### Phase 4: iOS parity
- [ ] §9.3. Bump the build. Once enough users are on new clients (watch the API access logs for anonymous `GET /recipes` traffic falling), set `LEGACY_DEFAULT_SHARE=off`. New clients already send the user's last sharing choice.

### Phase 5 (optional)
- [ ] Ownership transfer, server-side favorites, image authz hardening, linked circles (§12), feed pagination.

---

## 14. Decisions (Rob, 2026-10-23)

These were the open questions. Sections above already reflect them.

1. **UI name** (2026-10-17): "Brigade", with Chef de cuisine / Sous-chef / Commis role labels. See §3.2. The code stays `circle`.
2. **Who can let new people into the app:** only admins mint sign-up codes (`allowSignup = true`). Brigade codes only add people who already have an account (§6.8).
3. **Default sharing for new recipes:** the user's last choice. With no last choice, public plus all the user's brigades, which matches how things work today. Clients remember it (§9.1); the server default without `sharing` is public with no circles (§6.1).
4. **Roles:** everyone in the founding brigade is an `editor` (Sous-chef), and new members join as `editor`, so members of a brigade can edit each other's shared recipes. People can be in several brigades. The read-only `member` (Commis) role stays in code but isn't offered in the v1 UI.
5. **Public recipes:** yes, anonymous visitors can read public recipes, so `GET /recipes` stays public and installed iOS builds keep working. Each recipe can still be private. Home shows only your recipes plus your brigades'; the rest of the public catalog lives in Discover. The concern was scale (hundreds or thousands of recipes from many brigades), which scoped Home solves without making things private.
6. **Leaving a brigade:** your recipes **stay** with the brigade (no cascade, §6.5). You keep ownership, so you can still edit or unshare them.
7. **Deletes:** super admins (`admins` Cognito group) can delete any recipe. A brigade's Chef de cuisine can delete a recipe only when every brigade it's shared into is one they run; otherwise they can only remove it from their brigade (§3.1, §6.4). `Caller.is_admin` comes from `cognito:groups`.

---

## 15. Test plan (pytest + moto, `terraform/app_account/lambda/tests/`)

Fixture sketch (`conftest.py`):

```python
import boto3, pytest
from moto import mock_aws

@pytest.fixture
def ddb(monkeypatch):
    with mock_aws():
        c = boto3.client("dynamodb", region_name="us-east-1")
        c.create_table(TableName="mbm-recipes", BillingMode="PAY_PER_REQUEST",
            KeySchema=[{"AttributeName": "recipeId", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": n, "AttributeType": t} for n, t in
                [("recipeId","S"),("ownerSub","S"),("publicPk","S"),("updatedAt","N")]],
            GlobalSecondaryIndexes=[
              {"IndexName": "gsi_owner", "KeySchema": [{"AttributeName":"ownerSub","KeyType":"HASH"},
                {"AttributeName":"updatedAt","KeyType":"RANGE"}], "Projection": {"ProjectionType":"ALL"}},
              {"IndexName": "gsi_public", "KeySchema": [{"AttributeName":"publicPk","KeyType":"HASH"},
                {"AttributeName":"updatedAt","KeyType":"RANGE"}], "Projection": {"ProjectionType":"ALL"}}])
        c.create_table(TableName="mbm-circles", BillingMode="PAY_PER_REQUEST",
            KeySchema=[{"AttributeName":"pk","KeyType":"HASH"},{"AttributeName":"sk","KeyType":"RANGE"}],
            AttributeDefinitions=[{"AttributeName": n, "AttributeType": "S"} for n in ("pk","sk","gsi1pk","gsi1sk")],
            GlobalSecondaryIndexes=[{"IndexName":"gsi1","KeySchema":[
                {"AttributeName":"gsi1pk","KeyType":"HASH"},{"AttributeName":"gsi1sk","KeyType":"RANGE"}],
                "Projection":{"ProjectionType":"ALL"}}])
        c.create_table(TableName="mbm-invites", BillingMode="PAY_PER_REQUEST",
            KeySchema=[{"AttributeName":"code","KeyType":"HASH"},{"AttributeName":"sk","KeyType":"RANGE"}],
            AttributeDefinitions=[{"AttributeName":"code","AttributeType":"S"},{"AttributeName":"sk","AttributeType":"S"}])
        for k, v in dict(RECIPES_TABLE="mbm-recipes", CIRCLES_TABLE="mbm-circles",
                         INVITES_TABLE="mbm-invites", AWS_REGION="us-east-1").items():
            monkeypatch.setenv(k, v)
        yield c

def event(method, path, route_key=None, sub=None, body=None, query=None, path_params=None):
    rc = {"http": {"method": method}}
    if route_key: rc["routeKey"] = route_key
    if sub: rc["authorizer"] = {"jwt": {"claims": {"sub": sub, "nickname": sub}}}
    e = {"requestContext": rc, "rawPath": path}
    if body is not None: e["body"] = json.dumps(body)
    if query: e["queryStringParameters"] = query
    if path_params: e["pathParameters"] = path_params
    return e
```

The module reads table names at import time (`RECIPES_TABLE = os.environ.get(...)` at module level), so **load the module after setting env**. The existing tests do this with `load_module()`. Alternatively, read env lazily inside functions.

Cases (minimum):

| Area | Cases |
|---|---|
| `authz.recipe_access` | Table-driven over every relation × public/private × role, including an unknown role, a missing `ownerSub`, a circle in `deleting`, super admin, and circle-owner delete (only when every circle is theirs) |
| Mass assignment | POST/PUT with `ownerSub`, `publicPk`, `circleIds`, `createdBySub`, `version` or junk keys in the body: none are persisted |
| PUT semantics | Clears omitted editable fields (keep the existing test). Preserves `circleIds`/`publicPk`. Bumps `version`. Stale `version` returns 409. Non-editor gets 403. Unreadable gets 404. |
| PUT race | Recipe unshared between the GetItem and the UpdateItem (simulate by deleting `circleIds` before the call with a patched getter): conditional failure, then 403 |
| DELETE | Owner gives 204 and removes edges. Super admin gives 204. Circle owner gives 204 when the recipe is only in their circles, 403 when it's also elsewhere (including a share added between read and delete). Circle editor gets 403. Stranger gets 404. |
| Public routes | Private recipe returns 404 even with a valid-looking `Authorization` header. List contains only public recipes. No `*Sub` fields. Pagination beyond 1 page (insert more than 1 MB, or monkeypatch `Limit`). |
| Feed | owned ∪ circles deduped; `scope=circle` for a non-member gives 404; `includePublic`; `sharedIn` filtered to the caller's circles; recipe deleted with a dangling edge is skipped |
| Sharing | Add/remove circles (edges match I1). Adding to a non-member circle gives 400. Non-owner gives 403. Public toggle sets/removes `publicPk`, and the item appears in or leaves `gsi_public`. |
| Circles | Create, list mine, rename fan-out, demote last owner gives 400 (I3), leave keeps the leaver's shares (§14.6) and the leaver can still edit and unshare them, delete is resumable (mark `deleting`, then partial, then rerun) |
| Invites / join | Valid join, idempotent rejoin, exhausted, expired, revoked, wrong circle; non-editor can't mint |
| Triggers | `pre_sign_up` rejects `kind=circle` without `allowSignup`; `post_confirmation` adds membership, is idempotent, never raises, and ignores `PostConfirmation_ConfirmForgotPassword` |
| Copy | Readable source gives a new private recipe owned by the caller with `sourceRecipeId`; unreadable gives 404; S3 copy (moto S3) |

moto supports `TransactWriteItems` (including `ConditionCheck`), GSIs, and `BatchGetItem`. If a moto version gap shows up in the CI requirements (`lambda/requirements-dev.txt`), pin a newer moto.

---

## 16. Quick reference for implementers

- **Never** read identity from anything except `requestContext.authorizer.jwt.claims`.
- **Never** spread a request body into an item. Use the allow-list.
- **Never** `put_item` an existing recipe. Use `update_item` and touch only what you own.
- Every multi-entity mutation is a transaction, and its conditions restate the authz facts.
- Not readable → 404. Readable but not allowed → 403. Version conflict → 409.
- Public routes return public data only, with no subs.
- Re-run `reconcile-circles.mjs` after any manual data surgery.
- Keep this doc updated when a decision changes.
