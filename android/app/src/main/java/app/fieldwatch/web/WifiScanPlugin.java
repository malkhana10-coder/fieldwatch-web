package app.fieldwatch.web;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.List;

/**
 * Passive Wi-Fi access-point scan for the web UI. Android only exposes access points
 * (not clients) and throttles startScan to a few calls per two minutes; cached
 * results from the system's own scans still come back through getResults.
 */
@CapacitorPlugin(
    name = "WifiScan",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class WifiScanPlugin extends Plugin {

    private WifiManager wifi() {
        return (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "scanPermsCallback");
            return;
        }
        doScan(call);
    }

    @PermissionCallback
    private void scanPermsCallback(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            doScan(call);
        } else {
            call.reject("Location permission is needed for Wi-Fi scan results");
        }
    }

    @SuppressWarnings("deprecation")
    private void doScan(PluginCall call) {
        JSObject r = new JSObject();
        r.put("started", wifi().startScan());
        call.resolve(r);
    }

    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    @PluginMethod
    public void getResults(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission not granted");
            return;
        }
        List<ScanResult> list = wifi().getScanResults();
        JSArray arr = new JSArray();
        if (list != null) {
            for (ScanResult s : list) {
                JSObject o = new JSObject();
                o.put("bssid", s.BSSID);
                o.put("ssid", s.SSID == null ? "" : s.SSID);
                o.put("level", s.level);
                o.put("frequency", s.frequency);
                o.put("capabilities", s.capabilities == null ? "" : s.capabilities);
                arr.put(o);
            }
        }
        JSObject r = new JSObject();
        r.put("results", arr);
        call.resolve(r);
    }
}
