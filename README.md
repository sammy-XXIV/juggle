# Juggle

Surf the market. Dodge the red.

Juggle is an Android game for Solana Mobile where the lane you run in is a real perpetuals position on [Pacifica](https://pacifica.fi) (testnet). Left lane is SHORT SOL, middle is FLAT, right is LONG. Every 20 seconds your lane becomes a live market order. An AI coach explains every run, and staking SKR buys a loss shield that is paid for by burning SKR on-chain.

Built for the [Clock In Solana Mobile Hackathon](https://solanamobile.radiant.nexus).

- Pitch deck: https://sammy-xxiv.github.io/juggle/
- Code: this repo (Android app, Kotlin MWA plugin, Cloudflare Worker, SKR scripts)

## Who it is for, and the problem

**For:** crypto-curious mobile users and new perp traders on Seeker who have never opened a leveraged position, and don't want their first lesson to be losing real money in a dense order-book app.

**Problem:**
1. Perps are the most traded product in crypto, but beginners learn them by losing money. Leverage, direction and timing are abstract until you get liquidated.
2. Perp apps on phones are shrunk-down desktop order books. Nothing is built for a thumb and a 20-second attention span.
3. Feedback comes too late. By the time P&L turns red, nobody tells you which decision caused it.

**Why a game fixes it:** Juggle turns one decision (up, flat or down?) into a lane, gives it a 20-second clock, and makes leverage a single button. You learn direction and timing by reflex. The AI coach closes the loop by telling you, after every run, which calls won and lost.

**Why Solana Mobile:** Mobile Wallet Adapter lets the player sign once with their Seeker wallet and then play without popups. SKR, Seeker's own token, becomes an in-game edge, and every loss burns SKR supply.

## What is real (evidence)

| Claim | Where to verify |
|---|---|
| Lane becomes a live Pacifica order | `src/trade/TradeEngine.ts` (`moveTo`, `order`), `src/pacifica/api.ts` (`marketOrder`) |
| Wallet via Mobile Wallet Adapter | `android/app/src/main/java/com/radiants/juggle/SolanaMwaPlugin.kt`, `src/wallet/wallet.ts` |
| SKR burn from the player's wallet | `src/skr.ts` (`burnSkrInstruction`), `src/pacifica/account.ts` (`burnSkr`) |
| Shield only paid after the burn is verified on-chain | `leaderboard/src/index.ts` (`verifySkrBurn`, `submitRun`) |
| Leaderboard scored from real fills, not app numbers | `leaderboard/src/index.ts` (`fetchFills`, `submitRun`) |
| AI coach + automatic post-run debrief | `src/ui/ChatAI.ts` (`buildContext`, `debriefRun`), `leaderboard/src/index.ts` (`chat`) |
| Live testnet SOL price | `src/game/PriceFeed.ts` (Pacifica WebSocket `prices` stream) |

**On-chain SKR proof (Solana devnet)**
- SKR test mint: [`3zcV6Y9yxbYMgbyc2GSnfaFkMSx8tKX7pjvBfTf2w7qr`](https://explorer.solana.com/address/3zcV6Y9yxbYMgbyc2GSnfaFkMSx8tKX7pjvBfTf2w7qr?cluster=devnet)
- Burn of 150 SKR using the game's burn instruction: [`5rUKjwwm…Eaeg`](https://explorer.solana.com/tx/5rUKjwwmRizVGQezscnCJSnu45ZwNsQ3bPpbG6CbGZDMAp26CoU1VWP1TfRR46wVMSxQntuMNznQAF7eXzT6Eaeg?cluster=devnet). Supply went from 150 to 0.
- Reproduce: `node scripts/prove-skr-burn.mjs 150`, then check the leaderboard's verifier against it: `node leaderboard/check-burn.ts <burnSig> <playerAddress>`.

Every shielded losing run in the app shows its own burn with a "view burn" Explorer link on the results screen.

## Verify it yourself

```bash
npm install && (cd leaderboard && npm install)
npm test        # 12 trade-engine tests (Vitest) + 16 leaderboard/SKR tests (node --test)
node scripts/eval-coach.mjs 3   # AI coach eval against the live endpoint, writes docs/ai-eval.md
```

| What to check | Where | Test |
|---|---|---|
| Kotlin MWA plugin: authorize, sign message, sign and send transaction | `android/app/src/main/java/com/radiants/juggle/SolanaMwaPlugin.kt:66`, `:86`, `:97` | on device |
| Agent key bound once by a wallet signature | `src/pacifica/account.ts:91`, `src/pacifica/api.ts:100` | on device |
| Lane becomes a market order every 20 s, sized stake × leverage | `src/trade/TradeEngine.ts:124` (`tick`), `:190` (`targetAmount`), `:210` (`moveTo`) | `src/trade/TradeEngine.test.ts` "orders" |
| Switching sides and ending a run close reduce-only; one order at a time | `src/trade/TradeEngine.ts:210`, `:137` (`end`) | "switching long to short…", "ending a run…", "a new round is ignored…" |
| Loss stop at −stake | `src/trade/TradeEngine.ts:134` | "the run stops once P&L reaches -stake" |
| Shield only after a confirmed burn | `src/trade/TradeEngine.ts:151` | "SKR shield" tests |
| Leaderboard scores Pacifica fills, never app numbers | `leaderboard/src/index.ts:66` (`fetchFills`), `:142` (`submitRun`) | `leaderboard/test/worker.test.ts` "P&L comes from Pacifica fills…" |
| Anti-spoof stake floor (position ÷ max leverage) | `leaderboard/src/index.ts:158` | "anti-spoof…" |
| SKR burn verification: mint, signer, run window, failed or missing tx, RPC errors | `leaderboard/src/index.ts:83` (`verifySkrBurn`) | "rejects a burn…" tests |
| Duplicate burn rejected, re-submitting the same run allowed | `leaderboard/src/index.ts:167` | "rejects reusing one burn…" |
| Coverage from the amount actually burned (no claimed amounts) | `leaderboard/src/index.ts:83`, `:142` | "coverage uses the amount actually burned…" |
| SKR burn instruction the wallet signs | `src/skr.ts:36` | devnet proof above |
| AI coach context, debrief, risk rules | `src/ui/ChatAI.ts:22`, `:41`, `leaderboard/src/index.ts:213` | [docs/AI.md](docs/AI.md), [docs/ai-eval.md](docs/ai-eval.md) |

## How a run works

1. **Connect** with Mobile Wallet Adapter (Phantom, Solflare, Seeker wallet).
2. **Fund** on Pacifica testnet: mint test USDC, deposit, and optionally get test SKR from the in-app faucet.
3. **Bind the agent key** with one wallet signature (below). No more popups after this.
4. **Pick a stake** (min $10) and an optional **SKR shield** (50, 150 or 250 SKR).
5. **Run.** Every 20 s the engine scores the last round and moves your position to your current lane. Tap the crank to change leverage (1x to 20x). Swipe to change lanes.
6. **Run ends** when you hit a candle, cash out, or lose your whole stake. The position is closed with a reduce-only order.
7. **Settle.** If you lost and had a shield, your wallet signs the SKR burn. The Worker scores the run from Pacifica fills, verifies the burn, and applies the shield.
8. **Debrief.** The AI coach explains the run.

## AI (Juggle Coach)

Model: `openai/gpt-4o-mini` via the Orbio gateway, called from the Cloudflare Worker (`POST /chat`). The API key stays a Worker secret and is never shipped in the app.

**1. Automatic post-run debrief** (`debriefRun` in `src/ui/ChatAI.ts`). After every real run the game builds a round-by-round log (`RoundLog` in `TradeEngine`: direction, leverage, SOL move per round). The game grades each round itself (correct call, wrong call, or no position), so the model gets facts, not raw numbers to misread. The model then explains which calls and leverage choices decided the result and gives one concrete tip. Example output from the live endpoint:

> "The best streak of 2 was achieved with correct LONG calls on R1 and R2, but the wrong calls on R3 and R4 led to a negative P&L. For the next run, consider diversifying lane choices and reducing leverage to mitigate risk."

**2. In-run coach chat.** Every question is sent with the live state: SOL price, current lane, open position, P&L, leverage, streak, SKR shield tier and coverage, and the last 5 graded rounds. The system prompt limits it to Juggle, trading and the player's account.

The AI advises; it never places orders. Orders only come from the player's lane.

**Guardrails and evaluation.** Risk rules in the system prompt override any request: no profit promises or price predictions, never push leverage (always say it magnifies losses), testnet only, no real-money advice. `scripts/eval-coach.mjs` runs 9 scenarios (debriefs, chasing losses at 20x, price prediction, prompt injection, real money, off-topic, SKR on a win) 3 times each against the live endpoint: currently **27/27 pass**. Full prompts, responses and checks: [docs/ai-eval.md](docs/ai-eval.md). Design, real in-app debriefs, and the failures that shaped each rule: [docs/AI.md](docs/AI.md).

## SKR shield: rules, custody, failure cases

**Rules** (same numbers in `TradeEngine.skrCoveragePct` and the Worker):

| SKR staked | Share of a losing run covered |
|---|---|
| 50 | 10% |
| 150 | 30% |
| 250 | 50% (max) |

Coverage = min(SKR / 250, 1) × 50%. It only applies to a run that ends at a loss.

**Custody.** SKR never leaves the player's wallet until settlement. There is no escrow and no program holding tokens. On a losing run the player's own wallet signs an SPL Token `Burn` (instruction 8) of the staked amount. Winning or flat runs burn nothing.

**Settlement.** The shield is a scoring rule on the verified leaderboard. It does not refund Pacifica losses. The Worker:
1. Scores the run from the player's real Pacifica fills (`/trades/history`).
2. Fetches the burn with `getTransaction` and checks it succeeded, is an SPL burn of the SKR mint, was signed by this player, and happened inside the run window.
3. Rejects a burn signature already used for another run (unique index on `skr_burn_sig`).
4. Adds `loss × coverage` back to the run's score and stores the burn signature with the run.

**Failure cases**
- Not enough SKR in wallet: the run can't start with that shield.
- Player rejects or the burn fails: no burn, no shield. The results screen says so.
- Burn can't be verified (wrong mint, wrong signer, reused, outside run window): the run is still scored, without shield, and the reason is shown.
- Won run: nothing is burned.

**SKR token.** Testnet uses a devnet mock SKR mint (6 decimals) created by `scripts/create-skr-token.mjs`. Mainnet swaps the mint address in `src/config.ts` and the Worker's `SKR_MINT` for the real SKR mint `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`.

## Trading safety model

- **Testnet only.** Pacifica testnet on Solana devnet, test USDC. No real funds.
- **Delegation.** The app generates an ed25519 agent key on the device and the player authorizes it once with a wallet signature (`bind_agent_wallet`). The key lives only on that device (app storage). Juggle only ever uses it to set leverage and place market orders (`src/pacifica/api.ts`). Note: Pacifica agent keys can sign any account request, including withdrawal requests, so the app treats it like an exchange API key and keeps it on-device. Agent wallets are managed on Pacifica's API key page (app.pacifica.fi/apikey).
- **Order sizing.** Notional = stake × leverage, rounded to the market lot size and never below Pacifica's minimum order size. Leverage is capped at 20x and at the market's own maximum. Market orders use 0.5% max slippage.
- **Loss limit.** The run stops automatically when P&L reaches −stake, and the position is closed.
- **No stray orders.** Orders are only sent while a run is active. One order flow runs at a time (`busy` guard). Closing always uses reduce-only orders. Leaving the run (cash-out, candle hit, stake gone) closes the position before settlement.
- **Visible state.** HUD shows open position, leverage, P&L, round timer and any order error, every frame.
- **Leaderboard anti-farming.** Returns are computed from real fills and normalised as if max leverage were 5x (`MAX_LEVERAGE`), so tiny stakes with huge positions can't top the board.

## Architecture

```
Android (Capacitor WebView)
  src/game/*          Three.js runner, input, Pacifica price feed
  src/trade/          TradeEngine: lane -> position every 20 s
  src/pacifica/*      Pacifica REST client, signing, agent key, deposit
  src/skr.ts          SKR balance, faucet, burn instruction
  src/ui/ChatAI.ts    AI coach + post-run debrief
  src/wallet/*        MWA wallet (device) / dev wallet (desktop testnet)
  android/.../SolanaMwaPlugin.kt   Kotlin Capacitor plugin wrapping MWA clientlib 2.1.1
        |
        v
Cloudflare Worker (leaderboard/)   D1 leaderboard, fill-based scoring,
                                   SKR burn verification, AI proxy
        |
        v
Pacifica testnet API + WS    Solana devnet RPC    Orbio (gpt-4o-mini)
```

## Run locally

```bash
npm install
npm run dev          # desktop uses a local dev wallet (testnet only)
```

Leaderboard Worker:

```bash
cd leaderboard && npm install
printf 'ORBIO_API_KEY=...\nSOLANA_RPC_URL=https://solana-devnet.g.alchemy.com/v2/<key>\n' > .dev.vars
npx wrangler d1 execute juggle-leaderboard --local --file=schema.sql
npx wrangler dev
```

Existing database: apply `leaderboard/migrations/0002_skr_shield.sql`.

## Build the APK

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

Release signing reads `android/keystore.properties` (not committed). Output: `android/app/build/outputs/apk/release/app-release.apk`.

## Environment notes

| Setting | Where | Value |
|---|---|---|
| Pacifica API / WS | `src/config.ts` | `test-api.pacifica.fi`, `test-ws.pacifica.fi` |
| Solana RPC (app) | `src/config.ts` | public devnet |
| `SOLANA_RPC_URL` (Worker) | Worker secret | a keyed devnet RPC (Alchemy). The public devnet RPC blocks Cloudflare Worker IPs, so burn verification needs its own endpoint. |
| SKR mint | `src/config.ts`, `leaderboard/wrangler.toml` | devnet mock |
| Leaderboard URL | `src/config.ts` | deployed Worker |
| `ORBIO_API_KEY` | Worker secret / `leaderboard/.dev.vars` | not committed |

The devnet SKR mint authority is in `src/config.ts` on purpose so the in-app faucet works without a backend. It controls a worthless devnet mock only.

## License

MIT
