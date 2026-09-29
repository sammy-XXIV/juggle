package com.radiants.juggle;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SolanaMwaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
