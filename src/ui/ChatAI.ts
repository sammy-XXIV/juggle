import { laneToDirection, type RoundLog, type RunResult, type TradeEngine } from "../trade/TradeEngine";
import type { Player } from "../game/Player";
import { LEADERBOARD_URL } from "../config";

const DIRECTION = { "-1": "SHORT", "0": "FLAT", "1": "LONG" } as const;
const dirName = (d: number) => DIRECTION[String(d) as "-1" | "0" | "1"];
const signed = (n: number, digits = 2) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(digits)}`;

function describeRound(r: RoundLog, i: number): string {
  const outcome = r.dir === 0 ? "no position" : Math.sign(r.movePct) === r.dir ? "correct call" : r.movePct === 0 ? "no move" : "wrong call";
  return `R${i + 1} ${dirName(r.dir)} ${r.dir === 0 ? "" : `${r.leverage}x `}while SOL ${signed(r.movePct, 3)}% = ${outcome}`;
}

export interface ChatContext {
  solPrice: number;
  engine: TradeEngine | null;
  player: Player | null;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function buildContext(ctx: ChatContext): string {
  const parts: string[] = [];
  if (ctx.solPrice > 0) parts.push(`SOL price: $${ctx.solPrice.toFixed(2)}`);
  if (ctx.player) parts.push(`Lane: ${dirName(laneToDirection(ctx.player.lane))}`);
  if (ctx.engine) {
    const e = ctx.engine;
    parts.push(`Open position: ${dirName(e.position)}`);
    parts.push(`P&L: ${signed(e.pnl)} USD (${signed(e.returnPct, 1)}%)`);
    parts.push(`Leverage: ${e.crank}x`);
    parts.push(`Streak: ${e.streak}`);
    parts.push(e.skrStaked > 0 ? `SKR shield: ${e.skrStaked} SKR staked, covers ${e.skrCoveragePct.toFixed(0)}% of a losing run` : "SKR shield: none");
    const recent = e.rounds.map(describeRound).slice(-5);
    if (recent.length) parts.push(`Last rounds: ${recent.join("; ")}`);
  }
  if (ctx.player) parts.push(`SKR coins collected: ${ctx.player.skr.toFixed(1)}`);
  return parts.join(", ") || "No active run";
}

/** Automatic post-run coaching: the model reads the round-by-round log and explains the outcome. */
export function debriefRun(run: RunResult): Promise<string> {
  const rounds = run.rounds.map(describeRound).slice(-15);
  const calls = run.rounds.filter((r) => r.dir !== 0);
  const correct = calls.filter((r) => Math.sign(r.movePct) === r.dir).length;
  const context = [
    "Run just ended",
    `Stake: $${run.stake}`,
    `Final P&L: ${signed(run.pnl)} USD (${signed(run.returnPct, 1)}%)`,
    `Best streak: ${run.bestStreak}`,
    `Directional calls: ${correct} correct out of ${calls.length}`,
    run.skrStaked > 0
      ? run.skrBurned > 0
        ? `SKR shield: ${run.skrBurned} SKR burned, absorbed $${run.shieldAbsorbed.toFixed(2)}`
        : `SKR shield: ${run.skrStaked} SKR staked, not burned`
      : "SKR shield: none",
    `Rounds: ${rounds.join("; ") || "none completed"}`,
  ].join(", ");
  return callAI(
    "Debrief this run in at most 2 short sentences: say which lane calls or leverage choices decided the result, then give one concrete tip for the next run.",
    context,
  );
}

async function callAI(question: string, context: string): Promise<string> {
  const res = await fetch(`${LEADERBOARD_URL}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, context }),
  });
  const data = await res.json().catch(() => ({})) as { answer?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "AI unavailable");
  return data.answer ?? "No response";
}

export class ChatAI {
  private modal = $("chat-modal");
  private messages = $("chat-messages");
  private input = document.getElementById("chat-input") as HTMLInputElement;
  private ctx: ChatContext = { solPrice: 0, engine: null, player: null };
  private sending = false;

  constructor() {
    $("btn-chat-hud").addEventListener("click", () => this.open());
    $("btn-chat-close").addEventListener("click", () => this.close());
    $("btn-chat-send").addEventListener("click", () => void this.send());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.send();
    });
  }

  setContext(ctx: ChatContext): void {
    this.ctx = ctx;
  }

  open(): void {
    this.modal.hidden = false;
    this.input.focus();
  }

  close(): void {
    this.modal.hidden = true;
  }

  private async send(): Promise<void> {
    if (this.sending) return;
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = "";
    this.sending = true;
    this.addMsg(text, "user");
    const thinking = this.addMsg("…", "ai");
    try {
      const answer = await callAI(text, buildContext(this.ctx));
      thinking.querySelector("span")!.textContent = answer;
    } catch {
      thinking.querySelector("span")!.textContent = "Couldn't reach AI right now — try again.";
    } finally {
      this.sending = false;
    }
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  private addMsg(text: string, role: "user" | "ai"): HTMLElement {
    const div = document.createElement("div");
    div.className = `chat-msg chat-msg--${role}`;
    const span = document.createElement("span");
    span.textContent = text;
    div.appendChild(span);
    this.messages.appendChild(div);
    this.messages.scrollTop = this.messages.scrollHeight;
    return div;
  }
}
