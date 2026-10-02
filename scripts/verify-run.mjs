// Re-derives a leaderboard score from public data only (Pacifica fills + the Solana burn), mirroring
// leaderboard/src/index.ts (fetchFills, verifySkrBurn, submitRun). No Juggle server is involved.
//
// Usage: node scripts/verify-run.mjs <account> <startedAtMs> <endedAtMs> [burnSignature] [stake=10]
// Example (run traced in docs/VERIFICATION.md):
//   node scripts/verify-run.mjs 6CXVe2yWcC8pKide5JnpCjaVEbc56hBecdXKUoVZz9dq 1790946174776 1790946198899 \
//     5GWyZS4YpugVBmbgPxLxAyP2QNywe8hxMnvVhVVSLyS7bjEvMW6F1U1qZkWGLBGW7edNWnYmHzraTG8Qp1HL3PXW
const [account, startedAt, endedAt, burnSig, stakeArg] = process.argv.slice(2);
if (!account || !startedAt || !endedAt) {
  console.error("usage: node scripts/verify-run.mjs <account> <startedAtMs> <endedAtMs> [burnSignature] [stake]");
  process.exit(1);
}
const S = Number(startedAt), E = Number(endedAt), STAKE = Number(stakeArg ?? 10);

const PACIFICA = "https://test-api.pacifica.fi/api/v1";
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const SKR_MINT = "3zcV6Y9yxbYMgbyc2GSnfaFkMSx8tKX7pjvBfTf2w7qr";
const MAX_LEVERAGE = 5, MIN_STAKE = 10, SKR_FULL = 250, MAX_COVERAGE = 0.5, DECIMALS = 6;

// 1. Fills: the run window, plus 30 s for the closing fill (fetchFills + submitRun).
const q = new URLSearchParams({ account, start_time: String(S), end_time: String(E + 30_000), limit: "100" });
const fills = (await (await fetch(`${PACIFICA}/trades/history?${q}`)).json()).data.filter((f) => f.symbol === "SOL");
console.log(`1. Pacifica fills for ${account.slice(0, 6)}… in [start, end+30s]: ${fills.length}`);
for (const f of fills) console.log(`   ${f.side.padEnd(12)} ${f.amount} SOL @ ${f.price}  pnl ${f.pnl}  fee ${f.fee}`);

// 2. P&L and the stake floor (submitRun).
const pnl = fills.reduce((s, f) => s + Number(f.pnl) - Number(f.fee), 0);
const largest = Math.max(0, ...fills.filter((f) => f.side.startsWith("open")).map((f) => Number(f.amount) * Number(f.price)));
const stake = Math.max(STAKE, largest / MAX_LEVERAGE, MIN_STAKE);
console.log(`2. P&L = sum(pnl - fee) = ${pnl.toFixed(6)}`);
console.log(`   Stake floor = max(claimed ${STAKE}, largest open notional ${largest.toFixed(4)} / ${MAX_LEVERAGE}, ${MIN_STAKE}) = ${stake.toFixed(5)}`);

// 3. SKR burn (verifySkrBurn): only counts for a losing run.
let shield = 0;
if (burnSig && pnl < 0) {
  const tx = (await (await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [burnSig, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }] }),
  })).json()).result;
  const at = tx.blockTime * 1000;
  const checks = [];
  const burns = tx.transaction.message.instructions.filter((i) => i.program === "spl-token" && /^burn/.test(i.parsed?.type ?? ""));
  const mine = burns.filter((i) => i.parsed.info.mint === SKR_MINT && i.parsed.info.authority === account);
  const burned = mine.reduce((s, i) => s + Number(i.parsed.info.amount ?? i.parsed.info.tokenAmount?.amount ?? 0), 0) / 10 ** DECIMALS;
  checks.push(["transaction succeeded", !tx.meta.err]);
  checks.push(["inside the run window (start-60s … end+10min)", at >= S - 60_000 && at <= E + 10 * 60_000]);
  checks.push([`burns the SKR mint ${SKR_MINT.slice(0, 6)}…`, mine.length > 0]);
  checks.push(["signed by this account", mine.length > 0]);
  console.log(`3. Burn ${burnSig.slice(0, 10)}… at ${new Date(at).toISOString()}: ${burned} SKR`);
  for (const [name, ok] of checks) console.log(`   ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (checks.every(([, ok]) => ok)) shield = -pnl * Math.min(burned / SKR_FULL, 1) * MAX_COVERAGE;
  console.log(`   (duplicate-burn rejection needs the leaderboard database: skr_burn_sig is unique)`);
}
console.log(`   Shield = loss ${(-pnl).toFixed(6)} x min(burned/${SKR_FULL}, 1) x ${MAX_COVERAGE} = ${shield.toFixed(6)}`);

// 4. Score.
console.log(`4. return_pct = (pnl + shield) / stake x 100 = ${(((pnl + shield) / stake) * 100).toFixed(6)}`);
