export interface PricePoint {
  time: number;
  price: number;
}

export interface PriceFeed {
  start(onTick: (point: PricePoint) => void): void;
  stop(): void;
}

interface PacificaPrice {
  symbol: string;
  mark: string;
  timestamp: number;
}

const HEARTBEAT_MS = 30_000; // server drops idle sockets after 60s
const MAX_RECONNECT_MS = 15_000;

/** Live mark price for one market from Pacifica's websocket `prices` stream. */
export class PacificaPriceFeed implements PriceFeed {
  private ws: WebSocket | null = null;
  private heartbeat: number | undefined;
  private reconnectTimer: number | undefined;
  private reconnectDelay = 1_000;
  private stopped = false;
  private onTick: (point: PricePoint) => void = () => {};
  private readonly url: string;
  private readonly symbol: string;

  constructor(url: string, symbol: string) {
    this.url = url;
    this.symbol = symbol;
  }

  start(onTick: (point: PricePoint) => void): void {
    this.onTick = onTick;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.clearInterval(this.heartbeat);
    window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1_000;
      ws.send(JSON.stringify({ method: "subscribe", params: { source: "prices" } }));
      this.heartbeat = window.setInterval(
        () => ws.send(JSON.stringify({ method: "ping" })),
        HEARTBEAT_MS,
      );
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string);
      if (msg.channel !== "prices") return;
      const entry = (msg.data as PacificaPrice[]).find((p) => p.symbol === this.symbol);
      if (entry) this.onTick({ time: entry.timestamp, price: Number(entry.mark) });
    };

    ws.onclose = () => {
      window.clearInterval(this.heartbeat);
      if (this.stopped) return;
      this.reconnectTimer = window.setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS);
    };
  }
}
