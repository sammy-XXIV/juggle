package com.radiants.juggle

/**
 * Native allowlist for everything the web layer can ask the wallet to sign. The web layer has the same checks
 * (src/wallet/guard.ts), but a compromised WebView could skip them, so the bridge re-checks the raw bytes here
 * before a wallet session opens. Constants mirror src/config.ts.
 */
object SigningGuard {
    const val PACIFICA_PROGRAM = "peRPsYCcB1J9jvrs29jiGdjkytxs8uHLmSPLKKP9ptm"
    const val SKR_MINT = "3zcV6Y9yxbYMgbyc2GSnfaFkMSx8tKX7pjvBfTf2w7qr"
    const val TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"

    private val MINT_TEST_USDC = intArrayOf(118, 144, 78, 118, 155, 214, 185, 186)
    private val DEPOSIT = intArrayOf(242, 35, 198, 137, 82, 225, 242, 182)
    private const val TOKEN_BURN = 8
    private const val MAX_SKR_BURN = 250L * 1_000_000L
    private const val MAX_USDC = 10_000L * 1_000_000L
    private const val MAX_INSTRUCTIONS = 3
    private const val MAX_MESSAGE_BYTES = 400

    class Refused(why: String) : Exception("Refusing to sign: $why")

    private const val ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

    fun base58Decode(input: String): ByteArray {
        var value = java.math.BigInteger.ZERO
        for (c in input) {
            val digit = ALPHABET.indexOf(c)
            require(digit >= 0) { "not base58" }
            value = value.multiply(java.math.BigInteger.valueOf(58)).add(java.math.BigInteger.valueOf(digit.toLong()))
        }
        val bytes = value.toByteArray().dropWhile { it == 0.toByte() }.toByteArray()
        val leadingZeros = input.takeWhile { it == '1' }.length
        return ByteArray(leadingZeros) + bytes
    }

    fun base58Encode(bytes: ByteArray): String {
        var value = java.math.BigInteger(1, bytes)
        val sb = StringBuilder()
        val fiftyEight = java.math.BigInteger.valueOf(58)
        while (value.signum() > 0) {
            val (q, r) = value.divideAndRemainder(fiftyEight)
            sb.append(ALPHABET[r.toInt()])
            value = q
        }
        bytes.takeWhile { it == 0.toByte() }.forEach { _ -> sb.append('1') }
        return sb.reverse().toString()
    }

    private class Reader(val b: ByteArray) {
        var pos = 0
        fun byte(): Int { if (pos >= b.size) throw Refused("truncated transaction"); return b[pos++].toInt() and 0xff }
        fun take(n: Int): ByteArray { if (n < 0 || pos + n > b.size) throw Refused("truncated transaction"); return b.copyOfRange(pos, pos + n).also { pos += n } }
        fun compact(): Int {
            var result = 0
            var shift = 0
            while (true) {
                val v = byte()
                result = result or ((v and 0x7f) shl shift)
                if (v and 0x80 == 0) return result
                shift += 7
                if (shift > 14) throw Refused("bad length encoding")
            }
        }
    }

    private fun u64(data: ByteArray, offset: Int): Long {
        var v = 0L
        for (i in 7 downTo 0) v = (v shl 8) or (data[offset + i].toLong() and 0xff)
        return v
    }

    private fun startsWith(data: ByteArray, prefix: IntArray) = data.size >= prefix.size && prefix.indices.all { (data[it].toInt() and 0xff) == prefix[it] }

    /** [serialized] is a legacy transaction as web3.js serialises it (signature slots first, then the message). */
    fun checkTransaction(serialized: ByteArray, wallet: ByteArray) {
        val r = Reader(serialized)
        val sigCount = r.compact()
        r.take(sigCount * 64)

        val first = r.byte()
        if (first and 0x80 != 0) throw Refused("versioned transactions are not used by Juggle")
        val requiredSigners = first
        r.byte(); r.byte() // read-only signed / unsigned counts
        if (requiredSigners != 1 || sigCount != 1) throw Refused("only the wallet may sign")

        val accountCount = r.compact()
        val accounts = List(accountCount) { r.take(32) }
        r.take(32) // recent blockhash
        if (accounts.isEmpty() || !accounts[0].contentEquals(wallet)) throw Refused("fee payer is not the connected wallet")

        val pacifica = base58Decode(PACIFICA_PROGRAM)
        val token = base58Decode(TOKEN_PROGRAM)
        val skr = base58Decode(SKR_MINT)

        val instructionCount = r.compact()
        if (instructionCount < 1 || instructionCount > MAX_INSTRUCTIONS) throw Refused("unexpected number of instructions")
        repeat(instructionCount) {
            val program = accounts.getOrNull(r.byte()) ?: throw Refused("bad program index")
            val keys = List(r.compact()) { accounts.getOrNull(r.byte()) ?: throw Refused("bad account index") }
            val data = r.take(r.compact())

            when {
                program.contentEquals(pacifica) -> {
                    if (data.size != 16 || !(startsWith(data, MINT_TEST_USDC) || startsWith(data, DEPOSIT))) throw Refused("unknown Pacifica instruction")
                    if (u64(data, 8) < 0 || u64(data, 8) > MAX_USDC) throw Refused("amount above the testnet cap")
                    if (keys.firstOrNull()?.contentEquals(wallet) != true) throw Refused("Pacifica instruction is not owned by the wallet")
                }
                program.contentEquals(token) -> {
                    if (data.size != 9 || (data[0].toInt() and 0xff) != TOKEN_BURN) throw Refused("only SKR burns are allowed on the token program")
                    if (u64(data, 1) < 0 || u64(data, 1) > MAX_SKR_BURN) throw Refused("burn above the largest shield tier")
                    if (keys.size < 3 || !keys[1].contentEquals(skr)) throw Refused("burn is not of the SKR mint")
                    if (!keys[2].contentEquals(wallet)) throw Refused("burn authority is not the wallet")
                }
                else -> throw Refused("program is not allowed")
            }
        }
        if (r.pos != serialized.size) throw Refused("trailing bytes")
    }

    private val NAME_MESSAGE = Regex("^Juggle leaderboard name\\nname: [A-Za-z0-9_]{3,16}\\naccount: ([1-9A-HJ-NP-Za-km-z]{32,44})\\ntimestamp: \\d{10,16}$")
    private val BIND_MESSAGE = Regex("^\\{\"data\":\\{\"agent_wallet\":\"[1-9A-HJ-NP-Za-km-z]{32,44}\"\\},\"expiry_window\":(\\d{1,6}),\"timestamp\":(\\d{10,16}),\"type\":\"bind_agent_wallet\"\\}$")

    fun checkMessage(message: ByteArray, wallet: ByteArray, nowMs: Long = System.currentTimeMillis()) {
        val walletBase58 = base58Encode(wallet)
        if (message.size > MAX_MESSAGE_BYTES) throw Refused("message is too long")
        val text = String(message, Charsets.UTF_8)
        NAME_MESSAGE.find(text)?.let {
            if (it.groupValues[1] != walletBase58) throw Refused("message names a different account")
            return
        }
        val bind = BIND_MESSAGE.find(text) ?: throw Refused("unrecognised message")
        if (bind.groupValues[1].toLong() > 120_000) throw Refused("bind stays valid too long")
        if (kotlin.math.abs(nowMs - bind.groupValues[2].toLong()) > 5 * 60_000) throw Refused("stale message")
    }
}
