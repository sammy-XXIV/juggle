import { Game, type RunEndReason } from "./game/Game";
import { connectWallet, type Wallet } from "./wallet/wallet";
import { MIN_DEPOSIT_USDC, pacifica, TradingAccount } from "./pacifica/account";
import type { MarketSpec } from "./pacifica/api";
import { TradeEngine } from "./trade/TradeEngine";
import { fetchBoard, getName, registerName, submitRun } from "./leaderboard";
import { MARKET } from "./config";
import { ChatAI, debriefRun } from "./ui/ChatAI";
import { Haptics } from "./haptics";
import { Sounds } from "./sounds";
import { startMusic, stopMusic } from "./music";
import "./main.css";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SCREENS = ["landing", "name", "funding", "stake", "results", "howto", "leaderboard"] as const;
type Screen = (typeof SCREENS)[number];

const MIN_STAKE = 10;
const DEPOSIT_USDC = 100;

const game = new Game($<HTMLCanvasElement>("game-canvas"));
game.start();

const chat = new ChatAI();

let wallet: Wallet | null = null;
let account: TradingAccount | null = null;
let playerName: string | null = null;
let market: MarketSpec | null = null;
let engine: TradeEngine | null = null;
let stake = MIN_STAKE;
let skrStaked = 0;
let lastMode: "real" | "practice" = "real";

function show(screen: Screen | null): void {
  for (const id of SCREENS) $(id).hidden = id !== screen;
  $("hud").hidden = screen !== null;
  if (screen === "landing" || screen === "stake") void refreshBalances();
}

/** Trading USDC (Pacifica, available to spend) and wallet SKR, on the home chip and the stake screen. */
async function refreshBalances(): Promise<void> {
  const chip = $("balance-chip");
  chip.hidden = !account;
  if (!account) return;
  const acct = account;
  const [info, skr] = await Promise.all([acct.info().catch(() => null), acct.walletSkr()]);
  if (acct !== account) return;
  const usdc = info ? `$${Number(info.available_to_spend).toFixed(2)}` : "—";
  const skrText = skr.toFixed(0);
  $("bal-usdc").textContent = usdc;
  $("bal-skr").textContent = skrText;
  $("stake-balance").textContent = `Balance: ${usdc} USDC · ${skrText} SKR`;
}

let toastTimer: number | undefined;
function toast(message: string): void {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 4000);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Disables a button while its async action runs and surfaces any error as a toast. */
function action(id: string, run: () => Promise<void>): void {
  const button = $<HTMLButtonElement>(id);
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await run();
    } catch (e) {
      toast(errorText(e));
    } finally {
      button.disabled = false;
    }
  });
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function renderWalletChip(): void {
  $("btn-wallet").textContent = !wallet ? "CONNECT WALLET" : playerName ?? shortAddress(wallet.publicKey.toBase58());
  void refreshBalances();
}

async function connect(): Promise<void> {
  wallet = await connectWallet();
  account = new TradingAccount(wallet);
  playerName = await getName(account.address);
  renderWalletChip();
}

async function loadMarket(): Promise<MarketSpec> {
  if (!market) {
    market = (await pacifica.markets()).find((m) => m.symbol === MARKET) ?? null;
    if (!market) throw new Error(`${MARKET} market not found on Pacifica`);
  }
  return market;
}

// ---- Landing ----

action("btn-wallet", async () => {
  if (wallet) {
    await wallet.disconnect();
    wallet = null;
    account = null;
    playerName = null;
    renderWalletChip();
    return;
  }
  await connect();
});

action("btn-play", async () => {
  if (!wallet) await connect();
  lastMode = "real";
  if (!playerName) return show("name");
  await openFunding();
});

$("btn-practice").addEventListener("click", () => startPractice());
$("btn-howto").addEventListener("click", () => show("howto"));
$("btn-leaderboard").addEventListener("click", () => void openBoard("daily"));

for (const back of document.querySelectorAll<HTMLButtonElement>("[data-back]")) {
  back.addEventListener("click", () => show("landing"));
}

