import { describe, expect, it } from 'vitest'
import { planInvite, planMembers, planRecipe, problems, reconcile } from './circles.mjs'

const CID = 'founding'
const NOW = 1_800_000_000

const user = (sub, attrs = {}, status = 'CONFIRMED') => ({
  Username: sub, UserStatus: status,
  Attributes: [{ Name: 'sub', Value: sub }, ...Object.entries(attrs).map(([Name, Value]) => ({ Name, Value }))],
})

describe('planMembers', () => {
  it('adds confirmed users once, owners by sub, everyone else as editor', () => {
    const members = planMembers([
      user('rob', { nickname: 'Rob', email: 'rob@example.com' }),
      user('maggie', { email: 'maggie@example.com' }),
      user('pending', {}, 'UNCONFIRMED'),
      user('rob'),
    ], { cid: CID, circleName: "Maggie's Kitchen", ownerSubs: ['rob'], now: NOW })
    expect(members.map(m => [m.sk, m.role, m.displayName])).toEqual([
      ['MEMBER#rob', 'owner', 'Rob'],
      ['MEMBER#maggie', 'editor', 'maggie'],
    ])
    expect(members[0]).toMatchObject({ pk: 'CIRCLE#founding', gsi1pk: 'USER#rob', gsi1sk: 'CIRCLE#founding', circleName: "Maggie's Kitchen" })
  })
})

describe('planRecipe', () => {
  const ctx = { cid: CID, fallbackOwnerSub: 'rob', fallbackOwnerName: 'Rob', now: NOW }

  it('makes the creator the owner and shares it, still public', () => {
    const plan = planRecipe({ recipeId: 'r1', createdBySub: 'maggie', createdByName: 'Maggie', createdAt: 100, updatedAt: 200 }, ctx)
    expect(plan.usedFallback).toBe(false)
    expect(plan.set).toEqual({
      ownerSub: 'maggie', ownerName: 'Maggie', publicPk: 'PUBLIC', circleIds: new Set([CID]),
      updatedAt: 200, version: 1, schemaV: 2,
    })
  })

  it('uses the fallback owner for recipes saved before attribution', () => {
    const plan = planRecipe({ recipeId: 'old', title: 'Old' }, ctx)
    expect(plan.usedFallback).toBe(true)
    expect(plan.set).toMatchObject({ ownerSub: 'rob', ownerName: 'Rob', updatedAt: NOW })
  })

  it('keeps an existing owner, version and circles', () => {
    const plan = planRecipe({ recipeId: 'r', ownerSub: 'x', ownerName: 'X', createdBySub: 'y', version: 4, circleIds: new Set(['c2']), updatedAt: 5 }, ctx)
    expect(plan.set).toMatchObject({ ownerSub: 'x', ownerName: 'X', version: 4, circleIds: new Set(['c2', CID]) })
  })

  it('turns string timestamps into epoch seconds so the item lands in the indexes', () => {
    expect(planRecipe({ recipeId: 'r', createdAt: '2024-01-01T00:00:00Z' }, ctx).set).toMatchObject({ createdAt: 1704067200, updatedAt: 1704067200 })
    expect(planRecipe({ recipeId: 'r', createdAt: 10, updatedAt: '20' }, ctx).set.updatedAt).toBe(20)
    expect(planRecipe({ recipeId: 'r', updatedAt: 'garbage' }, ctx).set.updatedAt).toBe(NOW)
  })

  it('skips migrated recipes', () => {
    expect(planRecipe({ recipeId: 'r', schemaV: 2 }, ctx)).toBeNull()
  })
})

describe('planInvite', () => {
  const ctx = { cid: CID, now: NOW }
  const want = { circleId: CID, circleRole: 'editor', kind: 'signup', allowSignup: true }

  it('points open sign-up codes at the founding circle', () => {
    expect(planInvite({ code: 'FNF-A', sk: 'META', maxUses: 1, uses: 0 }, ctx)).toEqual(want)
    expect(planInvite({ code: 'FNF-B', sk: 'META', expiresAt: NOW + 1 }, ctx)).toEqual(want)
  })

  it('leaves revoked, expired, other-kind, other-circle and already-done codes alone', () => {
    expect(planInvite({ code: 'a', sk: 'META', revoked: true }, ctx)).toBeNull()
    expect(planInvite({ code: 'b', sk: 'META', expiresAt: NOW }, ctx)).toBeNull()
    expect(planInvite({ code: 'c', sk: 'META', kind: 'circle' }, ctx)).toBeNull()
    expect(planInvite({ code: 'd', sk: 'META', circleId: 'other' }, ctx)).toBeNull()
    expect(planInvite({ code: 'e', sk: 'META', ...want }, ctx)).toBeNull()
    expect(planInvite({ code: 'f', sk: 'USE#2026#x@y' }, ctx)).toBeNull()
  })
})

