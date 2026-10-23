// Pure planning logic for scripts/migrate-circles.mjs and scripts/reconcile-circles.mjs
// (docs/recipe-circles.md §10). No AWS calls here, so it's unit-tested in circles.test.mjs.
// Item shapes are the lib-dynamodb ones: plain JS values, string sets as Set.

export const SCHEMA_V = 2

export const circlePk = (cid) => `CIRCLE#${cid}`
export const memberSk = (sub) => `MEMBER#${sub}`
export const recipeSk = (rid) => `RECIPE#${rid}`

const attrMap = (attrs = []) => Object.fromEntries(attrs.map(a => [a.Name, a.Value]))

// Display name for a Cognito user, like get_identity() in lambda/recipes/app.py:
// nickname, then the email's local part.
export function displayName(user) {
  const a = attrMap(user.Attributes)
  const emailLocal = a.email && a.email.includes('@') ? a.email.split('@')[0] : undefined
  return a.nickname || a.preferred_username || a.name || emailLocal || user.Username || a.sub || 'user'
}

export const userSub = (user) => attrMap(user.Attributes).sub || user.Username

// The founding circle's META item.
export function foundingMeta({ cid, name, createdBySub, now }) {
  return {
    pk: circlePk(cid), sk: 'META',
    name, createdBySub, createdAt: now,
    memberCount: 0, ownerCount: 0, version: 1,
  }
}

// MEMBER# items for every confirmed user; owners from ownerSubs, everyone else editor (§14.4).
export function planMembers(users, { cid, circleName, ownerSubs, now }) {
  const owners = new Set(ownerSubs)
  const seen = new Set()
  const members = []
  for (const u of users) {
    if (u.UserStatus !== 'CONFIRMED') continue
    const sub = userSub(u)
    if (!sub || seen.has(sub)) continue
    seen.add(sub)
    members.push({
      pk: circlePk(cid), sk: memberSk(sub),
      gsi1pk: `USER#${sub}`, gsi1sk: circlePk(cid),
      role: owners.has(sub) ? 'owner' : 'editor',
      displayName: displayName(u),
      circleName,
      joinedAt: now,
    })
  }
  return members
}

// Number for a GSI range key. updatedAt/createdAt are epoch seconds (N); anything else
// (missing, a string) would keep the item out of the indexes or fail the write.
function epoch(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === 'string' && v.trim()) {
    if (/^\d+(\.\d+)?$/.test(v.trim())) return Math.floor(Number(v))
    const ms = Date.parse(v)
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000)
  }
  return undefined
}

// What the migration sets on one recipe, or null if it's already migrated.
// Returns { set, ownerSub, usedFallback } where set is the attributes to write.
export function planRecipe(item, { cid, fallbackOwnerSub, fallbackOwnerName, now }) {
  if (item.schemaV === SCHEMA_V) return null
  const usedFallback = !item.ownerSub && !item.createdBySub
  const ownerSub = item.ownerSub || item.createdBySub || fallbackOwnerSub
  const ownerName = item.ownerName || (item.createdBySub ? item.createdByName : fallbackOwnerName) || item.createdByName
  const createdAt = epoch(item.createdAt)
  const updatedAt = epoch(item.updatedAt) ?? createdAt ?? now
  const circleIds = new Set(item.circleIds || [])
  circleIds.add(cid)
  const set = {
    ownerSub,
    ownerName,
    publicPk: 'PUBLIC',
    circleIds,
    updatedAt,
    version: typeof item.version === 'number' ? item.version : 1,
    schemaV: SCHEMA_V,
  }
  if (!ownerName) delete set.ownerName
  if (createdAt !== undefined && createdAt !== item.createdAt) set.createdAt = createdAt
  return { set, ownerSub, usedFallback }
}

// Sign-up codes that should drop new users into the founding circle (§10.1 step 4).
// Returns the attributes to set, or null to leave the code alone.
export function planInvite(meta, { cid, now }) {
  if (meta.sk !== 'META') return null
  if (meta.revoked === true) return null
  if (typeof meta.expiresAt === 'number' && meta.expiresAt <= now) return null
  if (meta.kind && meta.kind !== 'signup') return null
  if (meta.circleId && meta.circleId !== cid) return null
  const set = { circleId: cid, circleRole: 'editor', kind: 'signup', allowSignup: true }
  const changed = Object.entries(set).some(([k, v]) => meta[k] !== v)
  return changed ? set : null
}

