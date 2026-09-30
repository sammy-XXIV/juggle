// Checks the shield verifier against a real devnet burn made by scripts/prove-skr-burn.mjs.
// Run: node leaderboard/check-burn.ts <burnSig> <burnerAddress>
import assert from "node:assert/strict";
import { verifySkrBurn } from "./src/index.ts";

const [sig, burner] = process.argv.slice(2);
const env = {
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
  SKR_MINT: "3zcV6Y9yxbYMgbyc2GSnfaFkMSx8tKX7pjvBfTf2w7qr",
} as Parameters<typeof verifySkrBurn>[0];

const res = await fetch(env.SOLANA_RPC_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { maxSupportedTransactionVersion: 0 }] }),
});
const at = ((await res.json()) as { result: { blockTime: number } }).result.blockTime * 1000;

assert.equal(await verifySkrBurn(env, sig, burner, at - 30_000, at), 150);
await assert.rejects(verifySkrBurn(env, sig, "11111111111111111111111111111111", at - 30_000, at), /not an SKR burn/);
await assert.rejects(verifySkrBurn(env, sig, burner, at + 3_600_000, at + 3_700_000), /does not belong/);
await assert.rejects(verifySkrBurn(env, "1".repeat(88), burner, 0, Date.now()), /not found/);
console.log("verifySkrBurn: all checks passed");
