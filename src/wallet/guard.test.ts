import { describe, expect, test, vi } from "vitest";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";

vi.mock("./wallet", () => ({ connection: {} }));

import { PACIFICA_PROGRAM_ID, SKR_MINT } from "../config";
import { depositInstruction, mintTestUsdcInstruction } from "../pacifica/funding";
import { burnSkrInstruction, skrAta } from "../skr";
import { assertSafeMessage, assertSafeTransaction } from "./guard";

const wallet = Keypair.generate().publicKey;
const stranger = Keypair.generate().publicKey;
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const txOf = (payer: PublicKey, ...ix: TransactionInstruction[]) => {
  const tx = new Transaction().add(...ix);
  tx.feePayer = payer;
  return tx;
};
const u64le = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(n % 2 ** 32, 0);
  b.writeUInt32LE(Math.floor(n / 2 ** 32), 4);
  return b;
};
const tokenIx = (data: Buffer, keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]) =>
  new TransactionInstruction({ programId: TOKEN, data, keys });
const w = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });

describe("transactions the app really sends", () => {
  test("mint test USDC", () => expect(() => assertSafeTransaction(txOf(wallet, mintTestUsdcInstruction(wallet, 1000)), wallet)).not.toThrow());
  test("deposit", () => expect(() => assertSafeTransaction(txOf(wallet, depositInstruction(wallet, 100)), wallet)).not.toThrow());
  test("burn 150 SKR", () => expect(() => assertSafeTransaction(txOf(wallet, burnSkrInstruction(wallet, 150)), wallet)).not.toThrow());
  test("burn the biggest shield tier (250 SKR)", () => expect(() => assertSafeTransaction(txOf(wallet, burnSkrInstruction(wallet, 250)), wallet)).not.toThrow());
});

describe("transactions that must be refused", () => {
  const refused = (tx: Transaction) => expect(() => assertSafeTransaction(tx, wallet)).toThrow(/Refusing to sign/);

  test("fee payer is someone else", () => refused(txOf(stranger, burnSkrInstruction(wallet, 150))));
  test("no fee payer", () => refused(new Transaction().add(burnSkrInstruction(wallet, 150))));
  test("native SOL transfer (drain)", () => refused(txOf(wallet, SystemProgram.transfer({ fromPubkey: wallet, toPubkey: stranger, lamports: 1e9 }))));
  test("SPL token transfer (instruction 3)", () =>
    refused(txOf(wallet, tokenIx(Buffer.concat([Buffer.from([3]), u64le(1)]), [w(skrAta(wallet)), w(skrAta(stranger)), w(wallet, true)]))));
  test("approve / set delegate (instruction 4)", () =>
    refused(txOf(wallet, tokenIx(Buffer.concat([Buffer.from([4]), u64le(1e12)]), [w(skrAta(wallet)), w(stranger), w(wallet, true)]))));
  test("close account (instruction 9)", () => refused(txOf(wallet, tokenIx(Buffer.from([9]), [w(skrAta(wallet)), w(stranger), w(wallet, true)]))));
  test("burn of a different mint", () => {
    const ix = burnSkrInstruction(wallet, 150);
    ix.keys[1] = w(Keypair.generate().publicKey);
    refused(txOf(wallet, ix));
  });
  test("burn from an account that is not the wallet's SKR account", () => {
    const ix = burnSkrInstruction(wallet, 150);
    ix.keys[0] = w(skrAta(stranger));
    refused(txOf(wallet, ix));
  });
  test("burn authority is someone else", () => {
    const ix = burnSkrInstruction(wallet, 150);
    ix.keys[2] = w(stranger, true);
    refused(txOf(wallet, ix));
  });
  test("burn above the largest tier", () => refused(txOf(wallet, burnSkrInstruction(wallet, 251))));
  test("an instruction that needs another signer", () => {
    const ix = depositInstruction(wallet, 100);
    ix.keys.push(w(stranger, true));
    refused(txOf(wallet, ix));
  });
  test("unknown Pacifica instruction", () => {
    const ix = depositInstruction(wallet, 100);
    ix.data[0] ^= 0xff;
    refused(txOf(wallet, ix));
  });
  test("Pacifica amount above the testnet cap", () => refused(txOf(wallet, depositInstruction(wallet, 1_000_000))));
  test("Pacifica instruction whose first account is not the wallet", () => refused(txOf(wallet, depositInstruction(stranger, 100))));
  test("a program that isn't allowed", () =>
    refused(txOf(wallet, new TransactionInstruction({ programId: Keypair.generate().publicKey, data: Buffer.from([1]), keys: [w(wallet, true)] }))));
  test("too many instructions", () =>
    refused(txOf(wallet, ...Array.from({ length: 4 }, () => burnSkrInstruction(wallet, 1)))));
  test("empty transaction", () => {
    const tx = new Transaction();
    tx.feePayer = wallet;
    refused(tx);
  });
});

describe("messages", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const now = 1_790_000_000_000;
  const agent = Keypair.generate().publicKey.toBase58();
  const bind = (over: Record<string, unknown> = {}, data: Record<string, unknown> = { agent_wallet: agent }) =>
    enc(JSON.stringify({ data, expiry_window: 120_000, timestamp: now, type: "bind_agent_wallet", ...over }));
  const name = (account = wallet.toBase58(), n = "Sammy") => enc(`Juggle leaderboard name\nname: ${n}\naccount: ${account}\ntimestamp: ${now}`);

  test("leaderboard name for this wallet", () => expect(() => assertSafeMessage(name(), wallet, now)).not.toThrow());
  test("agent key bind, 2 minute window", () => expect(() => assertSafeMessage(bind(), wallet, now)).not.toThrow());

  const refused = (m: Uint8Array) => expect(() => assertSafeMessage(m, wallet, now)).toThrow(/Refusing to sign/);
  test("name message for a different account", () => refused(name(stranger.toBase58())));
  test("name with illegal characters", () => refused(name(wallet.toBase58(), "bad name!")));
  test("arbitrary text", () => refused(enc("Sign in to evil.example and approve everything")));
  test("a Pacifica withdrawal request", () =>
    refused(enc(JSON.stringify({ data: { amount: "100" }, expiry_window: 5000, timestamp: now, type: "withdraw" }))));
  test("bind with an extra field", () => refused(bind({ extra: 1 })));
  test("bind with extra data fields", () => refused(bind({}, { agent_wallet: agent, permissions: "all" })));
  test("bind that stays valid too long", () => refused(bind({ expiry_window: 3_600_000 })));
  test("stale bind (replayed)", () => refused(bind({ timestamp: now - 3_600_000 })));
  test("bind with a malformed agent key", () => refused(bind({}, { agent_wallet: "not a key" })));
  test("oversized message", () => refused(enc("x".repeat(500))));
});

test("allowlist matches the app's config", () => {
  expect(PACIFICA_PROGRAM_ID).toBe("peRPsYCcB1J9jvrs29jiGdjkytxs8uHLmSPLKKP9ptm");
  expect(SKR_MINT).toBe("3zcV6Y9yxbYMgbyc2GSnfaFkMSx8tKX7pjvBfTf2w7qr");
});
