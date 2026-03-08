package app.agentrune.dev;

import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            String dir = keyCode == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down";
            // Dispatch custom event to WebView JS
            getBridge().getWebView().post(() -> {
                getBridge().getWebView().evaluateJavascript(
                    "document.dispatchEvent(new CustomEvent('volume-key', { detail: '" + dir + "' }))",
                    null
                );
            });
            return true; // consume the event (don't change volume)
        }
        return super.onKeyDown(keyCode, event);
    }
}
