# Verification trace: one run, from fills to leaderboard score

Everything below uses public data. Reproduce it yourself, no Juggle server needed:

```bash
node scripts/verify-run.mjs 6CXVe2yWcC8pKide5JnpCjaVEbc56hBecdXKUoVZz9dq 1790946174776 1790946198899 \
  5GWyZS4YpugVBmbgPxLxAyP2QNywe8hxMnvVhVVSLyS7bjEvMW6F1U1qZkWGLBGW7edNWnYmHzraTG8Qp1HL3PXW
```

The script mirrors `leaderboard/src/index.ts` (`fetchFills`, `verifySkrBurn`, `submitRun`) and prints each step. Set `SOLANA_RPC_URL` to a keyed devnet RPC if the public one rate-limits you.

## The run

| | |
|---|---|
| Player | "Him", `6CXVe2yWcC8pKide5JnpCjaVEbc56hBecdXKUoVZz9dq` (a real Android phone, Phantom via Mobile Wallet Adapter) |
| Run window | `1790946174776` to `1790946198899` ms (2 Oct 2026, 13:02:54 to 13:03:18 UTC) |
| Claimed stake | $10 with a 150 SKR shield |
| Recorded on the phone | the live run, burn confirmation and Explorer page appear in the [demo video](https://youtu.be/gM674HMx4HQ) |

## 1. Pacifica fills (what the Worker reads, not what the app reports)

`GET https://test-api.pacifica.fi/api/v1/trades/history?account=…&start_time=1790946174776&end_time=1790946228899`
(run window plus 30 s for the closing fill), filtered to the SOL market:

| history_id | side | amount | price | fee | pnl |
|---|---|---|---|---|---|
| 80897356 | `open_short` | 1.64 SOL | 122.22 | 0.080176 | -0.080176 |
| 80897358 | `close_short` | 1.64 SOL | 122.27 | 0.080209 | -0.162209 |

Both are `fulfill_taker`. The opening order was `reduce_only: false`, and the close came from the end-of-run close (`TradeEngine.end`, a reduce-only order).

## 2. Scoring arithmetic

The Worker sums `pnl - fee` over the fills (`submitRun`):

```
P&L              = (-0.080176 - 0.080176) + (-0.162209 - 0.080209) = -0.402770
largest open     = 1.64 x 122.22                                   = 200.4408
effective stake  = max(claimed 10, 200.4408 / MAX_LEVERAGE 5, 10)  = 40.08816
```

The stake is floored at position size / 5 so a tiny claimed stake can't inflate the return on a large position.

## 3. SKR burn verification

`getTransaction("5GWyZS4Y…PXW", jsonParsed)` on devnet returns one `spl-token` `burn` instruction:

| Check (`verifySkrBurn`) | Value | Result |
|---|---|---|
| Transaction succeeded (`meta.err`) | `null` | PASS |
| Mint | `3zcV6Y9y…w7qr` (the devnet SKR mint, `3zcV6Y9yxbYMgbyc2GSnfaFkMSx8tKX7pjvBfTf2w7qr`) | PASS |
| Authority (signer) | `6CXVe2yW…z9dq` (the player) | PASS |
| Block time inside window (`start - 60 s` to `end + 10 min`) | `1790946216000` (18 s after the run ended) | PASS |
| Amount actually burned | `150000000` raw, 6 decimals = **150 SKR** | used for coverage |
| Burn signature not used by another run | unique index `runs_by_burn` | PASS |

Coverage comes from the burned amount, never a claimed one:

```
shield = loss x min(burned / 250, 1) x 0.5 = 0.402770 x 0.6 x 0.5 = 0.120831
```

Transaction: [`5GWyZS4Y…PXW` on Solana Explorer](https://explorer.solana.com/tx/5GWyZS4YpugVBmbgPxLxAyP2QNywe8hxMnvVhVVSLyS7bjEvMW6F1U1qZkWGLBGW7edNWnYmHzraTG8Qp1HL3PXW?cluster=devnet).

## 4. Score

```
return_pct = (pnl + shield) / stake x 100 = (-0.402770 + 0.120831) / 40.08816 x 100 = -0.703297 %
```

Stored on the leaderboard (`runs` table): `pnl -0.40277`, `shield 0.120831`, `skr_burned 150`, `return_pct -0.7032974324588606`, `fills 2`. The script and the database agree to the last digit.

## 5. Rejected shield attempts (live endpoint)

Each was sent to `POST https://juggle-leaderboard.samsonsamuel531.workers.dev/runs` for the same player. In every case the run is still scored from fills, with no shield:

| Attempt | Response |
|---|---|
| Replay the same burn under a different run window | `shield: 0`, `shieldError: "This SKR burn was already used for another run"` |
| A signature that is not a transaction | `shield: 0`, `shieldError: "SKR burn lookup failed (Invalid param: WrongSize)"` |
| Re-submit the genuine run | `shield: 0.120831`, `skrBurned: 150`, same score (idempotent: the key is account + start time) |

The other rejection paths (wrong mint, wrong signer, outside the run window, failed transaction, missing transaction, RPC errors) are covered by `leaderboard/test/worker.test.ts`, which decodes real-shaped `getTransaction` responses for each case.

Because the leaderboard ranks each player's **best** run (`MAX(return_pct)`), submitting extra variants of a run can't raise a rank.

## 6. Reduce-only closes and the loss stop

Closing orders are sent with `reduce_only: true` (`TradeEngine.moveTo`, `TradeEngine.end`) and the run auto-stops at `P&L <= -stake` (`TradeEngine.tick`). Both are asserted in `src/trade/TradeEngine.test.ts`.
