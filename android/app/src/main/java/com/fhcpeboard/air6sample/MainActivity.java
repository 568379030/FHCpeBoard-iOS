package com.fhcpeboard.air6sample;

import android.app.*;
import android.os.*;
import android.content.*;
import android.graphics.Bitmap;
import android.util.Log;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {
 private WebView runtime,page;
 private TextView diagnostic;
 private FrameLayout layout;
 private String loadId;
 private boolean rendered;
 private boolean destroyed;
 private final Handler startupHandler=new Handler(Looper.getMainLooper());
 private final ExecutorService requests=Executors.newFixedThreadPool(4);
 private android.content.SharedPreferences prefs;
 private final java.net.CookieManager cookies=new java.net.CookieManager(null,CookiePolicy.ACCEPT_ALL);
 private byte[] readBytes(InputStream in) throws IOException {ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){out.write(buffer,0,n);if(out.size()>16*1024*1024)throw new IOException("Response too large");}return out.toByteArray();}
 private String q(String s){return JSONObject.quote(s==null?"":s);}
 private String asset(String name){
  if(!name.matches("[A-Za-z0-9_.-]+"))return "";
  try(InputStream in=getAssets().open(name)){return new String(readBytes(in),StandardCharsets.UTF_8);}catch(Exception e){Log.e("Air6","Missing asset "+name,e);return "";}
 }
 private void rt(String js){runOnUiThread(()->runtime.evaluateJavascript(js,null));}
 private void status(String s){Log.i("Air6",s);runOnUiThread(()->diagnostic.setText(s));}
 private WebView view(String name){
  WebView v=new WebView(this);v.getSettings().setJavaScriptEnabled(true);v.getSettings().setDomStorageEnabled(true);
  v.getSettings().setAllowFileAccess(false);v.getSettings().setAllowContentAccess(false);
  v.setWebChromeClient(new WebChromeClient(){
   public boolean onConsoleMessage(ConsoleMessage m){Log.i("Air6JS",name+":"+m.lineNumber()+" "+m.message());return true;}
   public boolean onJsConfirm(WebView w,String u,String message,JsResult result){new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定",(d,n)->result.confirm()).setNegativeButton("取消",(d,n)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;}
  });
  return v;
 }
 @Override public void onCreate(Bundle saved){
  super.onCreate(saved);prefs=getSharedPreferences("air6",MODE_PRIVATE);WebView.setWebContentsDebuggingEnabled(true);
  layout=new FrameLayout(this);setContentView(layout);diagnostic=new TextView(this);diagnostic.setText("正在启动 AIR6…");
  runtime=view("runtime");page=view("page");runtime.addJavascriptInterface(new Core(),"AndroidCore");page.addJavascriptInterface(new Board(),"AndroidBoard");
  runtime.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
  runtime.setFocusable(false);runtime.setFocusableInTouchMode(false);
  layout.addView(runtime,new FrameLayout.LayoutParams(1,1));layout.addView(page,new FrameLayout.LayoutParams(-1,-1));layout.addView(diagnostic,new FrameLayout.LayoutParams(-1,-2));
  page.setWebViewClient(new WebViewClient(){@Override public void onPageFinished(WebView v,String url){
   rendered=true;diagnostic.setVisibility(View.GONE);page.requestFocus();status("PAGE_READY");
   if(loadId!=null){rt("window.__nativeDone("+q(new JSONObject(Map.of("id",loadId,"result","true")).toString())+")");loadId=null;}
  }});
  runtime.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest req){
    if("https://app.local".equals(req.getUrl().getScheme()+"://"+req.getUrl().getHost())){
     String n=req.getUrl().getLastPathSegment();String mime=n.endsWith(".js")?"application/javascript":"text/html";
     return new WebResourceResponse(mime,"UTF-8",new ByteArrayInputStream(asset(n).getBytes(StandardCharsets.UTF_8)));
    }return null;
   }
  });
  runtime.loadDataWithBaseURL("https://app.local/",asset("core.html"),"text/html","UTF-8",null);
  startupHandler.postDelayed(()->{if(!destroyed&&!rendered)status("启动失败：请导出 Air6JS 日志，页面尚未生成");},15000);
 }
 public class Core {
  @JavascriptInterface public String assetRead(String n){return asset(n);}
  @JavascriptInterface public String kcGet(String k){return prefs.getString(k,"");}
  @JavascriptInterface public void kcSet(String k,String v){prefs.edit().putString(k,v).apply();}
  @JavascriptInterface public void kcRemove(String k){prefs.edit().remove(k).apply();}
  @JavascriptInterface public String nativePing(){return "{\"ver\":\"1.4.3-local-54-android\",\"nativeCore\":false}";}
  @JavascriptInterface public void log(String s){status(s);}
  @JavascriptInterface public int clearCaches(){runOnUiThread(()->{runtime.clearCache(true);page.clearCache(true);});return 0;}
  @JavascriptInterface public void clearHttpSession(String host){cookies.getCookieStore().removeAll();}
  @JavascriptInterface public String fileRead(String path){return "";}
  @JavascriptInterface public void fileRemove(String path){}
  @JavascriptInterface public String decodeSmsPdu(String pdu){return "null";}
  @JavascriptInterface public void loadHTML(String id,String html){runOnUiThread(()->{loadId=id;page.loadDataWithBaseURL("https://app.local/",html,"text/html","UTF-8",null);});}
  @JavascriptInterface public void evalJS(String id,String code){runOnUiThread(()->page.evaluateJavascript(code,result->{
   try{rt("window.__nativeDone("+q(new JSONObject(Map.of("id",id,"result",result==null?"null":result)).toString())+")");}catch(Exception e){status(e.toString());}
  }));}
  @JavascriptInterface public void fetch(String id,String address,String options){requests.execute(()->{
   int code=0;String body="NETWORK_FAILED";HttpURLConnection c=null;
   try{
    URI uri=new URI(address);if(!Set.of("http","https").contains(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)throw new IOException("DEVICE_ADDRESS_REJECTED");
    JSONObject opt=new JSONObject(options);c=(HttpURLConnection)uri.toURL().openConnection();int timeout=Math.max(3000,Math.min(180000,opt.optInt("timeoutMs",30000)));c.setConnectTimeout(timeout);c.setReadTimeout(timeout);c.setInstanceFollowRedirects(false);
    c.setRequestMethod(opt.optString("method","GET"));JSONObject h=opt.optJSONObject("headers");if(h!=null){Iterator<String> keys=h.keys();while(keys.hasNext()){String k=keys.next();c.setRequestProperty(k,h.getString(k));}}
    synchronized(cookies){for(Map.Entry<String,List<String>> e:cookies.get(uri,Map.of()).entrySet())c.setRequestProperty(e.getKey(),String.join("; ",e.getValue()));}
    if(opt.has("body")){c.setDoOutput(true);try(OutputStream o=c.getOutputStream()){o.write(opt.getString("body").getBytes(StandardCharsets.UTF_8));}}
    code=c.getResponseCode();synchronized(cookies){cookies.put(uri,c.getHeaderFields());}
    InputStream in=code>=400?c.getErrorStream():c.getInputStream();try(InputStream stream=in){body=stream==null?"":new String(readBytes(stream),StandardCharsets.UTF_8);}
   }catch(Exception e){body=e instanceof javax.net.ssl.SSLException?"TLS_CERT_FAILED":e instanceof UnknownHostException?"DNS_FAILED":e.getMessage();Log.e("Air6HTTP","request failed",e);}finally{if(c!=null)c.disconnect();}
   rt("window.__fetchText("+q(id)+","+code+","+q(body)+")");
  });}
 }
 public class Board {
  @JavascriptInterface public String uiFlavor(){return "coui";}
  @JavascriptInterface public void postMessage(String json){rt("window.__onPageMessage("+q(json)+")");}
  @JavascriptInterface public String wifiCacheGet(String scope){return prefs.getString("wifi:"+scope,"null");}
  @JavascriptInterface public void wifiCacheSet(String scope,String json){prefs.edit().putString("wifi:"+scope,json).apply();}
 }
 @Override protected void onResume(){super.onResume();if(runtime!=null)rt("window.__lanActive&&window.__lanActive(true)");}
 @Override protected void onPause(){if(runtime!=null)rt("window.__lanActive&&window.__lanActive(false)");super.onPause();}
 @Override protected void onDestroy(){destroyed=true;startupHandler.removeCallbacksAndMessages(null);requests.shutdownNow();if(runtime!=null)runtime.destroy();if(page!=null)page.destroy();super.onDestroy();}
}
