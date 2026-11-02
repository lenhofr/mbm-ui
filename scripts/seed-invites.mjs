import { DynamoDBClient, BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import crypto from "node:crypto";

const TABLE = process.env.TABLE || "mbm-invites";
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const COUNT = Number(process.env.COUNT || 20);
const PREFIX = process.env.PREFIX || "FNF";
const CODE_LEN = Number(process.env.CODE_LEN || 8); // random part length
const TTL_DAYS = process.env.TTL_DAYS ? Number(process.env.TTL_DAYS) : null;
// Optional: people who sign up with these codes also join this brigade as Sous-chefs
// (docs/recipe-circles.md §6.9), e.g. the founding one, 3c5342e4efa44ad68937eaed08036dda.
const CIRCLE_ID = process.env.CIRCLE_ID;

const client = new DynamoDBClient({ region: REGION });

const rand = (n) => crypto.randomBytes(n).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, n);
const now = Math.floor(Date.now() / 1000);
const expiresAt = TTL_DAYS ? now + TTL_DAYS * 24 * 3600 : undefined;

const makeCode = () => `${PREFIX}-${rand(CODE_LEN)}`;

const items = Array.from({ length: COUNT }, () => {
  const code = makeCode();
  const item = {
    code: { S: code },
    sk: { S: 'META' },
    maxUses: { N: '1' },
    uses: { N: '0' },
    issuedAt: { N: String(now) },
    // Sign-up codes: only these (and older codes with no kind) can create accounts.
    kind: { S: 'signup' },
    allowSignup: { BOOL: true },
  };
  if (CIRCLE_ID) {
    item.circleId = { S: CIRCLE_ID };
    item.circleRole = { S: 'editor' };
  }
  if (expiresAt) item.expiresAt = { N: String(expiresAt) };
  return { PutRequest: { Item: item } };
});

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
for (const batch of chunks(items, 25)) {
  const cmd = new BatchWriteItemCommand({ RequestItems: { [TABLE]: batch } });
  const res = await client.send(cmd);
  if (res.UnprocessedItems && Object.keys(res.UnprocessedItems).length) {
    console.warn("UnprocessedItems, rerun to finish:", res.UnprocessedItems);
  }
}

console.log("Codes:");
for (const r of items) console.log(r.PutRequest.Item.code.S);
console.log(`Seeded ${items.length} codes into ${TABLE} (${REGION})`);
