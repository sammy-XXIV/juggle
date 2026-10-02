// One-time: gives the devnet SKR mint a name, symbol and logo (Metaplex Token Metadata), so wallets
// show "SKR" instead of "Unknown". Run: node scripts/add-skr-metadata.mjs
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import fs from "fs";

const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const MINT = new PublicKey("3zcV6Y9yxbYMgbyc2GSnfaFkMSx8tKX7pjvBfTf2w7qr");
const NAME = "SKR (Juggle devnet)";
const SYMBOL = "SKR";
const URI = "https://juggle.samsonsamuel531.workers.dev/skr-devnet.json";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const authority = Keypair.fromSecretKey(bs58.decode(JSON.parse(fs.readFileSync("scripts/.skr-keypairs.json", "utf8")).mintAuthoritySecret));
const [metadata] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), MINT.toBuffer()], METADATA_PROGRAM);

if (await connection.getAccountInfo(metadata)) {
  console.log("Metadata already exists:", metadata.toBase58());
  process.exit(0);
}

// Borsh: CreateMetadataAccountV3 (discriminator 33) { DataV2, is_mutable, collection_details: None }
const str = (s) => { const b = Buffer.from(s, "utf8"); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };
const data = Buffer.concat([
  Buffer.from([33]),
  str(NAME), str(SYMBOL), str(URI),
  Buffer.from([0, 0]), // seller_fee_basis_points u16
  Buffer.from([0]), // creators: None
  Buffer.from([0]), // collection: None
  Buffer.from([0]), // uses: None
  Buffer.from([1]), // is_mutable
  Buffer.from([0]), // collection_details: None
]);

const ix = new TransactionInstruction({
  programId: METADATA_PROGRAM,
  data,
  keys: [
    { pubkey: metadata, isSigner: false, isWritable: true },
    { pubkey: MINT, isSigner: false, isWritable: false },
    { pubkey: authority.publicKey, isSigner: true, isWritable: false }, // mint authority
    { pubkey: authority.publicKey, isSigner: true, isWritable: true }, // payer
    { pubkey: authority.publicKey, isSigner: true, isWritable: false }, // update authority
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
});

const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [authority]);
console.log("metadata:", metadata.toBase58());
console.log("tx:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
