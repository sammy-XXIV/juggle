import type { MarketSpec } from "../pacifica/api";
import { pacifica, type TradingAccount } from "../pacifica/account";
import { Haptics } from "../haptics";
import { Sounds } from "../sounds";

export const ROUND_MS = 20_000;
export const CRANK_LEVELS = [1, 2, 3, 5, 10, 15, 20];
const CRANK_UNLOCK_STREAK = [0, 0, 0, 0, 0, 0, 0]; // all levels available from the start
const EQUITY_POLL_MS = 4_000;

/** -1 short, 0 flat, 1 long. Left lane shorts, middle is flat, right lane longs. */
export type Direction = -1 | 0 | 1;

export function laneToDirection(lane: number): Direction {
  return lane === 0 ? -1 : lane === 2 ? 1 : 0;
}

export interface RunResult {
  startedAt: number;
  endedAt: number;
  stake: number;
  pnl: number;
  returnPct: number;
  bestStreak: number;
  skrBurned: number;
  shieldAbsorbed: number;
}

/**
 * Turns the player's lane into a real Pacifica position, one decision per round.
 * Streaks of correct calls unlock higher leverage on the crank.
 */
export class TradeEngine {
  streak = 0;
  bestStreak = 0;
  crank = CRANK_LEVELS[CRANK_LEVELS.length - 1]; // start at 5x
  pnl = 0;
  lastError: string | null = null;

  private readonly account: TradingAccount;
  private readonly market: MarketSpec;
  private readonly stake: number;
  private startEquity = 0;
  private startedAt = 0;
  private roundStartedAt = 0;
  private roundStartPrice = 0;
  private price = 0;
  private held: Direction = 0;
  private heldAmount = 0; // in base units (SOL)
  private busy = false;
  private ended = false;
  private equityTimer: number | undefined;

  private readonly skrStaked: number;

  constructor(account: TradingAccount, market: MarketSpec, stake: number, skrStaked = 0) {
    this.account = account;
    this.market = market;
    this.stake = stake;
    this.skrStaked = skrStaked;
  }

  /** Coverage fraction: 50 SKR = 10%, max 250 SKR = 50%. */
  get skrCoveragePct(): number {
    return Math.min(this.skrStaked / 250, 1) * 50;
  }

  get maxCrank(): number {
    let max = CRANK_LEVELS[0];
    CRANK_LEVELS.forEach((level, i) => {
      if (this.streak >= CRANK_UNLOCK_STREAK[i]) max = level;
    });
    return max;
  }

  get position(): Direction {
    return this.held;
  }

  get returnPct(): number {
    return (this.pnl / this.stake) * 100;
  }

  roundMsLeft(now: number): number {
    return Math.max(0, ROUND_MS - (now - this.roundStartedAt));
  }

  cycleCrank(): void {
    const unlocked = CRANK_LEVELS.filter((l) => l <= this.maxCrank);
    const i = unlocked.indexOf(this.crank);
    this.crank = unlocked[(i + 1) % unlocked.length];
  }

  async begin(price: number, now: number): Promise<void> {
    const info = await this.account.info();
    if (!info) throw new Error("Deposit USDC before playing");
    if (Number(info.available_to_spend) < this.stake) throw new Error("Stake is more than your available balance");
    await pacifica.updateLeverage(
      this.account.address,
      this.market.symbol,
      Math.min(this.market.max_leverage, CRANK_LEVELS[CRANK_LEVELS.length - 1]),
      this.account.agent,
    );
    this.startEquity = Number(info.account_equity);
    this.startedAt = now;
    this.roundStartedAt = now;
    this.price = price;
    this.roundStartPrice = price;
    this.equityTimer = window.setInterval(() => void this.refreshPnl(), EQUITY_POLL_MS);
  }

  /** Called every frame. Returns true once the stake is gone and the run must stop. */
  tick(now: number, lane: number, price: number): boolean {
    if (this.ended) return false;
    if (price > 0) this.price = price;
    if (now - this.roundStartedAt >= ROUND_MS) {
      this.scoreRound();
      this.roundStartedAt = now;
      this.roundStartPrice = this.price;
      Haptics.round(); Sounds.round();
      void this.moveTo(laneToDirection(lane));
    }
    return this.pnl <= -this.stake;
  }

  async end(now: number): Promise<RunResult> {
    this.ended = true;
    window.clearInterval(this.equityTimer);
    while (this.busy) await new Promise((r) => setTimeout(r, 100));
    await this.moveTo(0, true);
    await this.refreshPnl();

    let skrBurned = 0;
    let shieldAbsorbed = 0;
    if (this.pnl < 0 && this.skrStaked > 0) {
      const coverage = this.skrCoveragePct / 100;
      shieldAbsorbed = Math.min(Math.abs(this.pnl) * coverage, Math.abs(this.pnl));
      skrBurned = this.skrStaked;
      this.pnl += shieldAbsorbed; // reduce the loss
      // mock burn — on mainnet this would be an SPL transfer to the burn address
      console.log(`[SKR Shield] Burned ${skrBurned} SKR, absorbed $${shieldAbsorbed.toFixed(2)} loss`);
    }

    return {
      startedAt: this.startedAt,
      endedAt: now,
      stake: this.stake,
      pnl: this.pnl,
      returnPct: this.returnPct,
      bestStreak: this.bestStreak,
      skrBurned,
      shieldAbsorbed,
    };
  }

  private scoreRound(): void {
    if (this.held === 0) return;
    const move = Math.sign(this.price - this.roundStartPrice);
    if (move === this.held) {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else if (move !== 0) {
      this.streak = 0;
      this.crank = Math.min(this.crank, this.maxCrank);
    }
  }

  private targetAmount(): number {
    const lot = Number(this.market.lot_size);
    const minNotional = Number(this.market.min_order_size);
    const notional = Math.max(this.stake * this.crank, minNotional);
    return Math.ceil(notional / this.price / lot) * lot;
  }

  private formatAmount(amount: number): string {
    const decimals = (this.market.lot_size.split(".")[1] ?? "").length;
    return amount.toFixed(decimals);
  }

  private async order(side: "bid" | "ask", amount: number, reduceOnly: boolean): Promise<void> {
    await pacifica.marketOrder(
      this.account.address,
      { symbol: this.market.symbol, side, amount: this.formatAmount(amount), reduceOnly },
      this.account.agent,
    );
  }

  private async moveTo(target: Direction, force = false): Promise<void> {
    if (this.busy || (this.ended && !force)) return;
    const targetAmount = target === 0 ? 0 : this.targetAmount();
    if (target === this.held && Math.abs(targetAmount - this.heldAmount) < 1e-9) return;
    this.busy = true;
    try {
      if (this.held !== 0 && (target !== this.held || targetAmount < this.heldAmount)) {
        await this.order(this.held === 1 ? "ask" : "bid", this.heldAmount, true);
        this.held = 0;
        this.heldAmount = 0;
      }
      if (target !== 0 && targetAmount > this.heldAmount) {
        await this.order(target === 1 ? "bid" : "ask", targetAmount - this.heldAmount, false);
        this.held = target;
        this.heldAmount = targetAmount;
      }
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }

  private async refreshPnl(): Promise<void> {
    try {
      const info = await this.account.info();
      if (info) this.pnl = Number(info.account_equity) - this.startEquity;
    } catch {
      // keep the last known P&L; the next poll will retry
    }
  }
}
