# Juggle

Surf the market. Dodge the red.

## The Problem

Perp trading is brutal for new users. Interfaces are dense, leverage is opaque, and the feedback loop between a bad decision and a liquidation is slow and confusing. Most people blow their first account before they understand what happened.

At the same time, mobile crypto apps are either read-only dashboards or wallet UIs — nothing that actually teaches you to trade by doing it.

## Why Juggle

Juggle turns a real Pacifica perp session into a 3D runner. Your lane is your position — LONG on the right, SHORT on the left, FLAT in the middle. Red candlestick obstacles punish the wrong call. Coins reward the right one. Every 20 seconds your lane fires a live order on-chain. Hit a candle and your position closes immediately — run over, P&L locked. You feel leverage, you feel a bad close, you learn market direction — all through muscle memory instead of a tutorial.

The AI coach responds to your actual P&L and position in real time, not generic advice. SKR shields let you trade with a safety net while you're learning.

Same real infrastructure, same real risk — just a feedback loop fast enough to learn from.

3D mobile runner where your lane is a real Pacifica perp position. Go LONG, SHORT, or FLAT — every 20 seconds your lane fires a live order. Hit a candle and your position closes — run over. Cash out early to lock P&L.

Built for the [Clock In — Solana Mobile Hackathon](https://solanamobile.radiant.nexus).

## Stack

- **Three.js** — 3D runner renderer
- **Capacitor** — Android APK wrapper
- **Solana Mobile MWA** — wallet signing without popups
- **Pacifica perps** — real testnet orders (Solana devnet)
- **Cloudflare Workers + D1** — leaderboard backend
- **Orbio / GPT-4o-mini** — in-game AI coach

## Run locally

```bash
npm install
npm run dev
```

Leaderboard Worker (separate):

```bash
cd leaderboard && npm install && npx wrangler dev
```

## Build APK

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

Signed APK at `android/app/build/outputs/apk/release/app-release.apk`.

## License

MIT
