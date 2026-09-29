# Juggle

Surf the market. Dodge the red.

3D mobile runner where your lane is a real Pacifica perp position. Go LONG, SHORT, or FLAT — every 20 seconds your lane fires a live order. Hit a candle and you're liquidated. Cash out early to lock P&L.

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
