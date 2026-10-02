// Run: npx vitest run
import { beforeEach, describe, expect, test, vi } from "vitest";

const pacifica = vi.hoisted(() => ({ updateLeverage: vi.fn(async () => ({})), marketOrder: vi.fn(async (_account: string, _order: unknown, _agent?: unknown) => ({ order_id: 1 })) }));
vi.mock("../pacifica/account", () => ({ pacifica }));
vi.mock("../haptics", () => ({ Haptics: { round: vi.fn() } }));
vi.mock("../sounds", () => ({ Sounds: { round: vi.fn() } }));
vi.stubGlobal("window", globalThis);

import { TradeEngine } from "./TradeEngine";

const market = { symbol: "SOL", lot_size: "0.01", min_order_size: "10", max_leverage: 20 } as never;
let equity = 100;
const account = {
  address: "player",
  agent: { publicKey: "agent" },
  info: vi.fn(async () => ({ available_to_spend: "100", account_equity: String(equity) })),
  burnSkr: vi.fn(async (_amount: number) => "burnSig123"),
};

const orders = () => pacifica.marketOrder.mock.calls.map(([, o]) => o as { side: string; amount: string; reduceOnly: boolean });

async function started(stake = 10, skr = 0) {
  const engine = new TradeEngine(account as never, market, stake, skr);
  await engine.begin(100, 0);
  return engine;
}

beforeEach(() => {
  vi.clearAllMocks();
  equity = 100;
});

describe("orders", () => {
  test("no order before the first 20 s round; then the lane becomes a sized market order", async () => {
    const e = await started();
    e.tick(19_999, 2, 100);
    expect(pacifica.marketOrder).not.toHaveBeenCalled();
    e.tick(20_000, 2, 100); // right lane = long; 20x crank on $10 = $200 = 2.00 SOL
    await vi.waitFor(() => expect(orders()).toEqual([{ symbol: "SOL", side: "bid", amount: "2.00", reduceOnly: false }]));
  });

  test("switching long to short closes with a reduce-only order before opening the new side", async () => {
    const e = await started();
    e.tick(20_000, 2, 100);
    await vi.waitFor(() => expect(e.position).toBe(1));
    e.tick(40_000, 0, 100);
    await vi.waitFor(() => expect(orders()).toHaveLength(3));
    expect(orders()[1]).toMatchObject({ side: "ask", amount: "2.00", reduceOnly: true });
    expect(orders()[2]).toMatchObject({ side: "ask", amount: "2.00", reduceOnly: false });
    await vi.waitFor(() => expect(e.position).toBe(-1));
  });

  test("middle lane closes the position reduce-only and opens nothing", async () => {
    const e = await started();
    e.tick(20_000, 2, 100);
    await vi.waitFor(() => expect(e.position).toBe(1));
    e.tick(40_000, 1, 100);
    await vi.waitFor(() => expect(orders()).toHaveLength(2));
    expect(orders()[1]).toMatchObject({ side: "ask", reduceOnly: true });
    await vi.waitFor(() => expect(e.position).toBe(0));
  });

  test("leverage is capped at 20x and the market maximum", async () => {
    await started();
    expect(pacifica.updateLeverage).toHaveBeenCalledWith("player", "SOL", 20, account.agent);
    const lowCap = new TradeEngine(account as never, { ...(market as object), max_leverage: 5 } as never, 10);
    await lowCap.begin(100, 0);
    expect(pacifica.updateLeverage).toHaveBeenLastCalledWith("player", "SOL", 5, account.agent);
  });
});

describe("risk controls", () => {
  test("the run stops once P&L reaches -stake", async () => {
    const e = await started(10);
    e.pnl = -9.99;
    expect(e.tick(1_000, 1, 100)).toBe(false);
    e.pnl = -10;
    expect(e.tick(2_000, 1, 100)).toBe(true);
  });

  test("ending a run closes the open position reduce-only, and no orders are sent afterwards", async () => {
    const e = await started();
    e.tick(20_000, 0, 100);
    await vi.waitFor(() => expect(orders()).toHaveLength(1)); // short
    await e.end(25_000);
    expect(orders()[1]).toMatchObject({ side: "bid", amount: "2.00", reduceOnly: true });
    e.tick(60_000, 2, 100);
    await new Promise((r) => setTimeout(r, 20));
    expect(orders()).toHaveLength(2);
  });

  test("stake larger than the available balance is refused before any order", async () => {
    const e = new TradeEngine(account as never, market, 500);
    await expect(e.begin(100, 0)).rejects.toThrow(/more than your available balance/);
    expect(pacifica.marketOrder).not.toHaveBeenCalled();
  });
});

describe("SKR shield", () => {
  test("losing run: burns the staked SKR, then applies coverage (150 SKR = 30%)", async () => {
    const e = await started(10, 150);
    equity = 99; // -$1
    const run = await e.end(10_000);
    expect(account.burnSkr).toHaveBeenCalledWith(150);
    expect(run.skrBurnSig).toBe("burnSig123");
    expect(run.skrBurned).toBe(150);
    expect(run.shieldAbsorbed).toBeCloseTo(0.3);
    expect(run.pnl).toBeCloseTo(-0.7);
  });

  test("failed burn: no shield is applied and the error is reported", async () => {
    account.burnSkr.mockRejectedValueOnce(new Error("User rejected"));
    const e = await started(10, 150);
    equity = 99;
    const run = await e.end(10_000);
    expect(run.shieldAbsorbed).toBe(0);
    expect(run.skrBurned).toBe(0);
    expect(run.skrBurnSig).toBeNull();
    expect(run.skrBurnError).toMatch(/User rejected/);
    expect(run.pnl).toBeCloseTo(-1);
  });

  test("winning or no-shield runs burn nothing", async () => {
    const win = await started(10, 150);
    equity = 101;
    await win.end(10_000);
    const unshielded = await started(10, 0);
    equity = 99;
    await unshielded.end(10_000);
    expect(account.burnSkr).not.toHaveBeenCalled();
  });
});

test("a new round is ignored while the previous order is still in flight (one order at a time)", async () => {
  let release!: () => void;
  pacifica.marketOrder.mockImplementationOnce(() => new Promise((r) => (release = () => r({ order_id: 1 }))));
  const e = await started();
  e.tick(20_000, 2, 100);
  e.tick(40_000, 0, 100); // arrives while the long is still pending
  release();
  await vi.waitFor(() => expect(e.position).toBe(1));
  expect(orders()).toHaveLength(1);
});

test("cashing out mid-round still logs that last partial round, so the debrief sees the position", async () => {
  const e = await started();
  e.tick(20_000, 2, 100); // order fires: long
  await vi.waitFor(() => expect(e.position).toBe(1));
  e.tick(30_000, 2, 99); // mid-round, SOL -1%
  const run = await e.end(30_000);
  expect(run.rounds.at(-1)).toEqual({ dir: 1, leverage: 20, movePct: -1 });
});

test("every round is logged with direction, leverage and SOL move for the AI debrief", async () => {
  const e = await started();
  e.tick(20_000, 2, 100); // round 1: no position yet
  await vi.waitFor(() => expect(e.position).toBe(1));
  e.tick(40_000, 2, 101); // round 2: long while SOL +1%
  expect(e.rounds).toEqual([
    { dir: 0, leverage: 20, movePct: 0 },
    { dir: 1, leverage: 20, movePct: 1 },
  ]);
  expect(e.streak).toBe(1);
});
