import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.radiants.juggle',
  appName: 'Juggle',
  webDir: 'dist',
  // The public Solana devnet RPC (HTTP and WebSocket) returns 403 for the default https://localhost origin.
  server: { androidScheme: 'https', hostname: 'juggle.samsonsamuel531.workers.dev' },
};

export default config;
