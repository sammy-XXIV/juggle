// Devnet proof of the SKR shield path: a fresh player gets test SKR, then burns it with the same
// SPL burn instruction the game sends through Mobile Wallet Adapter (src/skr.ts burnSkrInstruction).
// Run: node scripts/prove-skr-burn.mjs [burnAmount]
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import fs from "fs";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MINT = new PublicKey("3zcV6Y9yxbYMgbyc2GSnfaFkMSx8tKX7pjvBfTf2w7qr");
const SCALE = 1_000_000;
const burnAmount = Number(process.argv[2] ?? 150);

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const saved = JSON.parse(fs.readFileSync("scripts/.skr-keypairs.json", "utf8"));
const authority = Keypair.fromSecretKey(bs58.decode(saved.mintAuthoritySecret));
const player = Keypair.generate();
const ata = PublicKey.findProgramAddressSync([player.publicKey.toBuffer(), TOKEN_PROGRAM.toBuffer(), MINT.toBuffer()], ATA_PROGRAM)[0];

const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(Math.round(n * SCALE)));
  return b;
};

async function send(tx, signers) {
  const latest = await connection.getLatestBlockhash();
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  return sig;
}

const mintSig = await send(new Transaction().add(
  new TransactionInstruction({
    programId: ATA_PROGRAM,
    data: Buffer.from([1]),
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: player.publicKey, isSigner: false, isWritable: false },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
  }),
  new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    data: Buffer.concat([Buffer.from([7]), u64(burnAmount)]),
    keys: [
      { pubkey: MINT, isSigner: false, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
  }),
), [authority]);

const supplyBefore = (await connection.getTokenSupply(MINT)).value.uiAmount;

const burnSig = await send(new Transaction().add(new TransactionInstruction({
  programId: TOKEN_PROGRAM,
  data: Buffer.concat([Buffer.from([8]), u64(burnAmount)]),
  keys: [
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: MINT, isSigner: false, isWritable: true },
    { pubkey: player.publicKey, isSigner: true, isWritable: false },
  ],
})), [authority, player]);

const supplyAfter = (await connection.getTokenSupply(MINT)).value.uiAmount;
const url = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
console.log(`player:        ${player.publicKey.toBase58()}`);
console.log(`mint tx:       ${url(mintSig)}`);
console.log(`burn tx:       ${url(burnSig)}`);
console.log(`burn sig:      ${burnSig}`);
console.log(`SKR supply:    ${supplyBefore} -> ${supplyAfter}`);
