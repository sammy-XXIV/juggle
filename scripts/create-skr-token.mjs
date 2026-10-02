// One-time script: creates a mock SKR SPL token on Solana devnet.
// Run: node scripts/create-skr-token.mjs
// If airdrop fails, fund the printed address at https://faucet.solana.com then re-run.
import { Connection, Keypair, SystemProgram, Transaction, TransactionInstruction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import fs from "fs";

const KEYPAIRS_FILE = "scripts/.skr-keypairs.json";
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MINT_SIZE = 82;
const DECIMALS = 6;

const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Load or generate keypairs (stable across re-runs)
let mintAuthority, mint;
if (fs.existsSync(KEYPAIRS_FILE)) {
  const saved = JSON.parse(fs.readFileSync(KEYPAIRS_FILE, "utf8"));
  mintAuthority = Keypair.fromSecretKey(bs58.decode(saved.mintAuthoritySecret));
  mint = Keypair.fromSecretKey(bs58.decode(saved.mintSecret));
  console.log("Loaded existing keypairs.");
} else {
  mintAuthority = Keypair.generate();
  mint = Keypair.generate();
  fs.writeFileSync(KEYPAIRS_FILE, JSON.stringify({
    mintAuthoritySecret: bs58.encode(mintAuthority.secretKey),
    mintSecret: bs58.encode(mint.secretKey),
  }));
  console.log("Generated new keypairs.");
}

console.log("Mint authority:", mintAuthority.publicKey.toBase58());
console.log("Mint address:", mint.publicKey.toBase58());

// Check if already funded
const balance = await connection.getBalance(mintAuthority.publicKey);
if (balance < 1_000_000_000) {
  console.log(`\nMint authority balance: ${balance / 1e9} SOL — needs at least 1 SOL.`);
  console.log("Requesting airdrop…");
  try {
    const drop = await connection.requestAirdrop(mintAuthority.publicKey, 2_000_000_000);
    await connection.confirmTransaction(drop, "confirmed");
    console.log("Airdrop confirmed.");
  } catch (e) {
    console.error("Airdrop failed:", e.message);
    console.log(`\nManually fund this address with devnet SOL, then re-run:`);
    console.log(`  ${mintAuthority.publicKey.toBase58()}`);
    console.log(`  https://faucet.solana.com`);
    process.exit(1);
  }
}

// Check if mint already created
const mintInfo = await connection.getAccountInfo(mint.publicKey);
if (mintInfo) {
  console.log("Mint already exists — skipping creation.");
} else {
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: mintAuthority.publicKey,
    newAccountPubkey: mint.publicKey,
    space: MINT_SIZE,
    lamports,
    programId: TOKEN_PROGRAM,
  });

  // InitializeMint2 (index 20): no rent sysvar needed
  const initData = Buffer.alloc(35);
  initData.writeUInt8(20, 0);
  initData.writeUInt8(DECIMALS, 1);
  Buffer.from(mintAuthority.publicKey.toBytes()).copy(initData, 2);
  initData.writeUInt8(0, 34); // no freeze authority

  const initMintIx = new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    data: initData,
    keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }],
  });

  const tx = new Transaction().add(createAccountIx, initMintIx);
  const latest = await connection.getLatestBlockhash();
  tx.feePayer = mintAuthority.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(mintAuthority, mint);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  console.log("Mint created. Tx:", sig);
}

console.log("\n=== Add to src/config.ts ===");
console.log(`export const SKR_MINT = "${mint.publicKey.toBase58()}";`);
console.log(`export const SKR_MINT_AUTHORITY = <mintAuthoritySecret from ${KEYPAIRS_FILE}>;`);
console.log(`export const SKR_DECIMALS = ${DECIMALS};`);
