// Brigades migration (docs/recipe-circles.md §10.1): create the founding circle, make every
// confirmed user a member, give every recipe an owner and share it into the founding circle
// (still public), and point open sign-up codes at the founding circle. Nothing visible
// changes for anyone. Safe to re-run: migrated recipes (schemaV = 2) and existing members
// are skipped.
//
// Dry run by default; --apply writes (after an on-demand backup of the recipes table).
//
// Usage (macOS zsh):
//   # 1. Pick the founding circle id once (prints one if FOUNDING_CIRCLE_ID is unset), then pin it.
//   # 2. Dry run, review the output:
//   AWS_REGION=us-east-1 USER_POOL_ID=us-east-1_XXXX FOUNDING_CIRCLE_ID=<hex> \
//     FOUNDING_OWNER_SUBS=<rob-sub>,<maggie-sub> FALLBACK_OWNER_SUB=<rob-sub> \
//     node scripts/migrate-circles.mjs
//   # 3. Same with --apply, then run scripts/reconcile-circles.mjs and expect no problems.
//
// Optional env: RECIPES_TABLE (mbm-recipes), CIRCLES_TABLE (mbm-circles),
// INVITES_TABLE (mbm-invites), FOUNDING_CIRCLE_NAME ("Maggie's Kitchen").

import crypto from "node:crypto"
import { CreateBackupCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider"
import {
  circlePk, displayName, foundingMeta, planInvite, planMembers, planRecipe, recipeSk, userSub,
} from "./lib/circles.mjs"

const REGION = process.env.AWS_REGION || process.env.REGION || "us-east-1"
const USER_POOL_ID = process.env.USER_POOL_ID
const RECIPES_TABLE = process.env.RECIPES_TABLE || "mbm-recipes"
const CIRCLES_TABLE = process.env.CIRCLES_TABLE || "mbm-circles"
const INVITES_TABLE = process.env.INVITES_TABLE || "mbm-invites"
const CID = process.env.FOUNDING_CIRCLE_ID
const CIRCLE_NAME = process.env.FOUNDING_CIRCLE_NAME || "Maggie's Kitchen"
const OWNER_SUBS = (process.env.FOUNDING_OWNER_SUBS || "").split(",").map(s => s.trim()).filter(Boolean)
const FALLBACK_OWNER_SUB = process.env.FALLBACK_OWNER_SUB
const APPLY = process.argv.includes("--apply")

if (!CID) {
  console.error("FOUNDING_CIRCLE_ID is required. Pick one and keep it (it also goes in the Lambda env):")
  console.error(`  FOUNDING_CIRCLE_ID=${crypto.randomUUID().replace(/-/g, "")}`)
  process.exit(1)
}
if (!USER_POOL_ID || !OWNER_SUBS.length || !FALLBACK_OWNER_SUB) {
  console.error("USER_POOL_ID, FOUNDING_OWNER_SUBS and FALLBACK_OWNER_SUB are required (see the header)")
  process.exit(1)
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
const cognito = new CognitoIdentityProviderClient({ region: REGION })
const now = Math.floor(Date.now() / 1000)
const tag = APPLY ? "[set]" : "[dry]"

async function listUsers() {
  const users = []
  let PaginationToken
  do {
    const res = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60, PaginationToken }))
    users.push(...(res.Users || []))
    PaginationToken = res.PaginationToken
  } while (PaginationToken)
  return users
}

async function scanAll(TableName, extra = {}) {
  const items = []
  let ExclusiveStartKey
  do {
    const res = await ddb.send(new ScanCommand({ TableName, ExclusiveStartKey, ...extra }))
    items.push(...(res.Items || []))
    ExclusiveStartKey = res.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return items
}

async function queryAll(params) {
  const items = []
  let ExclusiveStartKey
  do {
    const res = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey }))
    items.push(...(res.Items || []))
    ExclusiveStartKey = res.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return items
}

const isConditionFail = (e) => e?.name === "ConditionalCheckFailedException"

