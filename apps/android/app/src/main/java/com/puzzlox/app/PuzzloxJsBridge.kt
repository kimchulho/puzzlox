package com.puzzlox.app

import android.webkit.JavascriptInterface

/**
 * [Lobby] / [androidNativeRewardedAdGate] 와 쌍. 메서드명·시그니처는 웹 쪽과 맞출 것.
 */
class PuzzloxJsBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun showRewardedForRoom(_roomId: String, requestId: String) {
        activity.runOnUiThread {
            activity.beginRewardedAdFlow(requestId, BuildConfig.REWARDED_AD_UNIT_ID, "puzzloxAndroidRewardHook")
        }
    }

    @JavascriptInterface
    fun showRewardedForAssistPoints(requestId: String) {
        activity.runOnUiThread {
            activity.beginRewardedAdFlow(
                requestId,
                BuildConfig.ASSIST_REWARDED_AD_UNIT_ID,
                "puzzloxAndroidAssistRewardHook",
            )
        }
    }

    @JavascriptInterface
    fun toggleOrientation() {
        activity.runOnUiThread {
            activity.toggleOrientationFromWeb()
        }
    }
}
