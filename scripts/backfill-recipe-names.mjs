// Backfill createdByName/updatedByName from Cognito for existing recipes.
// - Fills only when names are missing or equal to placeholder values ("user", empty, null)
// - Requires read permissions to Cognito and read/write to DynamoDB table
//
// Usage (macOS zsh):
//   # Dry run (recommended first)
//   REGION=us-east-1 DDB_TABLE=mbm-recipes USER_POOL_ID=us-east-1_XXXX node scripts/backfill-recipe-names.mjs --dry-run
//
//   # Apply updates
//   REGION=us-east-1 DDB_TABLE=mbm-recipes USER_POOL_ID=us-east-1_XXXX node scripts/backfill-recipe-names.mjs

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider"

const REGION = process.env.REGION || "us-east-1"
const TABLE = process.env.DDB_TABLE
const USER_POOL_ID = process.env.USER_POOL_ID
const DRY = process.argv.includes("--dry-run") || process.argv.includes("-n")

if (!TABLE || !USER_POOL_ID) {
  console.error("DDB_TABLE and USER_POOL_ID env vars are required")
  process.exit(1)
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
const cognito = new CognitoIdentityProviderClient({ region: REGION })

function friendlyFromAttrs(attrs = []) {
  const map = Object.fromEntries(attrs.map(a => [a.Name, a.Value]))
  const nickname = map.nickname || map.preferred_username || map.name
  const given = map.given_name
  const family = map.family_name
  const email = map.email
  const emailLocal = email && email.includes("@") ? email.split("@")[0] : undefined
  const username = map["cognito:username"] || map.username

  const full = (given || family) ? `${given || ""} ${family || ""}`.trim() : undefined

  return (
    nickname ||
    full ||
    emailLocal ||
    username ||
    map.sub ||
    "user"
  )
}

async function getNameForSub(sub) {
  if (!sub) return undefined
  try {
    const out = await cognito.send(new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: sub,
    }))
    return friendlyFromAttrs(out.UserAttributes || [])
  } catch (e) {
    // User may not exist or is disabled; ignore and skip
    return undefined
  }
}

async function scanAll() {
  let items = []
  let ExclusiveStartKey = undefined
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE,
      ExclusiveStartKey,
    }))
    items = items.concat(res.Items || [])
    ExclusiveStartKey = res.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return items
}

function needsFill(name) {
  if (name === undefined || name === null) return true
  const v = String(name).trim().toLowerCase()
  return v === "" || v === "user" || v === "null" || v === "undefined"
}

async function main() {
  console.log(`Scanning table ${TABLE} in ${REGION}...`)
  const items = await scanAll()
  console.log(`Found ${items.length} item(s)`)

  let updatedCount = 0
  for (const item of items) {
    const id = item.recipeId || item.id
    if (!id) continue

    const createdByName = item.createdByName
    const updatedByName = item.updatedByName
    const createdBySub = item.createdBySub
    const updatedBySub = item.updatedBySub

    const needCreated = needsFill(createdByName) && !!createdBySub
    const needUpdated = needsFill(updatedByName) && !!updatedBySub

    if (!needCreated && !needUpdated) continue

    const updates = {}
    if (needCreated) {
      const n = await getNameForSub(createdBySub)
      if (n && !needsFill(n)) updates.createdByName = n
    }
    if (needUpdated) {
      const n = await getNameForSub(updatedBySub)
      if (n && !needsFill(n)) updates.updatedByName = n
    }

    if (Object.keys(updates).length === 0) continue

    updatedCount++
    console.log(`${DRY ? "[dry]" : "[set]"} ${id}`, updates)

    if (!DRY) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { recipeId: id },
        UpdateExpression: "SET " + Object.keys(updates).map((k, i) => `#k${i} = :v${i}`).join(", "),
        ExpressionAttributeNames: Object.fromEntries(Object.keys(updates).map((k, i) => [`#k${i}`, k])),
        ExpressionAttributeValues: Object.fromEntries(Object.values(updates).map((v, i) => [`:v${i}`, v])),
      }))
    }
  }

  console.log(`Done. ${DRY ? "Would update" : "Updated"} ${updatedCount} item(s).`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
