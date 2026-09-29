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
        session(call, mwa, { auth ->
            signMessagesDetached(arrayOf(message), arrayOf(auth.accounts.first().publicKey))
        }, { result, _ ->
            JSObject().apply { put("signature", b64(result.messages.first().signatures.first())) }
        })
    }

    @PluginMethod
    fun signAndSendTransaction(call: PluginCall) {
        val mwa = requireAdapter(call) ?: return
        val tx = unb64(call.getString("transaction") ?: return call.reject("transaction required"))
        session(call, mwa, { signAndSendTransactions(arrayOf(tx)) }, { result, _ ->
            JSObject().apply { put("signature", b64(result.signatures.first())) }
        })
    }

    @PluginMethod
    fun deauthorize(call: PluginCall) {
        val mwa = adapter ?: return call.resolve()
        scope.launch {
            mwa.disconnect(sender)
            adapter = null
            call.resolve()
        }
    }
}
