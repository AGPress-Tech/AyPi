package it.agpress.aypi.calendar.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ActivityInfo
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.ScreenRotation
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import it.agpress.aypi.calendar.data.AdminSession
import it.agpress.aypi.calendar.data.ApiException
import it.agpress.aypi.calendar.data.AyPiApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Renderer condiviso con il desktop, risorse locali e sessione solo nativa. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FornoScreen(session: AdminSession, onBack: () -> Unit) {
    val context = LocalContext.current
    val activity = LocalActivity.current
    val orientation = LocalConfiguration.current.orientation
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val holder = remember(session.token) { FornoWebHolder(context, session, scope) }
    val goBack = {
        holder.view.evaluateJavascript(
            "(()=>{const d=Array.from(document.querySelectorAll('dialog[open]')).pop();if(d){d.close();return true;}if(document.documentElement.classList.contains('mobile-chart-focus')){window.__aypiToggleFullscreen?.();return true;}return false;})()",
        ) { if (it != "true") onBack() }
    }
    BackHandler(onBack = goBack)
    DisposableEffect(holder, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> holder.setActive(true)
                Lifecycle.Event.ON_PAUSE -> holder.setActive(false)
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        holder.setActive(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        onDispose { lifecycle.removeObserver(observer); holder.close() }
    }
    DisposableEffect(activity) {
        val orientation = activity?.requestedOrientation
        onDispose { if (orientation != null) activity.requestedOrientation = orientation }
    }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Scada Forno") },
            navigationIcon = { IconButton(onClick = goBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Indietro") } },
            actions = {
                IconButton(onClick = {
                    holder.view.evaluateJavascript("window.__aypiToggleFullscreen?.()") { result ->
                        if (result == "true") holder.view.scrollTo(0, 0)
                    }
                }) { Icon(Icons.Default.Fullscreen, "Espandi o riduci il grafico") }
                IconButton(onClick = {
                    activity?.requestedOrientation = if (orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE)
                        ActivityInfo.SCREEN_ORIENTATION_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                }) { Icon(Icons.Default.ScreenRotation, "Ruota la vista del forno") }
            },
        )
    }) { padding ->
        AndroidView(factory = { holder.view }, modifier = Modifier.padding(padding).fillMaxSize())
    }
}

@SuppressLint("SetJavaScriptEnabled")
private class FornoWebHolder(context: Context, session: AdminSession, scope: CoroutineScope) {
    private val disposed = AtomicBoolean(false)
    private val active = AtomicBoolean(true)
    private val pending = AtomicInteger(0)
    private val api = AyPiApi()
    val view = WebView(context)

    init {
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val uri = request.url
                val path = uri.path.orEmpty().removePrefix("/assets/")
                if (uri.scheme != "https" || uri.host != "appassets.androidplatform.net" ||
                    !uri.path.orEmpty().startsWith("/assets/forno/") || path.split('/').any { it == ".." || it == "." } || path.contains('\\')) return denied()
                return try {
                    val mime = when (path.substringAfterLast('.')) {
                        "html" -> "text/html"
                        "js" -> "application/javascript"
                        "css" -> "text/css"
                        else -> return denied()
                    }
                    WebResourceResponse(mime, "UTF-8", context.assets.open(path))
                } catch (_: Exception) { denied() }
            }
            override fun onPageFinished(view: WebView, url: String) { setActive(active.get()) }
        }
        view.addJavascriptInterface(object {
            @JavascriptInterface
            fun request(id: String, channel: String, payload: String) {
                if (disposed.get() || !id.matches(Regex("[0-9]{1,12}"))) return
                if (!active.get()) { reply(id, false, "Vista forno in pausa"); return }
                if (payload.length > 20000 || pending.incrementAndGet() > 8) {
                    if (payload.length <= 20000) pending.decrementAndGet()
                    reply(id, false, "Troppe richieste forno. Riprovare tra poco.")
                    return
                }
                scope.launch {
                    try {
                        val response = withContext(Dispatchers.IO) { api.forno(session, channel, JSONObject(payload)) }
                        reply(id, true, response.toString())
                    } catch (error: CancellationException) { throw error }
                    catch (error: Exception) {
                        val message = when {
                            error is ApiException && error.statusCode == 404 -> "Aggiornare il backend/gateway sul server per usare Scada Forno su Android."
                            error is ApiException && error.statusCode == 401 -> "Sessione scaduta. Tornare alla home ed effettuare nuovamente l’accesso."
                            else -> error.message ?: "Collegamento al forno non disponibile"
                        }
                        reply(id, false, message)
                    }
                    finally { pending.decrementAndGet() }
                }
            }
        }, "AyPiForno")
        view.loadUrl("https://appassets.androidplatform.net/assets/forno/pages/forno.html?mobile=1")
    }

    private fun denied() = WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    private fun reply(id: String, success: Boolean, payload: String) {
        view.post {
            if (!disposed.get()) view.evaluateJavascript("window.__aypiResolve?.(${JSONObject.quote(id)},$success,${JSONObject.quote(payload)})", null)
        }
    }
    fun setActive(value: Boolean) {
        if (disposed.get()) return
        active.set(value)
        if (value) view.onResume()
        view.evaluateJavascript("window.__aypiSetActive?.($value)", null)
        if (!value) view.onPause()
    }
    fun close() {
        if (!disposed.compareAndSet(false, true)) return
        view.evaluateJavascript("window.dispatchEvent(new Event('beforeunload'))", null)
        view.removeJavascriptInterface("AyPiForno")
        view.stopLoading()
        view.destroy()
    }
}
