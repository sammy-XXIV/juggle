import { PublicKey, Transaction } from "@solana/web3.js";
import { PACIFICA_PROGRAM_ID, SKR_DECIMALS, SKR_MINT } from "../config";
import { DEPOSIT, MINT_TEST_USDC } from "../pacifica/funding";

// What Juggle ever asks a wallet to sign. Anything else is refused before it reaches the wallet, and the same
// allowlist is enforced again in the Kotlin bridge (SigningGuard.kt), so a compromised web layer can't skip it.
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_BURN = 8;
const MAX_SKR_BURN = 250 * 10 ** SKR_DECIMALS; // largest shield tier
const MAX_USDC = 10_000 * 1_000_000; // mint/deposit cap on testnet funds
const MAX_INSTRUCTIONS = 3;

const skrAccountOf = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), new PublicKey(SKR_MINT).toBuffer()], ATA_PROGRAM)[0];

const refuse = (why: string): never => {
  throw new Error(`Refusing to sign: ${why}`);
};

const startsWith = (data: Uint8Array, prefix: number[]) => prefix.every((b, i) => data[i] === b);
const u64 = (data: Uint8Array, offset: number) => Number(new DataView(data.buffer, data.byteOffset).getBigUint64(offset, true));

export function assertSafeTransaction(tx: Transaction, wallet: PublicKey): void {
  if (!tx.feePayer?.equals(wallet)) refuse("fee payer is not the connected wallet");
  if (tx.instructions.length === 0 || tx.instructions.length > MAX_INSTRUCTIONS) refuse("unexpected number of instructions");

  for (const ix of tx.instructions) {
    for (const key of ix.keys) {
      if (key.isSigner && !key.pubkey.equals(wallet)) refuse("an instruction needs a signer other than the wallet");
    }
    const program = ix.programId.toBase58();
    const data = new Uint8Array(ix.data);

    if (program === PACIFICA_PROGRAM_ID) {
      const mint = startsWith(data, MINT_TEST_USDC);
      const deposit = startsWith(data, DEPOSIT);
      if ((!mint && !deposit) || data.length !== 16) refuse("unknown Pacifica instruction");
      if (u64(data, 8) > MAX_USDC) refuse("amount above the testnet cap");
      if (!ix.keys[0]?.pubkey.equals(wallet) || !ix.keys[0].isSigner) refuse("Pacifica instruction is not owned by the wallet");
    } else if (program === TOKEN_PROGRAM) {
      if (data[0] !== TOKEN_BURN || data.length !== 9) refuse("only SKR burns are allowed on the token program");
      if (u64(data, 1) > MAX_SKR_BURN) refuse("burn above the largest shield tier");
      const [account, mint, authority] = ix.keys;
      if (!mint?.pubkey.equals(new PublicKey(SKR_MINT))) refuse("burn is not of the SKR mint");
      if (!authority?.pubkey.equals(wallet) || !authority.isSigner) refuse("burn authority is not the wallet");
      if (!account?.pubkey.equals(skrAccountOf(wallet))) refuse("burn is not from the wallet's own SKR account");
    } else {
      refuse(`program ${program.slice(0, 8)}… is not allowed`);
    }
  }
}

const NAME_MESSAGE = /^Juggle leaderboard name\nname: [A-Za-z0-9_]{3,16}\naccount: ([1-9A-HJ-NP-Za-km-z]{32,44})\ntimestamp: \d{10,16}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BIND_EXPIRY_MAX = 120_000;
const CLOCK_SKEW = 5 * 60_000;

export function assertSafeMessage(message: Uint8Array, wallet: PublicKey, now = Date.now()): void {
  const text = new TextDecoder().decode(message);
  if (message.length > 400) refuse("message is too long");

  const name = NAME_MESSAGE.exec(text);
  if (name) {
    if (name[1] !== wallet.toBase58()) refuse("message names a different account");
    return;
  }

  let parsed: { data?: { agent_wallet?: unknown }; expiry_window?: unknown; timestamp?: unknown; type?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse("unrecognised message");
  }
  const keys = Object.keys(parsed).sort().join();
  const agent = parsed.data?.agent_wallet;
  const fresh = typeof parsed.timestamp === "number" && Math.abs(now - parsed.timestamp) < CLOCK_SKEW;
  if (
    parsed.type !== "bind_agent_wallet" ||
    keys !== "data,expiry_window,timestamp,type" ||
    Object.keys(parsed.data ?? {}).join() !== "agent_wallet" ||
    typeof agent !== "string" || !BASE58.test(agent) ||
    typeof parsed.expiry_window !== "number" || parsed.expiry_window > BIND_EXPIRY_MAX ||
    !fresh
  ) {
    refuse("unrecognised message");
  }
}
