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
  signAndSendTransaction(options: { transaction: string }): Promise<{ signature: string }>;
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

  async sendTransaction(tx: Transaction): Promise<string> {
    const latest = await prepare(tx, this.publicKey);
    const unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const { signature } = await SolanaMwa.signAndSendTransaction({ transaction: unsigned.toString("base64") });
    return confirm(bs58.encode(Buffer.from(signature, "base64")), latest);
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
