import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { SKR_DECIMALS, SKR_MINT, SKR_MINT_AUTHORITY } from "./config";
import { connection } from "./wallet/wallet";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MINT = new PublicKey(SKR_MINT);
const SCALE = 10 ** SKR_DECIMALS;

export function skrAta(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), MINT.toBuffer()],
    ATA_PROGRAM,
  )[0];
}

export async function getSkrBalance(owner: PublicKey): Promise<number> {
  try {
    const info = await connection.getTokenAccountBalance(skrAta(owner));
    return Number(info.value.amount) / SCALE;
  } catch {
    return 0;
  }
}

function u64LE(n: number): Buffer {
  const b = Buffer.alloc(8);
  const scaled = Math.round(n * SCALE);
  b.writeUInt32LE(scaled >>> 0, 0);
  b.writeUInt32LE(Math.floor(scaled / 0x100000000) >>> 0, 4);
  return b;
}

export function burnSkrInstruction(owner: PublicKey, amount: number): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    data: Buffer.concat([Buffer.from([8]), u64LE(amount)]),
    keys: [
      { pubkey: skrAta(owner), isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
  });
}

/** Devnet only: mints test SKR to recipient. Signed by embedded mint authority — no MWA popup. */
export async function mintTestSkr(recipient: PublicKey, amount = 1000): Promise<string> {
  const authority = Keypair.fromSecretKey(bs58.decode(SKR_MINT_AUTHORITY));

  // CreateATA idempotent (index 1) — authority pays, no user signature needed
  const createAtaIx = new TransactionInstruction({
    programId: ATA_PROGRAM,
    data: Buffer.from([1]),
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: skrAta(recipient), isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: false },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
  });

  // MintTo (index 7)
  const mintToIx = new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    data: Buffer.concat([Buffer.from([7]), u64LE(amount)]),
    keys: [
      { pubkey: MINT, isSigner: false, isWritable: true },
      { pubkey: skrAta(recipient), isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
  });

  const tx = new Transaction().add(createAtaIx, mintToIx);
  const latest = await connection.getLatestBlockhash();
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(authority);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  return sig;
}