// ---- Name ----

action("btn-name-save", async () => {
  const input = $<HTMLInputElement>("name-input");
  const error = $("name-error");
  error.hidden = true;
  const name = input.value.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    error.textContent = "Use 3–16 letters, numbers or _";
    error.hidden = false;
    return;
  }
  try {
    playerName = await registerName(wallet!, name);
  } catch (e) {
    error.textContent = errorText(e);
    error.hidden = false;
    return;
  }
  renderWalletChip();
  await openFunding();
});

// ---- Funding ----

async function refreshFunding(): Promise<boolean> {
  const acct = account!;
  $("fund-address").textContent = `Wallet: ${acct.address}`;
  $("fund-status").textContent = "Checking balances…";
  const load = () => Promise.all([acct.walletSol(), acct.walletUsdc(), acct.info(), acct.walletSkr()]);
  // Returning from the wallet app, the first request sometimes drops ("Failed to fetch"); one quiet retry covers it.
  const [sol, usdc, info, skr] = await load().catch(async () => {
    await new Promise((r) => setTimeout(r, 1200));
    return load();
  });
  const balance = info ? Number(info.available_to_spend) : 0;
  const agentOn = acct.isAgentBound();

  $("fund-sol").textContent = `${sol.toFixed(3)} SOL`;
  $("fund-usdc").textContent = `$${usdc.toFixed(2)}`;
  $("fund-balance").textContent = `$${balance.toFixed(2)}`;
  $("fund-agent").textContent = agentOn ? "ON" : "OFF";
  $("fund-skr").textContent = `${skr.toFixed(0)} SKR`;

  const hasSol = sol >= 0.005;
  const hasSkr = skr >= 50;
  $("step-sol").classList.toggle("is-done", hasSol);
  $("step-usdc").classList.toggle("is-done", usdc >= MIN_DEPOSIT_USDC || balance >= MIN_STAKE);
  $("step-deposit").classList.toggle("is-done", balance >= MIN_STAKE);
  $("step-agent").classList.toggle("is-done", agentOn);
  $("step-skr").classList.toggle("is-done", hasSkr);

  $<HTMLButtonElement>("btn-mint").disabled = !hasSol;
  $<HTMLButtonElement>("btn-deposit").disabled = !hasSol || usdc < MIN_DEPOSIT_USDC;
  $<HTMLButtonElement>("btn-agent").disabled = !info || agentOn;
  $<HTMLButtonElement>("btn-mint-skr").disabled = hasSkr;
  const ready = balance >= MIN_STAKE && agentOn;
  $<HTMLButtonElement>("btn-fund-continue").disabled = !ready;
  $("fund-status").textContent = ready
    ? `Ready. $${balance.toFixed(2)} available to trade.`
    : !hasSol
      ? "Get a little devnet SOL for fees first. Balances update when you come back."
      : "";
  return ready;
}

// Returning from the faucet (another app or tab) should show the new balance without extra taps.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !$("funding").hidden && account) {
    void refreshFunding().catch((e) => toast(errorText(e)));
  }
});

async function openFunding(): Promise<void> {
  show("funding");
  const ready = await refreshFunding();
  if (ready) openStake();
}

action("btn-mint", async () => {
  $("fund-status").textContent = "Approve the mint in your wallet…";
  await account!.mintTestUsdc();
  await refreshFunding();
});

action("btn-deposit", async () => {
  const amount = Math.min(DEPOSIT_USDC, Math.floor(await account!.walletUsdc()));
  $("fund-status").textContent = `Approve the $${amount} deposit in your wallet…`;
  await account!.deposit(amount);
  $("fund-status").textContent = "Deposit sent. Pacifica can take a few seconds to credit it…";
  await new Promise((r) => setTimeout(r, 5000));
  await refreshFunding();
});

action("btn-agent", async () => {
  $("fund-status").textContent = "Sign once in your wallet to enable popup-free trading…";
  await account!.bindAgent();
  await refreshFunding();
});

