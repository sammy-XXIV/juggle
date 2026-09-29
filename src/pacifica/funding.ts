import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PACIFICA_CENTRAL_STATE, PACIFICA_PROGRAM_ID, PACIFICA_USDC_MINT } from "../config";

const PROGRAM_ID = new PublicKey(PACIFICA_PROGRAM_ID);
const CENTRAL_STATE = new PublicKey(PACIFICA_CENTRAL_STATE);
const USDC_MINT = new PublicKey(PACIFICA_USDC_MINT);
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Anchor discriminators from the testnet program's IDL.
const MINT_TEST_USDC = [118, 144, 78, 118, 155, 214, 185, 186];
const DEPOSIT = [242, 35, 198, 137, 82, 225, 242, 182];

const USDC_DECIMALS = 1_000_000;

function associatedTokenAddress(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), USDC_MINT.toBuffer()],
    ATA_PROGRAM_ID,
  )[0];
}

function amountData(discriminator: number[], usdc: number): Buffer {
  const data = Buffer.alloc(16);
  Buffer.from(discriminator).copy(data, 0);
  new DataView(data.buffer, data.byteOffset).setBigUint64(
    8,
    BigInt(Math.round(usdc * USDC_DECIMALS)),
    true,
  );
  return data;
}

/** Testnet only: mints mock USDC ("USDP") to the player's wallet. */
export function mintTestUsdcInstruction(user: PublicKey, usdc: number): TransactionInstruction {
  const [userAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_account"), user.toBuffer()],
    PROGRAM_ID,
  );
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: amountData(MINT_TEST_USDC, usdc),
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userAccount, isSigner: false, isWritable: true },
      { pubkey: associatedTokenAddress(user), isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: true },
      { pubkey: CENTRAL_STATE, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

/** Moves USDC from the player's wallet into their Pacifica trading account. */
export function depositInstruction(depositor: PublicKey, usdc: number): TransactionInstruction {
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PROGRAM_ID,
  );
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: amountData(DEPOSIT, usdc),
    keys: [
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(depositor), isSigner: false, isWritable: true },
      { pubkey: CENTRAL_STATE, isSigner: false, isWritable: true },
      { pubkey: associatedTokenAddress(CENTRAL_STATE), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

export function usdcTokenAccount(owner: PublicKey): PublicKey {
  return associatedTokenAddress(owner);
}