describe('reconcile', () => {
  const meta = (cid, extra = {}) => ({ pk: `CIRCLE#${cid}`, sk: 'META', name: 'Kitchen', memberCount: 1, ownerCount: 1, ...extra })
  const member = (cid, sub, role = 'owner', circleName = 'Kitchen') => ({ pk: `CIRCLE#${cid}`, sk: `MEMBER#${sub}`, role, circleName })
  const edge = (cid, rid) => ({ pk: `CIRCLE#${cid}`, sk: `RECIPE#${rid}` })
  const recipe = (rid, cids = [], extra = {}) => ({ recipeId: rid, ownerSub: 'rob', updatedAt: 1, ...(cids.length ? { circleIds: new Set(cids) } : {}), ...extra })

  it('is clean after a good migration', () => {
    const { issues, fixes } = reconcile([recipe('r1', ['c']), recipe('r2', ['c'])], [meta('c'), member('c', 'rob'), edge('c', 'r1'), edge('c', 'r2')])
    expect(issues).toEqual([])
    expect(fixes).toEqual([])
  })

  it('finds missing and dangling edges (I1)', () => {
    const { issues, fixes } = reconcile([recipe('r1', ['c']), recipe('r2')], [meta('c'), member('c', 'rob'), edge('c', 'r2'), edge('c', 'gone')])
    expect(fixes).toEqual([
      { op: 'put-edge', recipeId: 'r1', circleId: 'c', sharedBySub: 'rob' },
      { op: 'delete-edge', recipeId: 'r2', circleId: 'c' },
      { op: 'delete-edge', recipeId: 'gone', circleId: 'c' },
    ])
    expect(problems(issues).map(i => i.kind)).toEqual(['missing-edge', 'dangling-edge', 'dangling-edge'])
  })

  it('unshares recipes from circles that no longer exist', () => {
    const { fixes } = reconcile([recipe('r1', ['ghost'])], [])
    expect(fixes).toEqual([{ op: 'unshare-recipe', recipeId: 'r1', circleId: 'ghost' }])
  })

  it('only notes recipes still shared into a circle their owner left (§14.6)', () => {
    const { issues, fixes } = reconcile([recipe('r1', ['c'], { ownerSub: 'left' })], [meta('c'), member('c', 'rob'), edge('c', 'r1')])
    expect(issues.map(i => i.kind)).toEqual(['info-owner-not-member'])
    expect(problems(issues)).toEqual([])
    expect(fixes).toEqual([])
  })

  it('reports owner, index-key and count problems without fixing them', () => {
    const { issues, fixes } = reconcile(
      [recipe('r1', [], { ownerSub: undefined, publicPk: 'yes', updatedAt: '2024' })],
      [meta('c', { memberCount: 3 }), member('c', 'rob', 'editor')],
    )
    expect(issues.map(i => i.kind)).toEqual(['no-owner', 'bad-publicPk', 'bad-updatedAt', 'no-circle-owner', 'bad-counts'])
    expect(fixes).toEqual([])
  })

  it('finishes a stalled circle delete', () => {
    const { issues, fixes } = reconcile([recipe('r1', ['c'])], [meta('c', { deleting: true }), member('c', 'rob'), edge('c', 'r1')])
    expect(issues.map(i => i.kind)).toEqual(['circle-deleting'])
    expect(fixes).toEqual([{ op: 'finish-delete', circleId: 'c', recipeIds: ['r1'], memberSubs: ['rob'] }])
  })

  it('fixes stale circle names on memberships', () => {
    const { issues, fixes } = reconcile([], [meta('c', { name: 'New name' }), member('c', 'rob', 'owner', 'Old name')])
    expect(fixes).toEqual([{ op: 'set-circle-name', circleId: 'c', sub: 'rob', name: 'New name' }])
    expect(issues.map(i => i.kind)).toEqual(['stale-circle-names'])
  })
})