async function main() {
  console.log(`${APPLY ? "APPLYING" : "Dry run (pass --apply to write)"}: founding circle ${CID} "${CIRCLE_NAME}" in ${REGION}`)

  // Users first: the owner subs must be real, confirmed people.
  const users = await listUsers()
  const confirmed = users.filter(u => u.UserStatus === "CONFIRMED")
  const bySub = new Map(confirmed.map(u => [userSub(u), u]))
  for (const sub of [...OWNER_SUBS, FALLBACK_OWNER_SUB]) {
    if (!bySub.has(sub)) {
      console.error(`${sub} isn't a confirmed user in ${USER_POOL_ID}; check FOUNDING_OWNER_SUBS / FALLBACK_OWNER_SUB`)
      process.exit(1)
    }
  }
  console.log(`Users: ${users.length} (${confirmed.length} confirmed)`)

  if (APPLY) {
    const BackupName = `${RECIPES_TABLE}-pre-circles-${new Date().toISOString().replace(/[:.]/g, "-")}`
    const res = await new DynamoDBClient({ region: REGION }).send(new CreateBackupCommand({ TableName: RECIPES_TABLE, BackupName }))
    console.log(`Backup ${BackupName}: ${res.BackupDetails?.BackupStatus} (${res.BackupDetails?.BackupArn})`)
  }

  // 1. Founding circle META.
  const meta = foundingMeta({ cid: CID, name: CIRCLE_NAME, createdBySub: OWNER_SUBS[0], now })
  console.log(`${tag} circle META ${meta.pk}`)
  if (APPLY) {
    try {
      await ddb.send(new PutCommand({ TableName: CIRCLES_TABLE, Item: meta, ConditionExpression: "attribute_not_exists(pk)" }))
    } catch (e) {
      if (!isConditionFail(e)) throw e
      console.log("  already exists")
    }
  }

  // 2. Members. Existing memberships are left as they are (role included).
  const members = planMembers(users, { cid: CID, circleName: CIRCLE_NAME, ownerSubs: OWNER_SUBS, now })
  let added = 0
  for (const m of members) {
    if (APPLY) {
      try {
        await ddb.send(new PutCommand({ TableName: CIRCLES_TABLE, Item: m, ConditionExpression: "attribute_not_exists(sk)" }))
        added++
      } catch (e) {
        if (!isConditionFail(e)) throw e
      }
    } else {
      added++
    }
    console.log(`${tag} member ${m.role.padEnd(6)} ${m.displayName} (${m.sk.slice(7)})`)
  }
  if (APPLY) {
    // Counts from what's actually stored, so a re-run fixes them too.
    const stored = await queryAll({
      TableName: CIRCLES_TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :m)",
      ExpressionAttributeValues: { ":pk": circlePk(CID), ":m": "MEMBER#" },
    })
    const owners = stored.filter(x => x.role === "owner").length
    await ddb.send(new UpdateCommand({
      TableName: CIRCLES_TABLE, Key: { pk: circlePk(CID), sk: "META" },
      UpdateExpression: "SET memberCount = :m, ownerCount = :o",
      ExpressionAttributeValues: { ":m": stored.length, ":o": owners },
    }))
    console.log(`  circle now has ${stored.length} members, ${owners} owner(s)`)
  }

  // 3. Recipes: owner, public, shared into the founding circle, numeric updatedAt.
  const fallbackOwnerName = displayName(bySub.get(FALLBACK_OWNER_SUB))
  const recipes = await scanAll(RECIPES_TABLE)
  let migrated = 0, skipped = 0
  const fallbacks = []
  for (const r of recipes) {
    const plan = planRecipe(r, { cid: CID, fallbackOwnerSub: FALLBACK_OWNER_SUB, fallbackOwnerName, now })
    if (!plan) { skipped++; continue }
    migrated++
    if (plan.usedFallback) fallbacks.push(`${r.recipeId} "${r.title}"`)
    const { circleIds, ...rest } = plan.set
    console.log(`${tag} recipe ${r.recipeId} "${r.title}" owner=${plan.ownerSub}${plan.usedFallback ? " (fallback)" : ""}`)
    if (!APPLY) continue
    const names = {}, values = { ":cids": circleIds, ":v": plan.set.schemaV }
    const sets = Object.entries(rest).map(([k, v], i) => {
      names[`#a${i}`] = k
      values[`:a${i}`] = v
      return `#a${i} = :a${i}`
    })
    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: RECIPES_TABLE, Key: { recipeId: r.recipeId },
            UpdateExpression: `SET ${sets.join(", ")} ADD circleIds :cids`,
            ConditionExpression: "attribute_exists(recipeId) AND (attribute_not_exists(schemaV) OR schemaV <> :v)",
            ExpressionAttributeNames: names, ExpressionAttributeValues: values,
          },
        },
        {
          Put: {
            TableName: CIRCLES_TABLE,
            Item: { pk: circlePk(CID), sk: recipeSk(r.recipeId), sharedBySub: plan.ownerSub, sharedAt: now },
          },
        },
      ],
    }))
  }

  // 4. Open sign-up codes put new people in the founding circle as editors.
  const invites = await scanAll(INVITES_TABLE, {
    FilterExpression: "sk = :meta", ExpressionAttributeValues: { ":meta": "META" },
  })
  let invitesUpdated = 0
  for (const inv of invites) {
    const set = planInvite(inv, { cid: CID, now })
    if (!set) continue
    invitesUpdated++
    console.log(`${tag} invite ${inv.code}`)
    if (!APPLY) continue
    const keys = Object.keys(set)
    await ddb.send(new UpdateCommand({
      TableName: INVITES_TABLE, Key: { code: inv.code, sk: "META" },
      UpdateExpression: "SET " + keys.map((k, i) => `#k${i} = :v${i}`).join(", "),
      ConditionExpression: "attribute_exists(code)",
      ExpressionAttributeNames: Object.fromEntries(keys.map((k, i) => [`#k${i}`, k])),
      ExpressionAttributeValues: Object.fromEntries(keys.map((k, i) => [`:v${i}`, set[k]])),
    }))
  }

  console.log("\nSummary")
  console.log(`  members ${APPLY ? "added" : "to add"}: ${added} of ${members.length} confirmed users`)
  console.log(`  recipes ${APPLY ? "migrated" : "to migrate"}: ${migrated} (already migrated: ${skipped})`)
  console.log(`  recipes given the fallback owner: ${fallbacks.length}`)
  for (const f of fallbacks) console.log(`    ${f}`)
  console.log(`  sign-up codes ${APPLY ? "updated" : "to update"}: ${invitesUpdated} of ${invites.length}`)
  if (!APPLY) console.log("\nNothing written. Re-run with --apply.")
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
