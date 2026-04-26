package com.puzzlox.app

import android.net.Uri
import android.content.res.Configuration
import android.content.pm.ActivityInfo
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ScrollView
import android.widget.TextView
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import java.util.Locale
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.OnUserEarnedRewardListener
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var currentRewardRequestId: String? = null
    private var userEarnedThisShow = false

    private val filePicker =
        registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris: List<Uri> ->
            filePathCallback?.onReceiveValue(uris.toTypedArray())
            filePathCallback = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        hideStatusBar()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val prov = WebView.getCurrentWebViewPackage()
            if (prov == null) {
                Log.e(TAG, "No WebView provider (install/update Android System WebView)")
                setContentView(
                    fatalErrorView(
                        "Android System WebView가 없어 앱을 열 수 없어요. Play 스토어에서 " +
                            "\"Android System WebView\"(또는 \"Chrome\")를 설치·업데이트해 주세요.",
                    ),
                )
                return
            }
        }

        val wv = try {
            WebView(this).apply {
                layoutParams = FrameLayout.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                )
            }
        } catch (e: Throwable) {
            Log.e(TAG, "WebView() failed", e)
            setContentView(fatalErrorView("WebView를 시작할 수 없어요.\n\n${e.javaClass.simpleName}: ${e.message}\n\nAndroid System WebView를 최신으로 업데이트해 주세요."))
            return
        }
        webView = wv
        setContentView(wv)

        // RewardedAd.load 전에 SDK가 먹도록, WebView post 이후가 아닌 이 시점에서 초기화(순서 경쟁 방지)
        runCatching {
            MobileAds.initialize(this) { Log.d(TAG, "MobileAds SDK onInitializationComplete") }
        }.onFailure { e ->
            Log.e(TAG, "MobileAds.initialize failed (rewarded ads will not load)", e)
        }

        Log.i(
            TAG,
            "AdMob in APK: gma_app_id=${getString(R.string.gma_app_id)} " +
                "REWARDED=${BuildConfig.REWARDED_AD_UNIT_ID} " +
                "(ID가 콘솔과 같은데도 'Test'면: AdMob 콘솔 '설정'의 테스트 기기에서 이 기기 제거)",
        )

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) {
                        webView.goBack()
                        return
                    }
                    if (isWebAtRootLobby()) {
                        showExitAppDialog()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            },
        )

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
            }
        }

        webView.addJavascriptInterface(PuzzloxJsBridge(this), "PuzzloxAndroid")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                // 기본: 동일 WebView(사이트 OAuth·외부 링크). 필요 시 외부만 브라우저로 열도록 분기 가능.
                return false
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                runCatching {
                    filePicker.launch("image/*")
                }.onFailure {
                    filePathCallback.onReceiveValue(null)
                    this@MainActivity.filePathCallback = null
                }
                return true
            }
        }

        webView.loadUrl(initialUrl())
    }

    private fun hideStatusBar() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars())
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
            )
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_FULLSCREEN
        }
    }

    private fun initialUrl(): String {
        val u = intent?.data
        if (u != null) {
            val h = u.host
            if (h == "puzzlox.com" || h?.endsWith(".puzzlox.com") == true) {
                return u.toString()
            }
        }
        return BASE_URL
    }

    /** Web SPA 로비: `https://puzzlox.com/` (경로 `/` 또는 비어 있음) */
    private fun isWebAtRootLobby(): Boolean {
        if (!::webView.isInitialized) return false
        val urlStr = webView.url
        if (urlStr.isNullOrBlank()) return true
        val uri = runCatching { Uri.parse(urlStr) }.getOrNull() ?: return false
        val h = uri.host?.lowercase(Locale.US) ?: return false
        if (h != "puzzlox.com" && !h.endsWith(".puzzlox.com")) {
            return false
        }
        val path = uri.path
        if (path.isNullOrEmpty() || path == "/") {
            return true
        }
        return path.trimEnd('/').isEmpty()
    }

    private fun showExitAppDialog() {
        if (isFinishing || isDestroyed) {
            return
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.exit_app_title)
            .setMessage(R.string.exit_app_message)
            .setPositiveButton(R.string.exit_app_confirm) { _, _ -> finish() }
            .setNegativeButton(R.string.exit_app_cancel, null)
            .show()
    }

    private fun fatalErrorView(message: String): View {
        val pad = (48 * resources.displayMetrics.density).toInt()
        val text = TextView(this).apply {
            text = message
            setPadding(pad, pad, pad, pad)
            textSize = 16f
        }
        return ScrollView(this).apply {
            isFillViewport = true
            addView(
                text,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                ).apply { gravity = Gravity.CENTER_VERTICAL },
            )
        }
    }

    fun beginRewardedAdFlow(requestId: String) {
        val previous = currentRewardRequestId
        if (previous != null && previous != requestId) {
            notifyJsDismissed(previous, false)
        }
        currentRewardRequestId = requestId
        userEarnedThisShow = false

        Log.d(
            TAG,
            "Rewarded load start requestId=$requestId adUnitId=${BuildConfig.REWARDED_AD_UNIT_ID}",
        )
        val adRequest = AdRequest.Builder().build()
        RewardedAd.load(
            this,
            BuildConfig.REWARDED_AD_UNIT_ID,
            adRequest,
            object : RewardedAdLoadCallback() {
                override fun onAdFailedToLoad(error: LoadAdError) {
                    Log.e(
                        TAG,
                        "Rewarded onAdFailedToLoad requestId=$requestId " +
                            "code=${error.code} domain=${error.domain} message=${error.message} " +
                            "cause=${error.cause} responseInfo=${error.responseInfo}",
                    )
                    if (currentRewardRequestId == requestId) {
                        notifyJsDismissed(requestId, false)
                    }
                }

                override fun onAdLoaded(ad: RewardedAd) {
                    if (currentRewardRequestId != requestId) {
                        return
                    }
                    Log.d(TAG, "Rewarded onAdLoaded requestId=$requestId")
                    ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                        override fun onAdDismissedFullScreenContent() {
                            ad.fullScreenContentCallback = null
                            if (currentRewardRequestId == requestId) {
                                val earned = userEarnedThisShow
                                if (!earned) {
                                    Log.w(
                                        TAG,
                                        "Rewarded dismissed without userEarned (closed early or not shown) requestId=$requestId",
                                    )
                                } else {
                                    Log.d(
                                        TAG,
                                        "Rewarded onAdDismissedFullScreenContent with reward requestId=$requestId",
                                    )
                                }
                                notifyJsDismissed(requestId, earned)
                            }
                        }

                        override fun onAdFailedToShowFullScreenContent(adError: AdError) {
                            Log.e(
                                TAG,
                                "Rewarded onAdFailedToShow requestId=$requestId " +
                                    "code=${adError.code} domain=${adError.domain} message=${adError.message} " +
                                    "cause=${adError.cause}",
                            )
                            if (currentRewardRequestId == requestId) {
                                notifyJsDismissed(requestId, false)
                            }
                        }
                    }
                    ad.show(
                        this@MainActivity,
                        OnUserEarnedRewardListener { rewardItem ->
                            userEarnedThisShow = true
                            if (currentRewardRequestId == requestId) {
                                Log.d(
                                    TAG,
                                    "Rewarded onUserEarned type=${rewardItem.type} amount=${rewardItem.amount} requestId=$requestId",
                                )
                                notifyJsEarned(requestId)
                            }
                        },
                    )
                }
            },
        )
    }

    fun toggleOrientationFromWeb() {
        val current = resources.configuration.orientation
        requestedOrientation =
            if (current == Configuration.ORIENTATION_LANDSCAPE) {
                ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            } else {
                ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            }
    }

    private fun notifyJsEarned(requestId: String) {
        val r = JSONObject.quote(requestId)
        val script =
            "if(typeof puzzloxAndroidRewardHook==='function'){puzzloxAndroidRewardHook($r,'earned');}"
        webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun notifyJsDismissed(requestId: String, userEarned: Boolean) {
        if (currentRewardRequestId == requestId) {
            currentRewardRequestId = null
        }
        val r = JSONObject.quote(requestId)
        val b = if (userEarned) "true" else "false"
        val script =
            "if(typeof puzzloxAndroidRewardHook==='function'){puzzloxAndroidRewardHook($r,'dismissed', $b);}"
        webView.post { webView.evaluateJavascript(script, null) }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.apply {
                loadUrl("about:blank")
                clearHistory()
                removeJavascriptInterface("PuzzloxAndroid")
                destroy()
            }
        }
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideStatusBar()
    }

    companion object {
        private const val BASE_URL = "https://puzzlox.com/"
        private const val TAG = "PuzzloxRewardedAd"
    }
}
