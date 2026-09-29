import bs58 from "bs58";

interface Env {
  DB: D1Database;
  PACIFICA_API_URL: string;
  MARKET: string;
  MAX_LEVERAGE: string;
  ORBIO_API_KEY: string;
}

interface Fill {
  symbol: string;
  side: string;
  amount: string;
  price: string;
  fee: string;
  pnl: string;
  created_at: number;
}

const NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const SIGNATURE_MAX_AGE_MS = 5 * 60_000;
const MAX_RUN_MS = 2 * 60 * 60_000;
const MIN_STAKE = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
const fail = (error: string, status = 400) => json({ error }, status);

export function nameMessage(name: string, account: string, timestamp: number): string {
  return `Juggle leaderboard name\nname: ${name}\naccount: ${account}\ntimestamp: ${timestamp}`;
}

async function verifySignature(account: string, message: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", bs58.decode(account), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, bs58.decode(signature), new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

async function fetchFills(env: Env, account: string, start: number, end: number): Promise<Fill[]> {
  const fills: Fill[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ account, start_time: String(start), end_time: String(end), limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`${env.PACIFICA_API_URL}/trades/history?${params}`);
    const body = (await res.json()) as { success: boolean; data: Fill[]; next_cursor?: string; has_more?: boolean };
    if (!res.ok || !body.success) throw new Error("Could not read trades from Pacifica");
    fills.push(...body.data);
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return fills.filter((f) => f.symbol === env.MARKET);
}

async function registerName(req: Request, env: Env): Promise<Response> {
  const { account, name, timestamp, signature } = (await req.json()) as Record<string, string & number>;
  if (!account || !signature || typeof timestamp !== "number") return fail("Missing fields");
  if (!NAME_PATTERN.test(name ?? "")) return fail("Name must be 3–16 letters, numbers or _");
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_AGE_MS) return fail("Signature expired, try again");
  if (!(await verifySignature(account, nameMessage(name, account, timestamp), signature))) {
    return fail("Signature does not match this wallet", 401);
  }
  const taken = await env.DB.prepare("SELECT account FROM players WHERE name = ?1").bind(name).first<{ account: string }>();
  if (taken && taken.account !== account) return fail("That name is taken", 409);
  await env.DB.prepare(
    "INSERT INTO players (account, name, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(account) DO UPDATE SET name = excluded.name",
  ).bind(account, name, Date.now()).run();
  return json({ account, name });
}

async function getPlayer(account: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare("SELECT account, name FROM players WHERE account = ?1").bind(account).first();
  return row ? json(row) : fail("Not registered", 404);
}

/** Scores a run from the player's actual Pacifica fills, never from numbers the app reports. */
async function submitRun(req: Request, env: Env): Promise<Response> {
  const { account, startedAt, endedAt, stake } = (await req.json()) as Record<string, string & number>;
  const now = Date.now();
  if (!account || [startedAt, endedAt, stake].some((v) => typeof v !== "number")) return fail("Missing fields");
  if (endedAt < startedAt || endedAt - startedAt > MAX_RUN_MS || endedAt > now + 60_000) return fail("Invalid run window");
  const player = await env.DB.prepare("SELECT name FROM players WHERE account = ?1").bind(account).first();
  if (!player) return fail("Pick a name first", 403);

  const fills = await fetchFills(env, account, startedAt, endedAt + 30_000);
  if (fills.length === 0) return fail("No trades found for this run", 422);

  const pnl = fills.reduce((sum, f) => sum + Number(f.pnl) - Number(f.fee), 0);
  const largestPosition = Math.max(
    ...fills.filter((f) => f.side.startsWith("open")).map((f) => Number(f.amount) * Number(f.price)),
    0,
  );
  const effectiveStake = Math.max(stake, largestPosition / Number(env.MAX_LEVERAGE), MIN_STAKE);
  const returnPct = (pnl / effectiveStake) * 100;

  await env.DB.prepare(
    `INSERT INTO runs (account, started_at, ended_at, stake, pnl, return_pct, fills)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(account, started_at) DO UPDATE SET ended_at = excluded.ended_at, stake = excluded.stake,
       pnl = excluded.pnl, return_pct = excluded.return_pct, fills = excluded.fills`,
  ).bind(account, startedAt, endedAt, effectiveStake, pnl, returnPct, fills.length).run();

  const rank = await env.DB.prepare(
    `SELECT COUNT(*) + 1 AS rank FROM (
       SELECT account, MAX(return_pct) AS best FROM runs WHERE ended_at >= ?1 GROUP BY account
     ) WHERE best > ?2`,
  ).bind(startOfUtcDay(now), returnPct).first<{ rank: number }>();

  return json({ pnl, returnPct, stake: effectiveStake, fills: fills.length, dailyRank: rank?.rank ?? null });
}

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function leaderboard(board: string, env: Env): Promise<Response> {
  const since = board === "daily" ? startOfUtcDay(Date.now()) : 0;
  const { results } = await env.DB.prepare(
    `SELECT p.name, r.account, MAX(r.return_pct) AS best, COUNT(*) AS runs
     FROM runs r JOIN players p ON p.account = r.account
     WHERE r.ended_at >= ?1
     GROUP BY r.account ORDER BY best DESC LIMIT 50`,
  ).bind(since).all();
  return json({ board, entries: results });
}

async function chat(req: Request, env: Env): Promise<Response> {
  const { question, context } = await req.json<{ question: string; context: string }>();
  if (!question?.trim()) return fail("No question provided", 400);

  const systemPrompt = `You are Juggle AI, the in-game assistant for Juggle — a Solana mobile game where players run a BONK dog on 3 lanes (LEFT=SHORT SOL, MIDDLE=FLAT, RIGHT=LONG SOL) and their lane choice becomes a real leveraged perpetuals trade on Pacifica DEX every 20 seconds. Players collect SKR coins and can stake SKR as loss insurance.

Rules:
- Keep answers short, sharp, direct. No markdown, no asterisks.
- Use the context provided for any account, P&L, price, streak, SKR, or leverage questions. Never say "I don't know" — derive the answer from context or game logic.
- Answer anything about: game mechanics, the player's current run, P&L, lanes, SKR shield, leverage, leaderboard strategy, Pacifica DEX, SOL price action, BONK, trading tips.
- If the question has nothing to do with Juggle, crypto, trading, or the player's account, reply: "I only know Juggle. Ask me about the game, your P&L, lanes, or SKR."
`;

  const res = await fetch("https://api.orbio.so/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.ORBIO_API_KEY}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      max_tokens: 256,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Context: ${context}\n\nQuestion: ${question}` },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return fail(`AI error: ${err}`, 502);
  }

  const data = await res.json<{ choices: { message: { content: string } }[] }>();
  const raw = data.choices?.[0]?.message?.content ?? "Sorry, I couldn't get a response.";
  const answer = raw.replace(/\*+/g, "").replace(/#+\s/g, "").trim();
  return json({ answer });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    try {
      if (req.method === "POST" && url.pathname === "/players") return await registerName(req, env);
      if (req.method === "GET" && url.pathname.startsWith("/players/")) {
        return await getPlayer(url.pathname.slice("/players/".length), env);
      }
      if (req.method === "POST" && url.pathname === "/runs") return await submitRun(req, env);
      if (req.method === "GET" && url.pathname === "/leaderboard") {
        return await leaderboard(url.searchParams.get("board") ?? "daily", env);
      }
      if (req.method === "POST" && url.pathname === "/chat") return await chat(req, env);
      return fail("Not found", 404);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Server error", 500);
    }
  },
} satisfies ExportedHandler<Env>;
