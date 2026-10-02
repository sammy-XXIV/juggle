import { Capacitor, registerPlugin } from "@capacitor/core";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { APP_IDENTITY_URI, APP_NAME, SOLANA_RPC_URL } from "../config";

export interface Wallet {
  readonly publicKey: PublicKey;
  readonly label: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Fills in fee payer + blockhash, gets it signed, sends it, and waits for confirmation. */
  sendTransaction(tx: Transaction): Promise<string>;
  disconnect(): Promise<void>;
}

export const connection = new Connection(SOLANA_RPC_URL, "confirmed");

interface SolanaMwaPlugin {
  authorize(options: {
    identityUri: string;
    identityName: string;
    iconPath: string;
    cluster: "devnet" | "mainnet";
  }): Promise<{ publicKey: string; label: string | null }>;
  signMessage(options: { message: string }): Promise<{ signature: string }>;
  signTransaction(options: { transaction: string }): Promise<{ transaction: string }>;
  deauthorize(): Promise<void>;
}

const SolanaMwa = registerPlugin<SolanaMwaPlugin>("SolanaMwa");

async function prepare(tx: Transaction, payer: PublicKey): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const latest = await connection.getLatestBlockhash();
  tx.feePayer = payer;
  tx.recentBlockhash = latest.blockhash;
  return latest;
}

async function confirm(signature: string, latest: { blockhash: string; lastValidBlockHeight: number }): Promise<string> {
  const result = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  if (result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
  return signature;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Right after the wallet app hands control back, the WebView's first requests can drop and its WebSocket may be
 * dead. Re-sending the same signed bytes is safe (same signature), so: resend until seen, confirm by polling.
 */
export async function sendSignedWithRetry(raw: Uint8Array): Promise<string> {
  const signature = bs58.encode(Transaction.from(raw).signature!);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      if (attempt % 3 === 0) await connection.sendRawTransaction(raw, { skipPreflight: attempt > 0, maxRetries: 0 });
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      // A real on-chain rejection (not a network blip) won't fix itself.
      if (/simulation failed|custom program error|insufficient/i.test(msg) && attempt === 0) throw e;
    }
    try {
      const { value } = await connection.getSignatureStatuses([signature]);
      const status = value[0];
      if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return signature;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Transaction failed")) throw e;
      lastError = e;
    }
    await sleep(attempt < 3 ? 600 : 1500);
  }
  throw new Error(`Not confirmed: ${lastError instanceof Error ? lastError.message : "timed out"}`);
}

/** Real wallet on the phone via Solana Mobile Wallet Adapter (Seed Vault, Phantom, Solflare...). */
class MobileWallet implements Wallet {
  readonly publicKey: PublicKey;
  readonly label: string;

  constructor(publicKey: PublicKey, label: string) {
    this.publicKey = publicKey;
    this.label = label;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const { signature } = await SolanaMwa.signMessage({ message: Buffer.from(message).toString("base64") });
    return Uint8Array.from(Buffer.from(signature, "base64"));
  }

  // The wallet only signs; Juggle submits to devnet itself. Phantom hangs on sign-and-send for devnet over MWA.
  async sendTransaction(tx: Transaction): Promise<string> {
    await prepare(tx, this.publicKey);
    const unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const { transaction } = await SolanaMwa.signTransaction({ transaction: unsigned.toString("base64") });
    return sendSignedWithRetry(Buffer.from(transaction, "base64"));
  }

  disconnect(): Promise<void> {
    return SolanaMwa.deauthorize();
  }
}

const DEV_WALLET_KEY = "juggle.devWallet.v1";

/** Desktop-only testnet stand-in: a local keypair kept in this browser. Never used on the phone. */
class DevWallet implements Wallet {
  readonly publicKey: PublicKey;
  readonly label = "Dev wallet (testnet)";
  private readonly keypair: Keypair;

  constructor(keypair: Keypair) {
    this.keypair = keypair;
    this.publicKey = keypair.publicKey;
  }

  static load(): DevWallet {
    const saved = localStorage.getItem(DEV_WALLET_KEY);
    const keypair = saved ? Keypair.fromSecretKey(bs58.decode(saved)) : Keypair.generate();
    if (!saved) localStorage.setItem(DEV_WALLET_KEY, bs58.encode(keypair.secretKey));
    return new DevWallet(keypair);
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return nacl.sign.detached(message, this.keypair.secretKey);
  }

  async sendTransaction(tx: Transaction): Promise<string> {
    const latest = await prepare(tx, this.publicKey);
    tx.sign(this.keypair);
    const signature = await connection.sendRawTransaction(tx.serialize());
    return confirm(signature, latest);
  }

  async disconnect(): Promise<void> {}
}

export async function connectWallet(): Promise<Wallet> {
  if (!Capacitor.isNativePlatform()) return DevWallet.load();
  const { publicKey, label } = await SolanaMwa.authorize({
    identityUri: APP_IDENTITY_URI,
    identityName: APP_NAME,
    iconPath: "favicon.svg",
    cluster: "devnet",
  });
  const key = new PublicKey(Buffer.from(publicKey, "base64"));
  return new MobileWallet(key, label ?? `${key.toBase58().slice(0, 4)}…${key.toBase58().slice(-4)}`);
}