// Compare recipes with mbm-circles and list what's out of line (§10.2).
// circleItems is every item in mbm-circles. Returns { issues, fixes }: issues are
// { kind, ...details } for the report; fixes are the writes --fix would make.
export function reconcile(recipes, circleItems) {
  const issues = []
  const fixes = []

  const metas = new Map()      // cid -> META
  const members = new Map()    // cid -> Map(sub -> MEMBER item)
  const edges = new Map()      // cid -> Set(rid)
  for (const it of circleItems) {
    if (!it.pk?.startsWith('CIRCLE#')) continue
    const cid = it.pk.slice('CIRCLE#'.length)
    if (it.sk === 'META') metas.set(cid, it)
    else if (it.sk?.startsWith('MEMBER#')) {
      if (!members.has(cid)) members.set(cid, new Map())
      members.get(cid).set(it.sk.slice('MEMBER#'.length), it)
    } else if (it.sk?.startsWith('RECIPE#')) {
      if (!edges.has(cid)) edges.set(cid, new Set())
      edges.get(cid).add(it.sk.slice('RECIPE#'.length))
    }
  }
  const deleting = new Set([...metas].filter(([, m]) => m.deleting === true).map(([cid]) => cid))

  const byId = new Map(recipes.map(r => [r.recipeId, r]))
  for (const r of recipes) {
    const rid = r.recipeId
    if (!r.ownerSub) issues.push({ kind: 'no-owner', recipeId: rid, title: r.title })
    if (r.publicPk !== undefined && r.publicPk !== 'PUBLIC') issues.push({ kind: 'bad-publicPk', recipeId: rid, publicPk: r.publicPk })
    if (r.updatedAt !== undefined && typeof r.updatedAt !== 'number') issues.push({ kind: 'bad-updatedAt', recipeId: rid, updatedAt: r.updatedAt })
    for (const cid of r.circleIds || []) {
      if (deleting.has(cid)) continue   // the circle-delete resume below takes it out
      if (!metas.has(cid)) {
        issues.push({ kind: 'recipe-in-missing-circle', recipeId: rid, circleId: cid })
        fixes.push({ op: 'unshare-recipe', recipeId: rid, circleId: cid })
      } else if (!edges.get(cid)?.has(rid)) {
        issues.push({ kind: 'missing-edge', recipeId: rid, circleId: cid })
        fixes.push({ op: 'put-edge', recipeId: rid, circleId: cid, sharedBySub: r.ownerSub })
      }
      // I2 relaxed (§14.6): shared into a circle its owner has left is fine; count it.
      if (metas.has(cid) && r.ownerSub && !members.get(cid)?.has(r.ownerSub)) {
        issues.push({ kind: 'info-owner-not-member', recipeId: rid, circleId: cid })
      }
    }
  }

  for (const [cid, rids] of edges) {
    if (deleting.has(cid)) continue
    for (const rid of rids) {
      const r = byId.get(rid)
      if (!r || !(r.circleIds || new Set()).has(cid)) {
        issues.push({ kind: 'dangling-edge', recipeId: rid, circleId: cid })
        fixes.push({ op: 'delete-edge', recipeId: rid, circleId: cid })
      }
    }
  }

  for (const [cid, meta] of metas) {
    if (deleting.has(cid)) {
      issues.push({ kind: 'circle-deleting', circleId: cid, name: meta.name })
      fixes.push({ op: 'finish-delete', circleId: cid,
                   recipeIds: [...(edges.get(cid) || [])],
                   memberSubs: [...(members.get(cid)?.keys() || [])] })
      continue
    }
    const m = [...(members.get(cid)?.values() || [])]
    const owners = m.filter(x => x.role === 'owner').length
    if (owners < 1) issues.push({ kind: 'no-circle-owner', circleId: cid, name: meta.name })
    if (meta.memberCount !== m.length || meta.ownerCount !== owners) {
      issues.push({ kind: 'bad-counts', circleId: cid, memberCount: meta.memberCount, ownerCount: meta.ownerCount,
                    actualMembers: m.length, actualOwners: owners })
    }
    for (const x of m) {
      if (x.circleName !== meta.name) fixes.push({ op: 'set-circle-name', circleId: cid, sub: x.sk.slice('MEMBER#'.length), name: meta.name })
    }
  }
  for (const cid of members.keys()) {
    if (!metas.has(cid)) issues.push({ kind: 'members-without-circle', circleId: cid, count: members.get(cid).size })
  }
  const stale = fixes.filter(f => f.op === 'set-circle-name').length
  if (stale) issues.push({ kind: 'stale-circle-names', count: stale })

  return { issues, fixes }
}

// Issues that mean something is wrong (info-* are expected after §14.6).
export const problems = (issues) => issues.filter(i => !i.kind.startsWith('info-'))