action("btn-mint-skr", async () => {
  $("fund-status").textContent = "Minting test SKR…";
  await account!.mintTestSkr();
  await refreshFunding();
});

action("btn-fund-continue", async () => openStake());

$("btn-copy-address").addEventListener("click", () => {
  const address = account?.address ?? "";
  if (!address) return;
  navigator.clipboard.writeText(address).then(() => {
    const btn = $("btn-copy-address");
    btn.classList.add("copied");
    setTimeout(() => btn.classList.remove("copied"), 1500);
  }).catch(() => toast("Copy failed — select the address manually"));
});

// ---- Stake ----

const stakeAmount = $("stake-amount");
const stakeCustom = $<HTMLInputElement>("stake-custom");
const stakeError = $("stake-error");
const chips = Array.from(document.querySelectorAll<HTMLButtonElement>("#stake .chip:not(.skr-chip)"));
const skrChips = Array.from(document.querySelectorAll<HTMLButtonElement>("#stake .skr-chip"));

function setStake(value: number | null): void {
  stake = value ?? 0;
  stakeAmount.textContent = value === null ? "$—" : `$${value}`;
  stakeError.hidden = true;
}

function openStake(): void {
  show("stake");
}

for (const chip of chips) {
  chip.addEventListener("click", () => {
    chips.forEach((c) => c.classList.toggle("is-active", c === chip));
    stakeCustom.value = "";
    setStake(Number(chip.dataset.amount));
  });
}

function skrCoveragePct(skr: number): number {
  return Math.min(skr / 250, 1) * 50;
}

for (const chip of skrChips) {
  chip.addEventListener("click", () => {
    skrChips.forEach((c) => c.classList.toggle("is-active", c === chip));
    skrStaked = Number(chip.dataset.skr ?? 0);
    const pct = skrCoveragePct(skrStaked);
    $("skr-shield-coverage").textContent = skrStaked === 0 ? "No protection" : `${pct.toFixed(0)}% loss covered`;
  });
}

stakeCustom.addEventListener("input", () => {
  chips.forEach((c) => c.classList.remove("is-active"));
  const value = Number(stakeCustom.value.trim());
  setStake(stakeCustom.value.trim() === "" || !Number.isFinite(value) ? null : Math.round(value * 100) / 100);
});

action("btn-start", async () => {
  if (stake < MIN_STAKE) {
    stakeError.textContent = `Minimum stake is $${MIN_STAKE}.`;
    stakeError.hidden = false;
    return;
  }
  if (game.price <= 0) throw new Error("Waiting for live prices, try again in a moment");
  if (skrStaked > 0 && (await account!.walletSkr()) < skrStaked) {
    stakeError.textContent = `You need ${skrStaked} SKR in your wallet for this shield.`;
    stakeError.hidden = false;
    return;
  }
  const next = new TradeEngine(account!, await loadMarket(), stake, skrStaked);
  await next.begin(game.price, Date.now());
  engine = next;
  show(null);
  startMusic();
  game.play(engine);
});

// ---- Run ----

function startPractice(): void {
  lastMode = "practice";
  engine = null;
  show(null);
  startMusic();
  game.play(null);
}

$("btn-crank").addEventListener("click", () => { engine?.cycleCrank(); Haptics.tap(); Sounds.tap(); });
$("btn-cashout").addEventListener("click", () => { game.cashOut(); Haptics.cashOut(); Sounds.cashOut(); });

const REASON_TITLE: Record<RunEndReason, string> = {
  hit: "POSITION CLOSED",
  "stake-lost": "STAKE GONE",
  "cash-out": "CASHED OUT",
};

game.onRunEnd = (reason) => void finishRun(reason);
let debriefToken = 0;

