package com.radiants.juggle

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.Base64

class SigningGuardTest {
    // Serialized by web3.js from the app's own instruction builders (scripts/gen-signing-vectors.ts).
    private val walletB58 = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB"
    private val burn150 = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEE6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iwseZoxQ3aYKFCrg0Z8oftlHAwTSa4+Ywby61K8OqXeqf8z6hT0ltwGXHbAG0E473jInqA0GJdDI6cb50+10RYcBt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEDAwIBAAkIgNHwCAAAAAA="
    private val burn251 = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEE6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iwseZoxQ3aYKFCrg0Z8oftlHAwTSa4+Ywby61K8OqXeqf8z6hT0ltwGXHbAG0E473jInqA0GJdDI6cb50+10RYcBt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEDAwIBAAkIwPT1DgAAAAA="
    private val deposit = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAYK6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iwdjycMn8vCPusddLvEYvG4MlQj+8j/JH1MszljK+HPE0HkHxqjdd+AABUScG++ItEDv4OEAQ2KsZudjqlvGTdaSaT5IuEGjf/yEbOGmk7GUIAXG50yX43KqttE57rLKoMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIs3SfHTy0sCWjUtF5s91wR5grjO9GxaD6JA22z5o96njJclj04kifG7PRApFI4NgwtaE5na/xCEBI572Nvp+FkMNJwQXgQEE0gB187bFcjo0yGGfLrCUs3bLdem75drNgbd9uHXZaGT2cvhRs7reawctIXtX1s3kTqM9YV+/wCpBwcw6JdVg63roofnM+3B5hTjhe+iq9RZRXHyr7YW/OgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEHCgADAQIIBgkEBQcQ8iPGiVLh8rYA4fUFAAAAAA=="
    private val mint = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAUJ6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0ixJpPki4QaN//IRs4aaTsZQgBcbnTJfjcqq20Tnussqg8ayF746PCy+sUX83ZwVttcHAgq40YodMb6c2PsYuQ3TBwcw6JdVg63roofnM+3B5hTjhe+iq9RZRXHyr7YW/OgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB2PJwyfy8I+6x10u8Ri8bgyVCP7yP8kfUyzOWMr4c8TjJclj04kifG7PRApFI4NgwtaE5na/xCEBI572Nvp+FkMNJwQXgQEE0gB187bFcjo0yGGfLrCUs3bLdem75drNgbd9uHXZaGT2cvhRs7reawctIXtX1s3kTqM9YV+/wCpAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBwgAAgEDBQYIBBB2kE52m9a5ugDKmjsAAAAA"

    private val wallet = SigningGuard.base58Decode(walletB58)
    private fun bytes(b64: String) = Base64.getDecoder().decode(b64)

    private fun refused(block: () -> Unit) {
        try {
            block()
            fail("expected the guard to refuse")
        } catch (e: SigningGuard.Refused) {
            assertTrue(e.message!!.startsWith("Refusing to sign"))
        }
    }

    // ---- real transactions ----
    @Test fun acceptsBurn() = SigningGuard.checkTransaction(bytes(burn150), wallet)
    @Test fun acceptsDeposit() = SigningGuard.checkTransaction(bytes(deposit), wallet)
    @Test fun acceptsMint() = SigningGuard.checkTransaction(bytes(mint), wallet)
    @Test fun refusesBurnAboveLargestTier() = refused { SigningGuard.checkTransaction(bytes(burn251), wallet) }
    @Test fun refusesWhenWalletIsSomeoneElse() =
        refused { SigningGuard.checkTransaction(bytes(burn150), SigningGuard.base58Decode("11111111111111111111111111111112")) }
    @Test fun refusesTruncated() = refused { SigningGuard.checkTransaction(bytes(burn150).copyOf(120), wallet) }
    @Test fun refusesTrailingBytes() = refused { SigningGuard.checkTransaction(bytes(burn150) + byteArrayOf(1), wallet) }

    @Test fun refusesVersionedTransaction() {
        val raw = bytes(burn150)
        val messageStart = 1 + 64
        raw[messageStart] = (raw[messageStart].toInt() or 0x80).toByte()
        refused { SigningGuard.checkTransaction(raw, wallet) }
    }

    // ---- hand-built transactions ----
    private fun compact(n: Int) = byteArrayOf(n.toByte())

