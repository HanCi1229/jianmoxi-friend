package com.xingzou.literary.friend;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Rect;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.RecognitionListener;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.view.Gravity;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.JsPromptResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final String HOST = "49.234.43.25";
    private static final String HOME = "https://" + HOST + "/friend/";
    private static final int BACKGROUND = Color.rgb(35, 27, 54);
    private static final int PICK_IMAGE = 1;
    private static final int SAVE_TEXT = 2;
    private static final int RECORD = 4;
    private static final int DICTATION_PERMISSION = 5;
    private static final int CHAT_RECORD_PERMISSION = 6;
    private static final int CHAT_RECORD_LIMIT = 30_000;
    private static final int CHAT_AUDIO_LIMIT = 256 * 1024;
    private SpeechRecognizer recognizer;
    private boolean dictating;
    private String chatRecordingId;
    private boolean chatPermissionPending;
    private MediaRecorder chatRecorder;
    private File chatAudioFile;
    private final Runnable chatRecordingLimit = () -> finishChatRecording(chatRecordingId);

    private WebView web;
    private ProgressBar progress;
    private View offline;
    private boolean loadFailed;
    private Boolean keyboardVisible;
    private boolean customSelectionControls;
    private PermissionRequest microphone;
    private ValueCallback<Uri[]> imageCallback;
    private String exportText;
    private TextToSpeech speech;
    private boolean speechReady;
    private String pendingSpeech;

    private static boolean sameOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }

    private static boolean friendPage(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return sameOrigin(uri) && ("/friend/".equals(uri.getEncodedPath())
            || "/friend/index.html".equals(uri.getEncodedPath()));
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this) {
            @Override public ActionMode startActionModeForChild(View child, ActionMode.Callback callback) {
                return startActionModeForChild(child, callback, ActionMode.TYPE_PRIMARY);
            }

            @Override public ActionMode startActionModeForChild(View child, ActionMode.Callback callback, int type) {
                if (child == web && customSelectionControls) callback = customSelectionCallback(callback);
                return super.startActionModeForChild(child, callback, type);
            }
        };
        root.setBackgroundColor(BACKGROUND);
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                int edges = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout();
                int ime = WindowInsets.Type.ime();
                android.graphics.Insets bars = insets.getInsets(edges);
                int bottom = Math.max(bars.bottom, insets.getInsets(ime).bottom);
                view.setPadding(bars.left, bars.top, bars.right, bottom);
                boolean visible = insets.isVisible(ime);
                if (keyboardVisible == null || keyboardVisible != visible) {
                    keyboardVisible = visible;
                    if (web != null) web.post(this::publishKeyboardVisibility);
                }
                // The native container has already reserved these regions for the WebView.
                return new WindowInsets.Builder(insets)
                    .setInsets(edges | ime, android.graphics.Insets.NONE)
                    .build();
            });
            root.requestApplyInsets();
        } else {
            root.setFitsSystemWindows(true);
            getWindow().setStatusBarColor(BACKGROUND);
            getWindow().setNavigationBarColor(BACKGROUND);
        }

        web = new WebView(this);
        web.setBackgroundColor(BACKGROUND);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP));
        offline = createOfflineView();
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        configureWebView();
        web.loadUrl(HOME);
    }

    private View createOfflineView() {
        LinearLayout panel = new LinearLayout(this);
        panel.setBackgroundColor(BACKGROUND);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(24), dp(24), dp(24), dp(24));
        TextView message = new TextView(this);
        message.setText("暂时连不上笺墨溪 Friend\n请检查网络后重试。");
        message.setTextColor(Color.WHITE);
        message.setTextSize(17);
        message.setGravity(Gravity.CENTER);
        panel.addView(message);
        Button retry = new Button(this);
        retry.setText("重新连接");
        retry.setOnClickListener(view -> {
            panel.setVisibility(View.GONE);
            web.loadUrl(HOME);
        });
        panel.addView(retry);
        panel.setVisibility(View.GONE);
        return panel;
    }

    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setGeolocationEnabled(false);
        settings.setUserAgentString(settings.getUserAgentString() + " JianmoxiFriendAndroid/0.1.12 FriendEditorSelection/1 FriendInlineDictation/1 FriendNativeRecording/1");
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame() || friendPage(request.getUrl().toString())) return false;
                if (request.hasGesture() && "https".equals(request.getUrl().getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); }
                    catch (ActivityNotFoundException error) { message("手机上没有可打开链接的浏览器。"); }
                }
                return true;
            }

            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                clearChatRecording();
                customSelectionControls = false;
                loadFailed = false;
                progress.setVisibility(View.VISIBLE);
            }

            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                if (friendPage(url) && !loadFailed) {
                    offline.setVisibility(View.GONE);
                    publishKeyboardVisibility();
                }
                cookies.flush();
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) showOffline();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int percent) { progress.setProgress(percent); }

            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> requestMicrophone(request));
            }

            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                runOnUiThread(() -> { if (microphone == request) microphone = null; });
            }

            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!friendPage(view.getUrl())) return false;
                if (imageCallback != null) imageCallback.onReceiveValue(null);
                imageCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("image/*").putExtra(Intent.EXTRA_MIME_TYPES,
                        new String[] {"image/png", "image/jpeg", "image/webp"});
                try { startActivityForResult(picker, PICK_IMAGE); }
                catch (ActivityNotFoundException error) { finishImage(null); message("手机上没有可用的图片选择器。"); }
                return true;
            }

            @Override public boolean onJsPrompt(WebView view, String url, String command, String value, JsPromptResult result) {
                if ("friend:copy-selection".equals(command)) {
                    if (!friendPage(url) || !friendPage(view.getUrl()) || !customSelectionControls ||
                            value == null || value.isEmpty() || value.length() > 200000) {
                        result.cancel();
                        return true;
                    }
                    ClipboardManager clipboard = getSystemService(ClipboardManager.class);
                    if (clipboard == null) {
                        result.cancel();
                    } else {
                        clipboard.setPrimaryClip(ClipData.newPlainText("文稿选中文字", value));
                        result.confirm("ok");
                    }
                    return true;
                }
                if ("friend:editor-selection".equals(command)) {
                    if (!friendPage(url) || !friendPage(view.getUrl())) { result.cancel(); return true; }
                    customSelectionControls = "1".equals(value);
                    result.confirm("ok");
                    return true;
                }
                if (!Arrays.asList("friend:dictate", "friend:dictation-stop", "friend:dictation-cancel",
                        "friend:record-start", "friend:record-stop", "friend:record-cancel",
                        "friend:export", "friend:speak", "friend:stop-speaking", "friend:hide-keyboard").contains(command)) {
                    return super.onJsPrompt(view, url, command, value, result);
                }
                if (!friendPage(url) || !friendPage(view.getUrl())) { result.cancel(); return true; }
                result.confirm("");
                switch (command) {
                    case "friend:dictate": dictate(); break;
                    case "friend:dictation-stop": if (recognizer != null && dictating) recognizer.stopListening(); break;
                    case "friend:dictation-cancel": cancelDictation(); break;
                    case "friend:record-start": requestChatRecording(value); break;
                    case "friend:record-stop": finishChatRecording(value); break;
                    case "friend:record-cancel":
                        if (value != null && value.equals(chatRecordingId)) clearChatRecording();
                        break;
                    case "friend:export": export(value); break;
                    case "friend:speak": speak(value); break;
                    case "friend:hide-keyboard": dismissKeyboard(); break;
                    case "friend:stop-speaking":
                        pendingSpeech = null;
                        if (speech != null) speech.stop();
                        break;
                }
                return true;
            }
        });
    }

    private ActionMode.Callback customSelectionCallback(ActionMode.Callback delegate) {
        // Keep WebView's action mode alive so Chromium keeps the selected range and handles.
        return new ActionMode.Callback2() {
            @Override public boolean onCreateActionMode(ActionMode mode, Menu menu) {
                boolean created = delegate.onCreateActionMode(mode, menu);
                if (created) menu.clear();
                return created;
            }

            @Override public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
                delegate.onPrepareActionMode(mode, menu);
                menu.clear();
                return true;
            }

            @Override public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
                return delegate.onActionItemClicked(mode, item);
            }

            @Override public void onDestroyActionMode(ActionMode mode) {
                delegate.onDestroyActionMode(mode);
            }

            @Override public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
                if (delegate instanceof ActionMode.Callback2) {
                    ((ActionMode.Callback2) delegate).onGetContentRect(mode, view, outRect);
                } else {
                    super.onGetContentRect(mode, view, outRect);
                }
            }
        };
    }

    private void publishKeyboardVisibility() {
        if (isDestroyed() || !friendPage(web.getUrl())) return;
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('friend:keyboard', {detail:"
            + keyboardVisible + "}));", null);
    }

    private void dismissKeyboard() {
        InputMethodManager manager = getSystemService(InputMethodManager.class);
        if (manager != null) manager.hideSoftInputFromWindow(web.getWindowToken(), 0);
    }

    private void requestMicrophone(PermissionRequest request) {
        if (!friendPage(web.getUrl()) || !sameOrigin(request.getOrigin())
            || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            return;
        }
        if (microphone != null) { request.deny(); return; }
        microphone = request;
        requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, RECORD);
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == CHAT_RECORD_PERMISSION) {
            chatPermissionPending = false;
            String id = chatRecordingId;
            if (id != null && !isFinishing() && friendPage(web.getUrl())) {
                if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) startChatRecording(id);
                else failChatRecording("请在系统设置里允许 Friend 使用麦克风");
            } else clearChatRecording();
            return;
        }
        if (code == DICTATION_PERMISSION) {
            if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED && friendPage(web.getUrl())) dictate();
            else { dictationStatus("麦克风权限未开启"); sendDictation(""); }
            return;
        }
        if (code != RECORD || microphone == null) return;
        PermissionRequest request = microphone;
        microphone = null;
        if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED && friendPage(web.getUrl())) {
            request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else request.deny();
    }

    private void dictate() {
        if (dictating) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, DICTATION_PERMISSION);
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            dictationStatus("手机没有可用的语音识别服务"); sendDictation(""); return;
        }
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        dictating = true;
        recognizer.setRecognitionListener(new RecognitionListener() {
            public void onReadyForSpeech(Bundle params) { dictationStatus("正在聆听"); }
            public void onBeginningOfSpeech() {}
            public void onRmsChanged(float value) {}
            public void onBufferReceived(byte[] buffer) {}
            public void onEndOfSpeech() { dictationStatus("正在转文字"); }
            public void onError(int error) {
                if (!dictating) return;
                dictationStatus(error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "麦克风权限未开启" : "识别未完成，请重试");
                finishDictation("");
            }
            public void onResults(Bundle results) {
                if (!dictating) return;
                ArrayList<String> values = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                finishDictation(values != null && !values.isEmpty() ? values.get(0) : "");
            }
            public void onPartialResults(Bundle results) {}
            public void onEvent(int type, Bundle params) {}
        });
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try { recognizer.startListening(intent); }
        catch (RuntimeException error) { dictationStatus("无法启动语音识别"); finishDictation(""); }
    }
    private void dictationStatus(String text) {
        if (friendPage(web.getUrl())) web.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('friend:dictation-status',{detail:" + JSONObject.quote(text) + "}));", null);
    }
    private void finishDictation(String text) {
        dictating = false;
        if (recognizer != null) { recognizer.destroy(); recognizer = null; }
        sendDictation(text);
    }
    private void cancelDictation() {
        dictating = false;
        if (recognizer != null) { recognizer.cancel(); recognizer.destroy(); recognizer = null; }
        sendDictation("");
    }

    private void requestChatRecording(String id) {
        if (id == null || !id.matches("[0-9]{1,10}")) return;
        if (chatRecordingId != null || chatPermissionPending || dictating || microphone != null) {
            chatRecordingEvent(id, "error", "麦克风仍在使用，请稍后重试");
            return;
        }
        chatRecordingId = id;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startChatRecording(id);
        } else {
            chatPermissionPending = true;
            requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, CHAT_RECORD_PERMISSION);
        }
    }

    private void startChatRecording(String id) {
        try {
            chatAudioFile = File.createTempFile("friend-chat-", ".m4a", getCacheDir());
            chatRecorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            chatRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            chatRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            chatRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            chatRecorder.setAudioChannels(1);
            chatRecorder.setAudioEncodingBitRate(48_000);
            chatRecorder.setOutputFile(chatAudioFile.getAbsolutePath());
            chatRecorder.setOnErrorListener((recorder, what, extra) -> {
                if (recorder == chatRecorder) failChatRecording("录音中断，请重新录制");
            });
            chatRecorder.prepare();
            chatRecorder.start();
            web.postDelayed(chatRecordingLimit, CHAT_RECORD_LIMIT);
            chatRecordingEvent(id, "started", "");
        } catch (IOException | RuntimeException error) {
            android.util.Log.w("FriendRecording", "Could not start microphone", error);
            failChatRecording("无法开启麦克风，请检查系统的麦克风访问开关和应用权限");
        }
    }

    private void finishChatRecording(String id) {
        if (id == null || !id.equals(chatRecordingId) || chatRecorder == null) return;
        try {
            try { chatRecorder.stop(); }
            finally { releaseChatRecorder(); }
            long size = chatAudioFile.length();
            if (size <= 0 || size > CHAT_AUDIO_LIMIT) throw new IOException("Invalid recording length");
            byte[] audio = Files.readAllBytes(chatAudioFile.toPath());
            chatRecordingEvent(id, "audio", Base64.encodeToString(audio, Base64.NO_WRAP));
        } catch (IOException | RuntimeException error) {
            chatRecordingEvent(id, "error", "没有录到可用声音，请重新录制");
        } finally {
            clearChatRecording();
        }
    }

    private void releaseChatRecorder() {
        if (chatRecorder == null) return;
        MediaRecorder recorder = chatRecorder;
        chatRecorder = null;
        recorder.release();
    }

    private void clearChatRecording() {
        chatRecordingId = null;
        web.removeCallbacks(chatRecordingLimit);
        releaseChatRecorder();
        if (chatAudioFile != null) {
            chatAudioFile.delete();
            chatAudioFile = null;
        }
    }

    private void failChatRecording(String message) {
        String id = chatRecordingId;
        clearChatRecording();
        if (id != null) chatRecordingEvent(id, "error", message);
    }

    private void chatRecordingEvent(String id, String state, String data) {
        if (friendPage(web.getUrl())) web.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('friend:recording',{detail:{id:" + JSONObject.quote(id)
                + ",state:" + JSONObject.quote(state) + ",data:" + JSONObject.quote(data) + "}}));", null);
    }

    @Override protected void onPause() {
        if (dictating) cancelDictation();
        if (chatRecorder != null) failChatRecording("录音已中断，请重新录制");
        super.onPause();
    }

    @Override protected void onStop() {
        if (chatRecordingId != null) failChatRecording("录音已中断，请重新录制");
        super.onStop();
    }

    private void sendDictation(String text) {
        if (friendPage(web.getUrl())) web.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('friend:dictation', {detail:" + JSONObject.quote(text) + "}));", null);
    }

    private void speak(String text) {
        if (text == null || text.isEmpty()) return;
        pendingSpeech = text.substring(0, Math.min(text.length(), TextToSpeech.getMaxSpeechInputLength()));
        if (speech == null) {
            speech = new TextToSpeech(this, status -> runOnUiThread(() -> {
                if (speech == null || isDestroyed()) return;
                speechReady = status == TextToSpeech.SUCCESS && speech.setLanguage(Locale.SIMPLIFIED_CHINESE) >= 0;
                if (!speechReady && pendingSpeech != null) message("手机缺少可用的中文朗读语音。");
                playSpeech();
            }));
        } else playSpeech();
    }

    private void playSpeech() {
        if (speechReady && pendingSpeech != null) {
            speech.speak(pendingSpeech, TextToSpeech.QUEUE_FLUSH, null, "friend-reply");
            pendingSpeech = null;
        }
    }

    private void export(String value) {
        if (exportText != null || value == null || value.length() > 800000) return;
        try {
            JSONObject data = new JSONObject(value);
            String name = data.getString("name").replaceAll("[\\p{Cntrl}/\\\\:*?\"<>|]", "_");
            if (name.length() > 90) name = name.substring(0, 86) + ".txt";
            exportText = data.getString("text");
            Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("text/plain").putExtra(Intent.EXTRA_TITLE, name);
            startActivityForResult(picker, SAVE_TEXT);
        } catch (JSONException | ActivityNotFoundException error) {
            exportText = null;
            message("无法打开文件保存窗口。");
        }
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        if (code == PICK_IMAGE) finishImage(uri);
        if (code == SAVE_TEXT) finishExport(uri);
    }

    private void finishImage(Uri uri) {
        if (imageCallback == null) return;
        imageCallback.onReceiveValue(uri == null ? null : new Uri[] {uri});
        imageCallback = null;
    }

    private void finishExport(Uri uri) {
        String text = exportText;
        exportText = null;
        if (uri == null || text == null) return;
        try (OutputStream stream = getContentResolver().openOutputStream(uri)) {
            if (stream == null) throw new IOException("Missing output stream");
            stream.write(text.getBytes(StandardCharsets.UTF_8));
            message("已导出 TXT。");
        } catch (IOException | SecurityException error) { message("保存失败，请重试。"); }
    }

    @Override public void onBackPressed() {
        if (Boolean.TRUE.equals(keyboardVisible)) {
            dismissKeyboard();
            return;
        }
        if (!friendPage(web.getUrl()) || offline.getVisibility() == View.VISIBLE) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("Boolean(window.friendBack?.())", handled -> {
            if (!"true".equals(handled) && !isFinishing()) super.onBackPressed();
        });
    }

    @Override protected void onDestroy() {
        clearChatRecording();
        if (recognizer != null) recognizer.destroy();
        if (microphone != null) microphone.deny();
        finishImage(null);
        if (speech != null) speech.shutdown();
        CookieManager.getInstance().flush();
        ((android.view.ViewGroup) web.getParent()).removeView(web);
        web.destroy();
        super.onDestroy();
    }

    private int dp(int amount) { return Math.round(amount * getResources().getDisplayMetrics().density); }
    private void message(String text) { Toast.makeText(this, text, Toast.LENGTH_SHORT).show(); }
    private void showOffline() {
        loadFailed = true;
        progress.setVisibility(View.GONE);
        offline.setVisibility(View.VISIBLE);
    }
}
