import { Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PacificaClient, PacificaError, type AccountInfo, type AgentKey } from "./api";
import { depositInstruction, mintTestUsdcInstruction, usdcTokenAccount } from "./funding";
import { connection, type Wallet } from "../wallet/wallet";
import { PACIFICA_API_URL } from "../config";
import { burnSkrInstruction, getSkrBalance, mintTestSkr } from "../skr";

export const pacifica = new PacificaClient(PACIFICA_API_URL);

export const MIN_DEPOSIT_USDC = 10;
export const TEST_MINT_USDC = 1_000;

/** A player's Pacifica account: their wallet plus the on-device agent key that trades for it. */
export class TradingAccount {
  readonly wallet: Wallet;
  readonly agent: AgentKey;
  private readonly agentStorageKey: string;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
    this.agentStorageKey = `juggle.agent.v1.${wallet.publicKey.toBase58()}`;
    const saved = localStorage.getItem(this.agentStorageKey);
    const keypair = saved ? Keypair.fromSecretKey(bs58.decode(saved)) : Keypair.generate();
    if (!saved) localStorage.setItem(this.agentStorageKey, bs58.encode(keypair.secretKey));
    this.agent = {
      publicKey: keypair.publicKey.toBase58(),
      sign: async (message) => nacl.sign.detached(message, keypair.secretKey),
    };
  }

  get address(): string {
    return this.wallet.publicKey.toBase58();
  }

  /** Null until the player's first deposit creates the Pacifica account. */
  async info(): Promise<AccountInfo | null> {
    try {
      return await pacifica.accountInfo(this.address);
    } catch (e) {
      if (e instanceof PacificaError && /not found/i.test(e.message)) return null;
      throw e;
    }
  }

  async walletSol(): Promise<number> {
    return (await connection.getBalance(this.wallet.publicKey)) / LAMPORTS_PER_SOL;
  }

  async walletUsdc(): Promise<number> {
    try {
      const balance = await connection.getTokenAccountBalance(usdcTokenAccount(this.wallet.publicKey));
      return balance.value.uiAmount ?? 0;
    } catch {
      return 0; // token account not created yet
    }
  }

  mintTestUsdc(amount = TEST_MINT_USDC): Promise<string> {
    return this.wallet.sendTransaction(
      new Transaction().add(mintTestUsdcInstruction(this.wallet.publicKey, amount)),
    );
  }

  deposit(amount: number): Promise<string> {
    return this.wallet.sendTransaction(
      new Transaction().add(depositInstruction(this.wallet.publicKey, amount)),
    );
  }

  walletSkr(): Promise<number> {
    return getSkrBalance(this.wallet.publicKey);
  }

  mintTestSkr(amount = 1000): Promise<string> {
    return mintTestSkr(this.wallet.publicKey, amount);
  }

  burnSkr(amount: number): Promise<string> {
    return this.wallet.sendTransaction(
      new Transaction().add(burnSkrInstruction(this.wallet.publicKey, amount)),
    );
  }

  isAgentBound(): boolean {
    return localStorage.getItem(`${this.agentStorageKey}.bound`) === "1";
  }

  /** One wallet signature so the agent key can place orders without further popups. */
  async bindAgent(): Promise<void> {
    await pacifica.bindAgent(this.address, this.agent.publicKey, (m) => this.wallet.signMessage(m));
    localStorage.setItem(`${this.agentStorageKey}.bound`, "1");
  }
}
