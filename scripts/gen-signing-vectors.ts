// Prints serialized legacy transactions the app really signs; pasted into SigningGuardTest.kt as fixtures.
// Run: npx vite-node scripts/gen-signing-vectors.ts
import { Keypair, Transaction } from "@solana/web3.js";
import { depositInstruction, mintTestUsdcInstruction } from "../src/pacifica/funding";
import { burnSkrInstruction } from "../src/skr";
const wallet = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
const blockhash = "11111111111111111111111111111111";
const ser = (...ix: any[]) => { const t = new Transaction().add(...ix); t.feePayer = wallet; t.recentBlockhash = blockhash; return t.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"); };
console.log(JSON.stringify({ wallet: wallet.toBase58(), burn150: ser(burnSkrInstruction(wallet, 150)), burn251: ser(burnSkrInstruction(wallet, 251)), deposit: ser(depositInstruction(wallet, 100)), mint: ser(mintTestUsdcInstruction(wallet, 1000)) }));
