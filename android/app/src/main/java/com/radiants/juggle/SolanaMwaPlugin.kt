package com.radiants.juggle

import android.net.Uri
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.AdapterOperations
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.Solana
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.AuthorizationResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Bridges Solana Mobile Wallet Adapter (Seed Vault, Phantom, Solflare...) into the web layer. */
@CapacitorPlugin(name = "SolanaMwa")
class SolanaMwaPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var sender: ActivityResultSender
    private var adapter: MobileWalletAdapter? = null
    private var wallet: ByteArray? = null // the account the player authorized; only it may sign

    // Must run during Activity.onCreate: ActivityResultSender registers an activity-result launcher.
    override fun load() {
        sender = ActivityResultSender(activity)
    }

    override fun handleOnDestroy() {
        scope.cancel()
    }

    private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun unb64(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)

    private fun requireAdapter(call: PluginCall): MobileWalletAdapter? =
        adapter ?: run { call.reject("Wallet not connected"); null }

    /** Runs a wallet session and resolves/rejects the call from its result. */
    private fun <T> session(
        call: PluginCall,
        mwa: MobileWalletAdapter,
        block: suspend AdapterOperations.(AuthorizationResult) -> T,
        toJs: (T, AuthorizationResult) -> JSObject,
    ) {
        scope.launch {
            try {
                when (val result = mwa.transact(sender, null, block)) {
                    is TransactionResult.Success -> call.resolve(toJs(result.payload, result.authResult))
                    is TransactionResult.NoWalletFound -> call.reject("No Solana wallet app found", "NO_WALLET")
                    is TransactionResult.Failure -> call.reject(result.message, result.e)
                }
            } catch (e: Exception) {
                call.reject(e.message ?: "Wallet request failed", e)
            }
        }
    }

    @PluginMethod
    fun authorize(call: PluginCall) {
        val identityUri = call.getString("identityUri") ?: return call.reject("identityUri required")
        val mwa = MobileWalletAdapter(
            ConnectionIdentity(
                identityUri = Uri.parse(identityUri),
                iconUri = Uri.parse(call.getString("iconPath") ?: "favicon.svg"),
                identityName = call.getString("identityName") ?: "Juggle",
            ),
        )
        mwa.blockchain = if (call.getString("cluster") == "mainnet") Solana.Mainnet else Solana.Devnet
        adapter = mwa
        session(call, mwa, { it }, { _, auth ->
            wallet = auth.accounts.first().publicKey
            JSObject().apply {
                put("publicKey", b64(auth.accounts.first().publicKey))
                put("label", auth.accounts.first().accountLabel)
            }
        })
    }

    @PluginMethod
    fun signMessage(call: PluginCall) {
        val mwa = requireAdapter(call) ?: return
        val message = unb64(call.getString("message") ?: return call.reject("message required"))
        try { SigningGuard.checkMessage(message, wallet ?: return call.reject("Wallet not connected")) }
        catch (e: SigningGuard.Refused) { return call.reject(e.message, "REFUSED") }
        session(call, mwa, { auth ->
            signMessagesDetached(arrayOf(message), arrayOf(auth.accounts.first().publicKey))
        }, { result, _ ->
            JSObject().apply { put("signature", b64(result.messages.first().signatures.first())) }
        })
    }

    // Wallet signs only; the app submits to its own RPC, so the wallet's network setting can't get in the way.
    @PluginMethod
    fun signTransaction(call: PluginCall) {
        val mwa = requireAdapter(call) ?: return
        val tx = unb64(call.getString("transaction") ?: return call.reject("transaction required"))
        try { SigningGuard.checkTransaction(tx, wallet ?: return call.reject("Wallet not connected")) }
        catch (e: SigningGuard.Refused) { return call.reject(e.message, "REFUSED") }
        session(call, mwa, { signTransactions(arrayOf(tx)) }, { result, _ ->
            JSObject().apply { put("transaction", b64(result.signedPayloads.first())) }
        })
    }

    @PluginMethod
    fun deauthorize(call: PluginCall) {
        val mwa = adapter ?: return call.resolve()
        scope.launch {
            mwa.disconnect(sender)
            adapter = null
            wallet = null
            call.resolve()
        }
    }
}
