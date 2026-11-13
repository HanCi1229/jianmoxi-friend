package com.xingzou.literary.cloud;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.Manifest;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Small, signed cloud client. Credentials and article data remain behind the server login. */
public final class MainActivity extends Activity {
    static final String ORIGIN = "https://49.234.43.25";
    private static final int PICK_IMPORT = 101, SAVE_EXPORT = 102;
    private WebView web;
    private LinearLayout error;
    private TextView errorText;
    private ProgressBar progress;
    private ValueCallback<Uri[]> fileCallback;
    private File pendingExport;
    private boolean pageFailed, exporting;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;
    private static final int LOCATION_PERMISSION = 103;

    static boolean trusted(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return "https".equals(uri.getScheme()) && "49.234.43.25".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(248,247,243));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                int bottom = Math.max(bars.bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
                v.setPadding(bars.left, bars.top, bars.right, bottom);
                return insets;
            });
        } else root.setFitsSystemWindows(true);
        web = new ReadingWebView(this);
        web.setBackgroundColor(Color.rgb(248,247,243));
        root.addView(web, new FrameLayout.LayoutParams(-1,-1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP));
        error = new LinearLayout(this);
        error.setOrientation(LinearLayout.VERTICAL);
        error.setGravity(Gravity.CENTER);
        error.setPadding(dp(30),dp(30),dp(30),dp(30));
        error.setBackgroundColor(Color.rgb(248,247,243));
        errorText = new TextView(this);
        errorText.setTextSize(18); errorText.setGravity(Gravity.CENTER);
        errorText.setTextColor(Color.rgb(51,60,47));
        error.addView(errorText);
        Button retry = new Button(this); retry.setText("重新连接");
        retry.setOnClickListener(v -> { error.setVisibility(View.GONE); web.loadUrl(ORIGIN + "/"); });
        error.addView(retry); error.setVisibility(View.GONE);
        root.addView(error,new FrameLayout.LayoutParams(-1,-1));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // User-picked content URIs are needed for JSON backup imports; top-level content: navigation stays blocked.
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setGeolocationEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " XingzouAndroid/0.1.3");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        WebView.setWebContentsDebuggingEnabled(false);
        // The only native bridge can propose a text export; Android's file picker asks where to save it.
        web.addJavascriptInterface(new ExportBridge(), "XingzouExport");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (trusted(url)) return false;
                if (request.isForMainFrame() && request.hasGesture()) openExternal(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                ((ReadingWebView) view).resetSelectionUi();
                pageFailed = false; progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                if (!trusted(url) || pageFailed) return;
                error.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
                // WebView does not natively download blob URLs. Preserve filename and UTF-8 text.
                view.evaluateJavascript("(()=>{if(window.__xingzouDownloads)return;window.__xingzouDownloads=true;"
                    + "const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){"
                    + "if(this.download&&this.href.startsWith('blob:')){const name=this.download;fetch(this.href)"
                    + ".then(r=>r.text()).then(t=>XingzouExport.saveText(name,t)).catch(()=>alert('导出失败，请重试'));return;}"
                    + "return original.apply(this,arguments);};})()", null);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError err) {
                if (request.isForMainFrame()) showError("暂时连不上笺墨溪\n请检查网络后重试。");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400)
                    showError("云端暂时未能响应\n请稍后重试。");
            }
            // Keep Android's default SSL-error cancellation. Never bypass certificate validation.
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!trusted(origin) || !trusted(web.getUrl())) { callback.invoke(origin,false,false); return; }
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin,true,false); return;
                }
                cancelLocationRequest();
                locationOrigin=origin;locationCallback=callback;
                requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.ACCESS_FINE_LOCATION},LOCATION_PERMISSION);
            }
            @Override public void onGeolocationPermissionsHidePrompt() { cancelLocationRequest(); }
            @Override public void onProgressChanged(WebView view,int value) { progress.setProgress(value); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json","text/plain","application/octet-stream"});
                try { startActivityForResult(intent,PICK_IMPORT); }
                catch (Exception e) { fileCallback.onReceiveValue(null); fileCallback=null; toast("无法打开文件选择器"); }
                return true;
            }
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("笺墨溪").setMessage(message)
                    .setPositiveButton("知道了",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();
                return true;
            }
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("笺墨溪").setMessage(message)
                    .setPositiveButton("确定",(d,w)->result.confirm()).setNegativeButton("取消",(d,w)->result.cancel())
                    .setOnCancelListener(d->result.cancel()).show(); return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            if (url.startsWith("https://")) openExternal(Uri.parse(url));
            else toast("请使用页面中的导出按钮保存文件");
        });
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0,this::goBack);
        if (saved != null && saved.getString("pendingExport") != null) {
            pendingExport = new File(getCacheDir(),"export.txt"); exporting = pendingExport.exists();
        }
        // Reload from cloud; any interrupted edits are recovered by cloud-boot's pending backup flow.
        web.loadUrl(ORIGIN + "/");
    }

    private void cancelLocationRequest() {
        if (locationCallback!=null) { locationCallback.invoke(locationOrigin,false,false); locationCallback=null; locationOrigin=null; }
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(request,permissions,results);
        if(request==LOCATION_PERMISSION && locationCallback!=null) {
            GeolocationPermissions.Callback callback=locationCallback;String origin=locationOrigin;
            locationCallback=null;locationOrigin=null;
            boolean allowed=trusted(origin) && trusted(web.getUrl()) && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
            callback.invoke(origin,allowed,false);
        }
    }
    private final class ExportBridge {
        @JavascriptInterface public void saveText(String name, String text) {
            if (name == null || text == null || text.length() > 8*1024*1024) return;
            runOnUiThread(() -> {
                if (!trusted(web.getUrl()) || exporting) return;
                byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 8*1024*1024) { toast("文件过大，请分篇导出"); return; }
                pendingExport = new File(getCacheDir(),"export.txt");
                try (FileOutputStream stream = new FileOutputStream(pendingExport)) {
                    stream.write(bytes);
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(name.endsWith(".json") ? "application/json" : "text/plain");
                    intent.putExtra(Intent.EXTRA_TITLE, name.replaceAll("[\\\\/\\r\\n]","_").substring(0,Math.min(name.length(),120)));
                    exporting = true; startActivityForResult(intent,SAVE_EXPORT);
                } catch (Exception e) { exporting=false; toast("无法导出，请重试"); }
            });
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request,result,data);
        if (request == PICK_IMPORT && fileCallback != null) {
            fileCallback.onReceiveValue(result==RESULT_OK && data!=null && data.getData()!=null ? new Uri[]{data.getData()} : null);
            fileCallback=null;
        }
        if (request == SAVE_EXPORT) {
            if (result==RESULT_OK && data!=null && data.getData()!=null && pendingExport!=null) {
                try (InputStream in=new FileInputStream(pendingExport); OutputStream out=getContentResolver().openOutputStream(data.getData())) {
                    if (out==null) throw new IOException("No destination");
                    byte[] buffer=new byte[8192]; int count; while((count=in.read(buffer))!=-1) out.write(buffer,0,count);
                    toast("已保存到所选位置");
                } catch (Exception e) { toast("保存失败，请重新导出"); }
            }
            if (pendingExport!=null) pendingExport.delete(); pendingExport=null; exporting=false;
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (exporting) state.putString("pendingExport","export.txt");
    }
    private void showError(String message) { pageFailed=true; progress.setVisibility(View.GONE); errorText.setText(message); error.setVisibility(View.VISIBLE); }
    private int dp(int n) { return Math.round(n*getResources().getDisplayMetrics().density); }
    private void toast(String text) { Toast.makeText(this,text,Toast.LENGTH_LONG).show(); }
    private void openExternal(Uri uri) {
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); } catch (Exception e) { toast("未找到可打开链接的浏览器"); }
    }
    private void goBack() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }
    @Override public void onBackPressed() { goBack(); }
    @Override protected void onPause() {
        if (web!=null) {
            web.evaluateJavascript("window.xingzouCloud&&window.xingzouCloud.flush()",null);
            CookieManager.getInstance().flush();
        }
        super.onPause();
    }
    @Override protected void onDestroy() {
        cancelLocationRequest();
        if (fileCallback!=null) fileCallback.onReceiveValue(null);
        if (web!=null) { web.removeJavascriptInterface("XingzouExport"); web.removeJavascriptInterface("XingzouReader"); web.destroy(); }
        super.onDestroy();
    }
}
