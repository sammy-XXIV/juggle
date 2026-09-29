import bs58 from "bs58";
import { LEADERBOARD_URL } from "./config";
import type { RunResult } from "./trade/TradeEngine";
import type { Wallet } from "./wallet/wallet";

export interface BoardEntry {
  name: string;
  account: string;
  best: number;
  runs: number;
}

export interface ScoredRun {
  pnl: number;
  returnPct: number;
  dailyRank: number | null;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${LEADERBOARD_URL}${path}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Leaderboard error (${res.status})`);
  return data as T;
}

export async function getName(account: string): Promise<string | null> {
  try {
    return (await call<{ name: string }>(`/players/${account}`)).name;
  } catch {
    return null;
  }
}

/** The wallet signs this exact text; the server rebuilds it to verify ownership. */
function nameMessage(name: string, account: string, timestamp: number): string {
  return `Juggle leaderboard name\nname: ${name}\naccount: ${account}\ntimestamp: ${timestamp}`;
}

export async function registerName(wallet: Wallet, name: string): Promise<string> {
  const account = wallet.publicKey.toBase58();
  const timestamp = Date.now();
  const signature = await wallet.signMessage(new TextEncoder().encode(nameMessage(name, account, timestamp)));
  const saved = await call<{ name: string }>("/players", {
    account,
    name,
    timestamp,
    signature: bs58.encode(signature),
  });
  return saved.name;
}

export function submitRun(account: string, run: RunResult): Promise<ScoredRun> {
  return call<ScoredRun>("/runs", {
    account,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    stake: run.stake,
  });
}

export async function fetchBoard(board: "daily" | "alltime"): Promise<BoardEntry[]> {
  return (await call<{ entries: BoardEntry[] }>(`/leaderboard?board=${board}`)).entries;
}
