import { signOperation, type Signer } from "./signing";

export type Side = "bid" | "ask";

export interface AgentKey {
  publicKey: string;
  sign: Signer;
}

export interface AccountInfo {
  balance: string;
  account_equity: string;
  available_to_spend: string;
  positions_count: number;
}

export interface Position {
  symbol: string;
  side: Side;
  amount: string;
  entry_price: string;
}

export interface TradeFill {
  symbol: string;
  side: "open_long" | "open_short" | "close_long" | "close_short";
  amount: string;
  price: string;
  fee: string;
  pnl: string;
  created_at: number;
  cause: string;
}

export interface MarketSpec {
  symbol: string;
  lot_size: string;
  min_order_size: string;
  max_leverage: number;
}

export class PacificaError extends Error {}

export class PacificaClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.success === false) {
      throw new PacificaError(body?.error ?? `Pacifica ${path} failed (${res.status})`);
    }
    return body.data as T;
  }

  private get<T>(path: string, params: Record<string, string | number>): Promise<T> {
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<T>(`${path}?${query}`);
  }

  private async signedPost<T>(
    path: string,
    type: string,
    account: string,
    data: Record<string, unknown>,
    signer: Signer,
    agentWallet: string | null,
  ): Promise<T> {
    const header = await signOperation(type, data, signer);
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, agent_wallet: agentWallet, ...header, ...data }),
    });
  }

  markets(): Promise<MarketSpec[]> {
    return this.request<MarketSpec[]>("/info");
  }

  accountInfo(account: string): Promise<AccountInfo> {
    return this.get("/account", { account });
  }

  positions(account: string): Promise<Position[]> {
    return this.get("/positions", { account });
  }

  tradeHistory(account: string, startTime: number, endTime: number): Promise<TradeFill[]> {
    return this.get("/trades/history", { account, start_time: startTime, end_time: endTime });
  }

  /** Signed by the player's own wallet: authorizes the agent key to trade for this account. */
  bindAgent(account: string, agentPublicKey: string, walletSigner: Signer): Promise<unknown> {
    return this.signedPost(
      "/agent/bind",
      "bind_agent_wallet",
      account,
      { agent_wallet: agentPublicKey },
      walletSigner,
      null,
    );
  }

  updateLeverage(account: string, symbol: string, leverage: number, agent: AgentKey): Promise<unknown> {
    return this.signedPost(
      "/account/leverage",
      "update_leverage",
      account,
      { symbol, leverage },
      agent.sign,
      agent.publicKey,
    );
  }

  marketOrder(
    account: string,
    order: { symbol: string; side: Side; amount: string; reduceOnly: boolean },
    agent: AgentKey,
  ): Promise<{ order_id: number }> {
    return this.signedPost(
      "/orders/create_market",
      "create_market_order",
      account,
      {
        symbol: order.symbol,
        side: order.side,
        amount: order.amount,
        reduce_only: order.reduceOnly,
        slippage_percent: "0.5",
        client_order_id: crypto.randomUUID(),
      },
      agent.sign,
      agent.publicKey,
    );
  }
}
