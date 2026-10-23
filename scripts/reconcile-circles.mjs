// Check mbm-recipes against mbm-circles (docs/recipe-circles.md §4.5, §10.2) and report
// anything out of line: missing or dangling share edges, recipes without an owner, bad
// index keys, circles with no owner or wrong counts, stalled circle deletes, stale names.
// Run it after the migration and after any manual data surgery.
//
// Report only by default; --fix repairs edges, finishes stalled deletes and fixes names.
// Owner and count problems are only reported: a person decides those.
//
// Usage (macOS zsh):
//   AWS_REGION=us-east-1 node scripts/reconcile-circles.mjs
//   AWS_REGION=us-east-1 node scripts/reconcile-circles.mjs --fix
//
// Optional env: RECIPES_TABLE (mbm-recipes), CIRCLES_TABLE (mbm-circles).
// Exits 1 when it finds problems (info-* lines don't count) and --fix wasn't passed.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { circlePk, memberSk, problems, reconcile, recipeSk } from "./lib/circles.mjs"

const REGION = process.env.AWS_REGION || process.env.REGION || "us-east-1"
const RECIPES_TABLE = process.env.RECIPES_TABLE || "mbm-recipes"
const CIRCLES_TABLE = process.env.CIRCLES_TABLE || "mbm-circles"
const FIX = process.argv.includes("--fix")

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))

async function scanAll(TableName) {
  const items = []
  let ExclusiveStartKey
  do {
    const res = await ddb.send(new ScanCommand({ TableName, ExclusiveStartKey }))
    items.push(...(res.Items || []))
    ExclusiveStartKey = res.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return items
}

const edgeKey = (cid, rid) => ({ pk: circlePk(cid), sk: recipeSk(rid) })

// Take cid out of the recipe's circleIds (no-op if the recipe or the id is gone) and drop the edge.
async function unshare(rid, cid) {
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: RECIPES_TABLE, Key: { recipeId: rid },
          UpdateExpression: "DELETE circleIds :c",
          ConditionExpression: "attribute_exists(recipeId)",
          ExpressionAttributeValues: { ":c": new Set([cid]) },
        },
      },
      { Delete: { TableName: CIRCLES_TABLE, Key: edgeKey(cid, rid) } },
    ],
  })).catch(async (e) => {
    // Recipe already deleted: just drop the edge.
    if (e?.name !== "TransactionCanceledException") throw e
    await ddb.send(new DeleteCommand({ TableName: CIRCLES_TABLE, Key: edgeKey(cid, rid) }))
  })
}

async function apply(fix) {
  switch (fix.op) {
    case "put-edge":
      return ddb.send(new PutCommand({
        TableName: CIRCLES_TABLE,
        Item: { ...edgeKey(fix.circleId, fix.recipeId), sharedBySub: fix.sharedBySub, sharedAt: Math.floor(Date.now() / 1000) },
      }))
    case "delete-edge":
      return ddb.send(new DeleteCommand({ TableName: CIRCLES_TABLE, Key: edgeKey(fix.circleId, fix.recipeId) }))
    case "unshare-recipe":
      return unshare(fix.recipeId, fix.circleId)
    case "set-circle-name":
      return ddb.send(new UpdateCommand({
        TableName: CIRCLES_TABLE, Key: { pk: circlePk(fix.circleId), sk: memberSk(fix.sub) },
        UpdateExpression: "SET circleName = :n", ConditionExpression: "attribute_exists(sk)",
        ExpressionAttributeValues: { ":n": fix.name },
      }))
    case "finish-delete":
      // Same order as DELETE /circles/{cid} (§6.5): recipes, members, then META.
      for (const rid of fix.recipeIds) await unshare(rid, fix.circleId)
      for (const sub of fix.memberSubs) {
        await ddb.send(new DeleteCommand({ TableName: CIRCLES_TABLE, Key: { pk: circlePk(fix.circleId), sk: memberSk(sub) } }))
      }
      return ddb.send(new DeleteCommand({ TableName: CIRCLES_TABLE, Key: { pk: circlePk(fix.circleId), sk: "META" } }))
    default:
      throw new Error(`unknown fix ${fix.op}`)
  }
}

async function main() {
  const [recipes, circleItems] = await Promise.all([scanAll(RECIPES_TABLE), scanAll(CIRCLES_TABLE)])
  console.log(`${recipes.length} recipes, ${circleItems.length} circle items (${REGION})`)
  const { issues, fixes } = reconcile(recipes, circleItems)

  const info = issues.filter(i => i.kind.startsWith("info-"))
  const bad = problems(issues)
  for (const i of bad) console.log(`problem ${JSON.stringify(i)}`)
  if (info.length) console.log(`info: ${info.length} recipe(s) still shared into a circle their owner left (allowed, §14.6)`)

  if (FIX) {
    for (const f of fixes) {
      console.log(`[fix] ${JSON.stringify(f)}`)
      await apply(f)
    }
    console.log(`Applied ${fixes.length} fix(es). Re-run without --fix to check.`)
  } else if (fixes.length) {
    console.log(`${fixes.length} fix(es) available; re-run with --fix to apply.`)
  }

  console.log(bad.length ? `Found ${bad.length} problem(s)${FIX ? " (before fixing)" : ""}.` : "No problems.")
  if (bad.length && !FIX) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
