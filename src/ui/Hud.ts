import type { Player } from "../game/Player";
import { laneToDirection, ROUND_MS, type TradeEngine } from "../trade/TradeEngine";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const POSITION_LABEL = { "-1": "SHORT", "0": "FLAT", "1": "LONG" } as const;

const CIRCUMFERENCE = 2 * Math.PI * 24; // r=24

export class Hud {
  private pnl = $("hud-pnl");
  private sub = $("hud-sub");
  private skr = $("hud-skr");
  private error = $("hud-error");
  private crank = $("btn-crank") as HTMLButtonElement;
  private position = $("hud-position");
  private timerRing = $("hud-timer-ring") as unknown as SVGCircleElement;
  private timerSecs = $("hud-timer-secs");

  private setTimer(fraction: number, secs: number): void {
    const offset = CIRCUMFERENCE * (1 - fraction);
    this.timerRing.style.strokeDashoffset = String(offset);
    this.timerSecs.textContent = String(secs);
    const urgent = fraction < 0.25;
    this.timerRing.style.stroke = urgent ? "#ef4444" : "var(--green)";
    this.timerSecs.style.color = urgent ? "#ef4444" : "#fff";
  }

  update(player: Player, engine: TradeEngine | null, now: number): void {
    this.skr.textContent = `${player.skr.toFixed(1)} SKR`;
    const lane = POSITION_LABEL[String(laneToDirection(player.lane)) as "-1" | "0" | "1"];

    if (!engine) {
      this.pnl.textContent = "PRACTICE";
      this.pnl.dataset.tone = "flat";
      this.sub.textContent = `LANE: ${lane}`;
      this.crank.hidden = true;
      this.position.textContent = lane;
      this.error.hidden = true;
      this.setTimer(1, 20);
      return;
    }

    const sign = engine.pnl >= 0 ? "+" : "−";
    this.pnl.textContent = `${sign}$${Math.abs(engine.pnl).toFixed(2)} · ${sign}${Math.abs(engine.returnPct).toFixed(1)}%`;
    this.pnl.dataset.tone = engine.pnl > 0 ? "up" : engine.pnl < 0 ? "down" : "flat";
    const msLeft = engine.roundMsLeft(now);
    const secs = Math.ceil(msLeft / 1000);
    const fraction = msLeft / ROUND_MS;
    this.setTimer(fraction, secs);
    this.sub.textContent = `STREAK ${engine.streak} → ${lane}`;
    this.crank.hidden = false;
    this.crank.textContent = `${engine.crank}x${engine.maxCrank > engine.crank ? " ▲" : ""}`;
    this.position.textContent = POSITION_LABEL[String(engine.position) as "-1" | "0" | "1"];
    this.error.hidden = !engine.lastError;
    this.error.textContent = engine.lastError ?? "";
  }
}
