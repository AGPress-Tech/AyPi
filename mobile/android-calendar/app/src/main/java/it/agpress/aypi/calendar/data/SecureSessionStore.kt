package it.agpress.aypi.calendar.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureSessionStore(context: Context) {
    private val preferences =
        context.getSharedPreferences("aypi_mobile_secure", Context.MODE_PRIVATE)
    private val alias = "aypi_calendar_session_v1"

    fun save(session: AdminSession) {
        val plain = JSONObject()
            .put("token", session.token)
            .put("adminName", session.adminName)
            .put("expiresAt", session.expiresAt)
            .put("calendar", session.calendar)
            .put("purchasing", session.purchasing)
            .put("ticketSupport", session.ticketSupport)
            .put("productionPlanner", session.productionPlanner)
            .toString()
            .toByteArray()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        preferences.edit()
            .putString("session", Base64.encodeToString(cipher.doFinal(plain), Base64.NO_WRAP))
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .apply()
    }

    fun load(): AdminSession? = runCatching {
        val encrypted = Base64.decode(
            preferences.getString("session", null) ?: return null,
            Base64.NO_WRAP,
        )
        val iv = Base64.decode(
            preferences.getString("iv", null) ?: return null,
            Base64.NO_WRAP,
        )
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        val json = JSONObject(String(cipher.doFinal(encrypted)))
        AdminSession(
            token = json.getString("token"),
            adminName = json.getString("adminName"),
            expiresAt = json.getString("expiresAt"),
            calendar = json.optBoolean("calendar", true),
            purchasing = json.optBoolean("purchasing", true),
            ticketSupport = json.optBoolean("ticketSupport", true),
            productionPlanner = json.optBoolean("productionPlanner", true),
        )
    }.getOrElse {
        clear()
        null
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore",
        ).run {
            init(
                KeyGenParameterSpec.Builder(
                    alias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            generateKey()
        }
    }
}