    private fun build(accounts: List<ByteArray>, instructions: List<Triple<Int, List<Int>, ByteArray>>, signers: Int = 1): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(compact(signers))
        out.write(ByteArray(64 * signers))
        out.write(byteArrayOf(signers.toByte(), 0, (accounts.size - signers).toByte()))
        out.write(compact(accounts.size))
        accounts.forEach { out.write(it) }
        out.write(ByteArray(32))
        out.write(compact(instructions.size))
        for ((program, keys, data) in instructions) {
            out.write(program)
            out.write(compact(keys.size))
            keys.forEach { out.write(it) }
            out.write(compact(data.size))
            out.write(data)
        }
        return out.toByteArray()
    }

    private fun u64(n: Long) = ByteArray(8) { ((n shr (8 * it)) and 0xff).toByte() }
    private val token = SigningGuard.base58Decode(SigningGuard.TOKEN_PROGRAM)
    private val skr = SigningGuard.base58Decode(SigningGuard.SKR_MINT)
    private val other = ByteArray(32) { 9 }
    private val ata = ByteArray(32) { 5 }
    private val system = ByteArray(32)

    private fun burn(mintKey: ByteArray = skr, authority: ByteArray = wallet, amount: Long = 150_000_000, tag: Int = 8): ByteArray {
        val accounts = listOf(wallet, ata, mintKey, token, authority)
        return build(accounts, listOf(Triple(3, listOf(1, 2, 4), byteArrayOf(tag.toByte()) + u64(amount))))
    }

    @Test fun handBuiltBurnIsAccepted() = SigningGuard.checkTransaction(burn(), wallet)
    @Test fun refusesTokenTransfer() = refused { SigningGuard.checkTransaction(burn(tag = 3), wallet) }
    @Test fun refusesApprove() = refused { SigningGuard.checkTransaction(burn(tag = 4), wallet) }
    @Test fun refusesCloseAccount() = refused { SigningGuard.checkTransaction(burn(tag = 9), wallet) }
    @Test fun refusesBurnOfOtherMint() = refused { SigningGuard.checkTransaction(burn(mintKey = other), wallet) }
    @Test fun refusesBurnWithOtherAuthority() = refused { SigningGuard.checkTransaction(burn(authority = other), wallet) }
    @Test fun refusesOversizedBurn() = refused { SigningGuard.checkTransaction(burn(amount = 250_000_001), wallet) }

    @Test fun refusesSystemTransfer() {
        val data = byteArrayOf(2, 0, 0, 0) + u64(1_000_000_000)
        refused { SigningGuard.checkTransaction(build(listOf(wallet, other, system), listOf(Triple(2, listOf(0, 1), data))), wallet) }
    }

    @Test fun refusesTwoSigners() = refused {
        SigningGuard.checkTransaction(
            build(listOf(wallet, other, token, skr, ata), listOf(Triple(2, listOf(4, 3, 0), byteArrayOf(8) + u64(1))), signers = 2),
            wallet,
        )
    }

    @Test fun refusesTooManyInstructions() {
        val accounts = listOf(wallet, ata, skr, token)
        val ix = Triple(3, listOf(1, 2, 0), byteArrayOf(8) + u64(1))
        refused { SigningGuard.checkTransaction(build(accounts, List(4) { ix }), wallet) }
    }

    // ---- messages ----
    private val now = 1_790_000_000_000L

    private fun name(account: String = walletB58, n: String = "Sammy") =
        "Juggle leaderboard name\nname: $n\naccount: $account\ntimestamp: $now".toByteArray()

    private fun bind(expiry: Int = 120_000, ts: Long = now) =
        "{\"data\":{\"agent_wallet\":\"$walletB58\"},\"expiry_window\":$expiry,\"timestamp\":$ts,\"type\":\"bind_agent_wallet\"}".toByteArray()

    @Test fun acceptsNameMessage() = SigningGuard.checkMessage(name(), wallet, now)
    @Test fun acceptsBindMessage() = SigningGuard.checkMessage(bind(), wallet, now)
    @Test fun refusesNameForOtherAccount() = refused { SigningGuard.checkMessage(name(account = "11111111111111111111111111111112"), wallet, now) }
    @Test fun refusesIllegalName() = refused { SigningGuard.checkMessage(name(n = "bad name!"), wallet, now) }
    @Test fun refusesArbitraryText() = refused { SigningGuard.checkMessage("Sign in to evil.example".toByteArray(), wallet, now) }
    @Test fun refusesLongBindWindow() = refused { SigningGuard.checkMessage(bind(expiry = 3_600_000), wallet, now) }
    @Test fun refusesStaleBind() = refused { SigningGuard.checkMessage(bind(ts = now - 3_600_000), wallet, now) }

    @Test fun refusesBindWithExtraField() = refused {
        val m = "{\"data\":{\"agent_wallet\":\"$walletB58\",\"permissions\":\"all\"},\"expiry_window\":5000,\"timestamp\":$now,\"type\":\"bind_agent_wallet\"}"
        SigningGuard.checkMessage(m.toByteArray(), wallet, now)
    }

    @Test fun refusesWithdrawRequest() = refused {
        val m = "{\"data\":{\"amount\":\"100\"},\"expiry_window\":5000,\"timestamp\":$now,\"type\":\"withdraw\"}"
        SigningGuard.checkMessage(m.toByteArray(), wallet, now)
    }

    @Test fun refusesOversizedMessage() = refused { SigningGuard.checkMessage(ByteArray(500) { 'x'.code.toByte() }, wallet, now) }

    @Test fun base58RoundTrip() {
        assertEquals(walletB58, SigningGuard.base58Encode(SigningGuard.base58Decode(walletB58)))
        assertEquals("11111111111111111111111111111112", SigningGuard.base58Encode(SigningGuard.base58Decode("11111111111111111111111111111112")))
    }
}
