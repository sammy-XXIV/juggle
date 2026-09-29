import bs58 from "bs58";

/** Signs raw bytes with an ed25519 key: the player's wallet or the local agent key. */
export type Signer = (message: Uint8Array) => Promise<Uint8Array>;

export interface SignedHeader {
  signature: string;
  timestamp: number;
  expiry_window: number;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Pacifica's canonical message: header + `data`, keys sorted at every level, compact JSON. */
export function buildMessage(
  type: string,
  data: Record<string, unknown>,
  timestamp: number,
  expiryWindow: number,
): string {
  return JSON.stringify(sortKeys({ timestamp, expiry_window: expiryWindow, type, data }));
}

export async function signOperation(
  type: string,
  data: Record<string, unknown>,
  signer: Signer,
  expiryWindow = 5_000,
): Promise<SignedHeader> {
  const timestamp = Date.now();
  const message = buildMessage(type, data, timestamp, expiryWindow);
  const signature = await signer(new TextEncoder().encode(message));
  return { signature: bs58.encode(signature), timestamp, expiry_window: expiryWindow };
}
