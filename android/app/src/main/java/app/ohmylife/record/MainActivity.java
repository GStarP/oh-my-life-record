package app.ohmylife.record;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(LocalDataPlugin.class);
        super.onCreate(state);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                getBridge().getWebView().evaluateJavascript("!document.dispatchEvent(new Event('android-back', {cancelable:true}))", handled -> {
                    if (!"true".equals(handled)) moveTaskToBack(true);
                });
            }
        });
    }
}
