package com.puzzlox.app

import android.net.Uri
import android.content.res.Configuration
import android.content.pm.ActivityInfo
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
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

        MobileAds.initialize(this) { }

        webView = WebView(this).apply {
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        setContentView(webView)

        onBackPressedDispatcher.addCallback(this) {
            if (webView.canGoBack()) {
                webView.goBack()
            } else {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        }

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

    fun beginRewardedAdFlow(requestId: String) {
        val previous = currentRewardRequestId
        if (previous != null && previous != requestId) {
            notifyJsDismissed(previous, false)
        }
        currentRewardRequestId = requestId
        userEarnedThisShow = false

        val adRequest = AdRequest.Builder().build()
        RewardedAd.load(
            this,
            BuildConfig.REWARDED_AD_UNIT_ID,
            adRequest,
            object : RewardedAdLoadCallback() {
                override fun onAdFailedToLoad(error: LoadAdError) {
                    if (currentRewardRequestId == requestId) {
                        notifyJsDismissed(requestId, false)
                    }
                }

                override fun onAdLoaded(ad: RewardedAd) {
                    if (currentRewardRequestId != requestId) {
                        return
                    }
                    ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                        override fun onAdDismissedFullScreenContent() {
                            ad.fullScreenContentCallback = null
                            if (currentRewardRequestId == requestId) {
                                val earned = userEarnedThisShow
                                notifyJsDismissed(requestId, earned)
                            }
                        }

                        override fun onAdFailedToShowFullScreenContent(adError: AdError) {
                            if (currentRewardRequestId == requestId) {
                                notifyJsDismissed(requestId, false)
                            }
                        }
                    }
                    ad.show(
                        this@MainActivity,
                        OnUserEarnedRewardListener {
                            userEarnedThisShow = true
                            if (currentRewardRequestId == requestId) {
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

    companion object {
        private const val BASE_URL = "https://puzzlox.com/"
    }
}
