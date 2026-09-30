import { PacificaPriceFeed, type PriceFeed, type PricePoint } from "./PriceFeed";
import { MARKET, PACIFICA_WS_URL } from "../config";
import { Player } from "./Player";
import { Track, PLAYER_Z } from "./Track";
import { bindInput } from "./Input";
import { Hud } from "../ui/Hud";
import { Renderer3D } from "./Renderer3D";
import type { TradeEngine } from "../trade/TradeEngine";
import { Haptics } from "../haptics";
import { Sounds } from "../sounds";

const HIT_WINDOW = 1.2;
const PRICE_WINDOW = 20; // ~60s of ticks at Pacifica's ~3s cadence
const MOMENTUM_FULL_SCALE = 0.0003; // a 0.03% move reads as a full trend (amplified for testnet)

export type RunEndReason = "hit" | "stake-lost" | "cash-out";

export class Game {
  /** Fired once per run when it ends, for any reason. */
  onRunEnd: (reason: RunEndReason) => void = () => {};

  private player = new Player();
  private track = new Track();
  private hud = new Hud();
  private feed: PriceFeed = new PacificaPriceFeed(PACIFICA_WS_URL, MARKET);
  private renderer: Renderer3D;
  private recentPrices: PricePoint[] = [];
  private lastTime = 0;
  private speed = 14; // world units per second
  private playing = false; // false = attract mode behind the menus
  private engine: TradeEngine | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer3D(canvas);
    bindInput(this.player, canvas);
  }

  get price(): number {
    return this.recentPrices[this.recentPrices.length - 1]?.price ?? 0;
  }

  get currentPlayer() {
    return this.player;
  }

  start(): void {
    this.feed.start((point) => {
      this.hud.setPrice(point.price, this.price);
      this.recentPrices.push(point);
      if (this.recentPrices.length > PRICE_WINDOW) this.recentPrices.shift();
    });
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  /** Starts a run. With an engine it trades for real; without one it's practice. */
  play(engine: TradeEngine | null): void {
    this.player.reset();
    this.track.entities = [];
    this.speed = 14;
    this.engine = engine;
    this.playing = true;
  }

  cashOut(): void {
    this.finish("cash-out");
  }

  private finish(reason: RunEndReason): void {
    if (!this.playing) return;
    this.playing = false;
    this.onRunEnd(reason);
  }

  private priceMomentum(): number {
    if (this.recentPrices.length < 2) return 0;
    const first = this.recentPrices[0].price;
    const last = this.price;
    const change = (last - first) / (first || 1);
    return Math.max(-1, Math.min(1, change / MOMENTUM_FULL_SCALE));
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.playing) {
      this.player.score += dt * 20;
      this.speed = 14 + Math.min(10, this.player.score / 200);
      this.track.update(dt, this.speed, this.priceMomentum());
      this.checkCollisions();
      const stakeGone = this.engine?.tick(Date.now(), this.player.lane, this.price) ?? false;
      if (!this.player.alive) this.finish("hit");
      else if (stakeGone) this.finish("stake-lost");
      this.hud.update(this.player, this.engine, Date.now());
    }

    this.renderer.update(this.player, this.track.entities, dt);
    requestAnimationFrame(this.loop);
  };

  private checkCollisions(): void {
    for (const e of this.track.entities) {
      if (Math.abs(e.z - PLAYER_Z) > HIT_WINDOW) continue;
      if (e.lane !== this.player.lane) continue;

      if (e.kind === "coin") {
        this.player.skr += 0.1;
        e.z = 999; // consume
        Haptics.coin(); Sounds.coin();
        continue;
      }

      Haptics.die(); Sounds.die();
      this.player.die();
    }
  }
}