async function finishRun(reason: RunEndReason): Promise<void> {
  stopMusic();
  show("results");
  $("result-title").textContent = REASON_TITLE[reason];
  $("result-rank").textContent = "";
  $("result-shield").hidden = true;
  $("result-coach").hidden = true;
  debriefToken++;

  if (!engine) {
    $("result-pnl").textContent = "PRACTICE";
    $("result-detail").textContent = "No money on the line. Hit PLAY when you're ready to trade.";
    return;
  }

  const finished = engine;
  engine = null;
  $("result-pnl").textContent = "…";
  $("result-detail").textContent = "Closing your position…";
  const run = await finished.end(Date.now());
  const sign = run.pnl >= 0 ? "+" : "−";
  $("result-pnl").textContent = `${sign}$${Math.abs(run.pnl).toFixed(2)}`;
  $("result-detail").textContent = `${sign}${Math.abs(run.returnPct).toFixed(1)}% on $${run.stake} · best streak ${run.bestStreak}`;
  const shieldEl = $("result-shield");
  shieldEl.replaceChildren();
  shieldEl.hidden = true;
  if (run.skrBurnSig) {
    const link = document.createElement("a");
    link.href = `https://explorer.solana.com/tx/${run.skrBurnSig}?cluster=devnet`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "view burn";
    shieldEl.append(`SKR Shield absorbed $${run.shieldAbsorbed.toFixed(2)} · ${run.skrBurned} SKR burned · `, link);
    shieldEl.hidden = false;
  } else if (run.skrBurnError) {
    const reason = /reject|declin|cancel/i.test(run.skrBurnError) ? "you declined it in your wallet" : run.skrBurnError.slice(0, 90);
    shieldEl.textContent = `SKR burn not confirmed (${reason}), so no shield was applied`;
    shieldEl.hidden = false;
  }

  const coach = $("result-coach");
  coach.hidden = true;
  const token = ++debriefToken;
  debriefRun(run)
    .then((text) => {
      if (token !== debriefToken) return;
      const label = document.createElement("b");
      label.textContent = "AI COACH";
      coach.replaceChildren(label, text);
      coach.hidden = false;
    })
    .catch(() => {});

  $("result-rank").textContent = "Submitting to the leaderboard…";
  try {
    const scored = await submitRun(account!.address, run);
    const shield = scored.shield > 0
      ? ` · shield +$${scored.shield.toFixed(2)} verified on-chain`
      : scored.shieldError ? ` · shield rejected: ${scored.shieldError}` : "";
    $("result-rank").textContent = scored.dailyRank
      ? `Verified ${scored.returnPct.toFixed(1)}%${shield} · #${scored.dailyRank} today`
      : `Verified ${scored.returnPct.toFixed(1)}%${shield}`;
  } catch (e) {
    $("result-rank").textContent = errorText(e);
  }
}

action("btn-again", async () => {
  if (lastMode === "practice") return startPractice();
  await openFunding();
});

// ---- Leaderboard ----

const boardChips = Array.from(document.querySelectorAll<HTMLButtonElement>("#leaderboard .chip"));
for (const chip of boardChips) {
  chip.addEventListener("click", () => void openBoard(chip.dataset.board as "daily" | "alltime"));
}

async function openBoard(board: "daily" | "alltime"): Promise<void> {
  show("leaderboard");
  boardChips.forEach((c) => c.classList.toggle("is-active", c.dataset.board === board));
  const list = $("board-list");
  const status = $("board-status");
  list.replaceChildren();
  status.textContent = "Loading…";
  try {
    const entries = await fetchBoard(board);
    status.textContent = entries.length ? "" : "No runs yet. Be the first.";
    entries.forEach((entry, i) => {
      const li = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = `#${i + 1}`;
      const name = document.createElement("span");
      name.textContent = entry.name;
      const ret = document.createElement("span");
      ret.className = entry.best >= 0 ? "ret-up" : "ret-down";
      ret.textContent = `${entry.best >= 0 ? "+" : ""}${entry.best.toFixed(1)}%`;
      li.append(rank, name, ret);
      list.append(li);
    });
  } catch (e) {
    status.textContent = errorText(e);
  }
}

setInterval(() => {
  chat.setContext({ solPrice: game.price, engine, player: game.currentPlayer });
}, 2000);

// play a tap sound on every button click across the whole app
document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("button")) Sounds.tap();
});

show("landing");
