/*
 * Safety net, loaded before everything else.
 * If anything in the launcher fails (a script error, or it never finishes
 * starting), show the error and open LG's own home instead, so the TV is
 * never stuck on a broken screen. LG's home is opened by this app, so the
 * startup watcher leaves it on screen (same as the "LG Home" button).
 */
(function () {
  "use strict";
  var failed = false;

  function describe(err) {
    if (!err) return "unknown error";
    if (typeof err === "string") return err;
    return err.message || String(err);
  }

  function showError(text) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = text;
    t.classList.add("error");
    t.classList.add("show");
  }

  function openLgHome() {
    try {
      var b = new window.PalmServiceBridge();
      window.__lgHomeBridge = b; /* keep a reference until it answers */
      b.onservicecallback = function () { window.__lgHomeBridge = null; };
      b.call("luna://com.webos.applicationManager/launch", JSON.stringify({ id: "com.webos.app.home" }));
    } catch (e) { /* not on a TV (preview) */ }
  }

  window.launcherFatal = function (err) {
    if (failed) return;
    failed = true;
    var msg = describe(err);
    try { console.error("[OpenTV Launcher] " + msg, err); } catch (e) {}
    showError("Launcher error: " + msg + ". Opening LG Home…");
    setTimeout(openLgHome, 2500);
  };

  window.addEventListener("error", function (e) {
    window.launcherFatal(e.error || e.message);
  });
  window.addEventListener("unhandledrejection", function (e) {
    window.launcherFatal(e.reason);
  });

  /* launcher.js sets __launcherReady when it has started */
  window.addEventListener("load", function () {
    setTimeout(function () {
      if (!window.__launcherReady) window.launcherFatal("the launcher didn't start");
    }, 4000);
  });

  /* Opened again (Home button) after a failure: start fresh */
  document.addEventListener("webOSRelaunch", function () {
    if (failed) window.location.reload();
  });
})();
