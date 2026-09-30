// Run: node --test leaderboard/test/  (Node 22.6+ strips the TypeScript types)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";

const ACCOUNT = "91BdNXPJ9eaEVdPLSYhD1oSXG4uGnqR82YEpmTYzpdYv";
const OTHER = "2w8JdvKwipUXeeCt4AHt1vG4bDL5HuD3GBFGNfitrGaZ";
const SKR_MINT = "3zcV6Y9yxbYMgbyc2GSnfaFkMSx8tKX7pjvBfTf2w7qr";
const START = Date.now() - 120_000;
const END = START + 60_000;

// ---- In-memory stand-in for the three D1 queries submitRun makes ----
type Row = { account: string; started_at: number; return_pct: number; ended_at: number; skr_burn_sig: string | null };
class FakeDB {
  players = new Set<string>([ACCOUNT]);
  runs: Row[] = [];
  prepare(sql: string) {
    const db = this;
    return {
      bind: (...a: unknown[]) => ({
        async first() {
          if (sql.includes("FROM players")) return db.players.has(a[0] as string) ? { name: "tester" } : null;
          if (sql.includes("skr_burn_sig = ?1")) {
            return db.runs.find((r) => r.skr_burn_sig === a[0] && !(r.account === a[1] && r.started_at === a[2])) ? { 1: 1 } : null;
          }
          if (sql.includes("COUNT(*) + 1")) return { rank: 1 };
          return null;
        },
        async run() {
          const [account, started_at, ended_at, , , return_pct, , , , skr_burn_sig] = a as [string, number, number, number, number, number, number, number, number, string | null];
          db.runs = db.runs.filter((r) => !(r.account === account && r.started_at === started_at));
          db.runs.push({ account, started_at, ended_at, return_pct, skr_burn_sig });
          return {};
        },
        async all() { return { results: [] }; },
      }),
    };
  }
}

// ---- Network stubs: Pacifica trade history + Solana getTransaction ----
type Fill = { symbol: string; side: string; amount: string; price: string; fee: string; pnl: string; created_at: number };
let fills: Fill[] = [];
let txs: Record<string, unknown> = {};
let rpcBlocked = false;
let pacificaRequests: URL[] = [];
let rpcCalls = 0;

const env = () => ({
  DB: new FakeDB() as unknown,
  PACIFICA_API_URL: "https://pacifica.test/api/v1",
  MARKET: "SOL",
  MAX_LEVERAGE: "5",
  ORBIO_API_KEY: "unused",
  SOLANA_RPC_URL: "https://rpc.test",
  SKR_MINT,
});
let ENV = env();

beforeEach(() => {
  fills = [];
  txs = {};
  rpcBlocked = false;
  pacificaRequests = [];
  rpcCalls = 0;
  ENV = env();
});

