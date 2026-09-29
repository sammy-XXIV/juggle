import type { TradeEngine } from "../trade/TradeEngine";
import type { Player } from "../game/Player";
import { LEADERBOARD_URL } from "../config";

export interface ChatContext {
  solPrice: number;
  engine: TradeEngine | null;
  player: Player | null;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function buildContext(ctx: ChatContext): string {
  const parts: string[] = [];
  if (ctx.solPrice > 0) parts.push(`SOL price: $${ctx.solPrice.toFixed(2)}`);
  if (ctx.engine) {
    parts.push(`P&L: ${ctx.engine.pnl >= 0 ? "+" : ""}$${ctx.engine.pnl.toFixed(2)} (${ctx.engine.returnPct.toFixed(1)}%)`);
    parts.push(`Leverage: ${ctx.engine.crank}x`);
    parts.push(`Streak: ${ctx.engine.streak}`);
  }
  if (ctx.player) parts.push(`SKR collected: ${ctx.player.skr.toFixed(1)}`);
  return parts.join(", ") || "No active run";
}

async function callAI(question: string, ctx: ChatContext): Promise<string> {
  const res = await fetch(`${LEADERBOARD_URL}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, context: buildContext(ctx) }),
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
      const answer = await callAI(text, this.ctx);
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
