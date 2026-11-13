package com.xingzou.literary.cloud;

import android.content.Context;
import android.graphics.Rect;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

/** Keep Chromium's native selection/handles; let the reading page own its actions. */
public final class ReadingWebView extends WebView {
    private boolean readerReady, textTarget;

    public ReadingWebView(Context context) {
        super(context);
        addJavascriptInterface(new SelectionBridge(), "XingzouReader");
    }

    public void resetSelectionUi() { readerReady = false; textTarget = false; }

    private boolean useReadingActions() {
        HitTestResult hit = getHitTestResult();
        return readerReady && textTarget && MainActivity.trusted(getUrl())
            && (hit == null || hit.getType() != HitTestResult.EDIT_TEXT_TYPE);
    }

    private ActionMode.Callback wrap(ActionMode.Callback callback) {
        if (callback instanceof ReadingSelectionCallback || !useReadingActions()) return callback;
        return new ReadingSelectionCallback(callback);
    }

    @Override public ActionMode startActionMode(ActionMode.Callback callback) {
        return super.startActionMode(wrap(callback));
    }

    @Override public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        return super.startActionMode(wrap(callback), type);
    }

    private final class SelectionBridge {
        // No text, files, clipboard or credentials are exposed through this bridge.
        @JavascriptInterface public void setReady(boolean ready) {
            post(() -> { if (MainActivity.trusted(getUrl())) readerReady = ready; });
        }
        @JavascriptInterface public void setTextTarget(boolean target) {
            post(() -> { if (MainActivity.trusted(getUrl())) textTarget = target; });
        }
    }

    private static final class ReadingSelectionCallback extends ActionMode.Callback2 {
        private final ActionMode.Callback delegate;
        ReadingSelectionCallback(ActionMode.Callback delegate) { this.delegate = delegate; }

        @Override public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            // Returning null/false or consuming long-click would lose the selection handles.
            boolean created = delegate.onCreateActionMode(mode, menu);
            menu.clear();
            return created;
        }
        @Override public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            delegate.onPrepareActionMode(mode, menu);
            // Clear every action, including OEM/text-classifier and third-party actions.
            menu.clear();
            return true;
        }
        @Override public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            return false;
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
    }
}