globalThis.setTimeout = ((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout; // skip RPC retry waits
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.host === "pacifica.test") {
    pacificaRequests.push(url);
    return new Response(JSON.stringify({ success: true, data: fills, has_more: false }));
  }
  if (url.host === "rpc.test") {
    rpcCalls++;
    if (rpcBlocked) return new Response(JSON.stringify({ jsonrpc: "2.0", error: { message: "Your IP or provider is blocked from this endpoint" } }));
    const sig = JSON.parse(String(init?.body)).params[0];
    return new Response(JSON.stringify({ jsonrpc: "2.0", result: txs[sig] ?? null }));
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

function burnTx(o: { mint?: string; authority?: string; amount?: number; at?: number; err?: unknown; type?: string } = {}) {
  const raw = String(Math.round((o.amount ?? 150) * 1_000_000));
  const info = o.type === "burnChecked"
    ? { mint: o.mint ?? SKR_MINT, authority: o.authority ?? ACCOUNT, tokenAmount: { amount: raw } }
    : { mint: o.mint ?? SKR_MINT, authority: o.authority ?? ACCOUNT, amount: raw };
  return {
    blockTime: Math.floor((o.at ?? END + 5_000) / 1000),
    meta: { err: o.err ?? null },
    transaction: { message: { instructions: [{ program: "spl-token", parsed: { type: o.type ?? "burn", info } }] } },
  };
}

const losingFills = (): Fill[] => [
  { symbol: "SOL", side: "open_long", amount: "1.7", price: "118", fee: "0.08", pnl: "0", created_at: START + 20_000 },
  { symbol: "SOL", side: "close_long", amount: "1.7", price: "117.5", fee: "0.08", pnl: "-0.85", created_at: START + 40_000 },
];

async function submit(body: Record<string, unknown>) {
  const res = await worker.fetch(new Request("https://lb.test/runs", { method: "POST", body: JSON.stringify(body) }), ENV as never);
  return { status: res.status, body: (await res.json()) as Record<string, number & string & null> };
}
const run = (extra: Record<string, unknown> = {}) => submit({ account: ACCOUNT, startedAt: START, endedAt: END, stake: 10, ...extra });

// ================= Trading & leaderboard integrity =================

test("P&L comes from Pacifica fills, and numbers the app sends are ignored", async () => {
  fills = losingFills();
  const { status, body } = await run({ pnl: 999, returnPct: 500, shield: 50 });
  assert.equal(status, 200);
  assert.equal(body.pnl, -0.85 - 0.16); // sum of fill pnl minus fees
  assert.ok(body.returnPct < 0);
  assert.equal(body.shield, 0);
});

test("fills are fetched for this account over the run window (+30 s for the closing fill)", async () => {
  fills = losingFills();
  await run();
  const q = pacificaRequests[0].searchParams;
  assert.equal(q.get("account"), ACCOUNT);
  assert.equal(Number(q.get("start_time")), START);
  assert.equal(Number(q.get("end_time")), END + 30_000);
});

test("fills on other markets don't count", async () => {
  fills = [...losingFills(), { symbol: "BTC", side: "close_long", amount: "1", price: "1", fee: "0", pnl: "1000", created_at: START + 1 }];
  const { body } = await run();
  assert.equal(body.pnl, -0.85 - 0.16);
  assert.equal(body.fills, 2);
});

test("anti-spoof: a tiny claimed stake can't inflate return; stake is floored at position / max leverage", async () => {
  fills = losingFills(); // 1.7 SOL x $118 = $200.6 notional
  const { body } = await run({ stake: 0.01 });
  assert.equal(body.stake, (1.7 * 118) / 5);
});

test("runs with no trades, unregistered players and bad windows are rejected", async () => {
  assert.equal((await run()).status, 422); // no fills
  fills = losingFills();
  assert.equal((await submit({ account: OTHER, startedAt: START, endedAt: END, stake: 10 })).status, 403);
  assert.equal((await run({ endedAt: START - 1 })).status, 400);
  assert.equal((await run({ endedAt: START + 3 * 60 * 60_000 })).status, 400); // longer than 2 h
  assert.equal((await run({ startedAt: Date.now() + 120_000, endedAt: Date.now() + 180_000 })).status, 400); // future
});

// ================= SKR burn verification =================

test("verified burn: 150 SKR covers 30% of the loss", async () => {
  fills = losingFills();
  txs.good = burnTx();
  const { body } = await run({ skrBurnSig: "good" });
  assert.equal(body.skrBurned, 150);
  assert.ok(Math.abs(body.shield - 1.01 * 0.3) < 1e-9);
  assert.equal(body.shieldError, null);
});

test("coverage uses the amount actually burned, never a claimed amount (50 SKR = 10%, 1000 SKR capped at 50%)", async () => {
  fills = losingFills();
  txs.small = burnTx({ amount: 50 });
  assert.ok(Math.abs((await run({ skrBurnSig: "small", skrStaked: 250 })).body.shield - 1.01 * 0.1) < 1e-9);
  ENV = env();
  txs.huge = burnTx({ amount: 1000 });
  assert.ok(Math.abs((await run({ skrBurnSig: "huge" })).body.shield - 1.01 * 0.5) < 1e-9);
});

test("burnChecked instructions are accepted too", async () => {
  fills = losingFills();
  txs.checked = burnTx({ type: "burnChecked", amount: 250 });
  assert.equal((await run({ skrBurnSig: "checked" })).body.skrBurned, 250);
});

const rejected = async (sig: string, message: RegExp) => {
  fills = losingFills();
  const { status, body } = await run({ skrBurnSig: sig });
  assert.equal(status, 200, "run is still scored");
  assert.equal(body.shield, 0);
  assert.equal(body.skrBurned, 0);
  assert.match(body.shieldError, message);
};

test("rejects a burn of a different mint", async () => {
  txs.mint = burnTx({ mint: "So11111111111111111111111111111111111111112" });
  await rejected("mint", /not an SKR burn/);
});

test("rejects a burn signed by someone else", async () => {
  txs.signer = burnTx({ authority: OTHER });
  await rejected("signer", /not an SKR burn from this wallet/);
});

test("rejects a burn outside the run window", async () => {
  txs.early = burnTx({ at: START - 10 * 60_000 });
  await rejected("early", /does not belong to this run/);
  txs.late = burnTx({ at: END + 60 * 60_000 });
  await rejected("late", /does not belong to this run/);
});

test("rejects a burn transaction that failed on-chain", async () => {
  txs.failed = burnTx({ err: { InstructionError: [0, "InsufficientFunds"] } });
  await rejected("failed", /failed on-chain/);
});

test("rejects a signature that doesn't exist, after retrying", async () => {
  await rejected("missing", /not found/);
  assert.equal(rpcCalls, 8);
});

test("surfaces RPC errors instead of pretending the burn is missing", async () => {
  txs.good = burnTx();
  rpcBlocked = true;
  await rejected("good", /blocked/);
});

test("rejects reusing one burn for a second run, but allows re-submitting the same run", async () => {
  fills = losingFills();
  txs.once = burnTx();
  assert.ok((await run({ skrBurnSig: "once" })).body.shield > 0);
  assert.ok((await run({ skrBurnSig: "once" })).body.shield > 0, "same run re-submitted");
  const second = await submit({ account: ACCOUNT, startedAt: START + 1, endedAt: END, stake: 10, skrBurnSig: "once" });
  assert.equal(second.body.shield, 0);
  assert.match(second.body.shieldError, /already used/);
});

test("winning runs never consult the chain or pay a shield", async () => {
  fills = [{ symbol: "SOL", side: "close_long", amount: "1", price: "118", fee: "0.05", pnl: "2", created_at: START + 1 }];
  txs.good = burnTx();
  const { body } = await run({ skrBurnSig: "good" });
  assert.equal(body.shield, 0);
  assert.equal(rpcCalls, 0);
});
