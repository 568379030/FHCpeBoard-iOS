# WebView JavaScript 接口必须保留
-keepclassmembers class com.fhcpeboard.air6local.Bridge$Core {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class com.fhcpeboard.air6local.Bridge$Board {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.fhcpeboard.air6local.Bridge$* { *; }
