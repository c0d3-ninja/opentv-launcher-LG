// OpenTV Launcher root service. Runs as root once elevated with the
// Homebrew Channel's elevate-service (done by the startup watcher).
// Only specific actions are offered: no generic command execution, so
// other apps on the TV cannot use this service to get root.
var Service = require("webos-service");
var APP_DIR = "/media/developer/apps/usr/palm/applications/com.opentvlauncher.lg";

var service = new Service("com.opentvlauncher.lg.service");

// Never let one bad request take the whole service down
process.on("uncaughtException", function (e) {
  try { console.error("opentvlauncher service error: " + (e && e.stack || e)); } catch (x) {}
});

function isRoot() {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

// { root: true|false }
service.register("status", function (msg) {
  msg.respond({ returnValue: true, root: isRoot() });
});

// Copies icons for any newly installed apps and returns the app list:
// { apps: [{ id, title, color, icon }] }
service.register("apps", function (msg) {
  if (!isRoot()) {
    msg.respond({ returnValue: false, errorText: "service is not running as root" });
    return;
  }
  var mod;
  try { mod = syncModule(); }
  catch (e) { msg.respond({ returnValue: false, errorText: String(e && e.message || e) }); return; }
  // Several page refreshes at once share one sync
  pendingApps.push(msg);
  if (pendingApps.length > 1) return;
  mod.sync(function (err, apps, recent) {
    var waiting = pendingApps;
    pendingApps = [];
    waiting.forEach(function (m) {
      try {
        if (err) m.respond({ returnValue: false, errorText: String(err.message || err) });
        else m.respond({ returnValue: true, apps: apps, recent: recent });
      } catch (e) {}
    });
  });
});
var pendingApps = [];

// Load sync-icons.js fresh (the app folder can be replaced by a reinstall)
function syncModule() {
  delete require.cache[require.resolve(APP_DIR + "/sync-icons.js")];
  return require(APP_DIR + "/sync-icons.js");
}

// Recently used apps, newest first: { recent: ["netflix", ...] }
// Read-only, so it also works before the service has root.
service.register("recent", function (msg) {
  try {
    syncModule().readRecent(function (recent) {
      msg.respond({ returnValue: true, recent: recent });
    });
  } catch (e) {
    msg.respond({ returnValue: false, errorText: String(e && e.message || e) });
  }
});

// LG's "Recent Lists" data (the list LG's home shows when Back is pressed
// twice), with each card's snapshot copied into the app folder so the
// launcher page can show it: { recents: [{ id, title, image }] }
var RECENT_IMG_DIR = APP_DIR + "/recents";
service.register("recents", function (msg) {
  var fs = require("fs");
  var path = require("path");
  require("child_process").exec(
    "luna-send -n 1 -w 5000 luna://com.webos.service.recent/listRecents '{}'",
    { timeout: 8000 },
    function (err, out) {
      var list;
      try { list = JSON.parse(out).recentsAppList || []; }
      catch (e) { msg.respond({ returnValue: false, errorText: "could not read recents" }); return; }
      try { if (!fs.existsSync(RECENT_IMG_DIR)) fs.mkdirSync(RECENT_IMG_DIR); } catch (e) {}
      var res = [];
      list.forEach(function (r) {
        if (!r.appId || r.appId === "com.opentvlauncher.lg") return;
        var src = r.cardSnapShotFilePath || r.customImageFilePath || "";
        var image = "";
        if (src && src.charAt(0) === "/") {
          try {
            var st = fs.statSync(src);
            var dest = path.join(RECENT_IMG_DIR, r.appId + path.extname(src));
            var d = fs.existsSync(dest) ? fs.statSync(dest) : null;
            if (!d || d.size !== st.size || d.mtimeMs < st.mtimeMs) fs.copyFileSync(src, dest);
            image = "recents/" + path.basename(dest) + "?t=" + Math.floor(st.mtimeMs);
          } catch (e) {}
        }
        res.push({ id: r.appId, title: r.title || r.appId, image: image });
      });
      msg.respond({ returnValue: true, recents: res });
    });
});

// Remove one card from Recent Lists and close that app, like LG's X: { id }
// With { all: true } does the same for every card (LG's "Close All").
service.register("recentsClose", function (msg) {
  var cp = require("child_process");
  var p = msg.payload || {};
  function ls(uri, payload, cb) {
    cp.execFile("luna-send", ["-n", "1", "-w", "4000", uri, JSON.stringify(payload)],
      { timeout: 6000 }, function (err, out) { cb(String(out || "")); });
  }
  function closeOne(id, cb) {
    ls("luna://com.webos.applicationManager/closeByAppId", { id: id }, function () {
      ls("luna://com.webos.service.recent/removeRecent", { appId: id }, function () { cb(); });
    });
  }
  if (p.all) {
    ls("luna://com.webos.service.recent/listRecents", {}, function (out) {
      var ids = [];
      try { ids = (JSON.parse(out).recentsAppList || []).map(function (r) { return r.appId; }); } catch (e) {}
      ids = ids.filter(function (id) { return id && id !== "com.opentvlauncher.lg"; });
      (function next() {
        if (!ids.length) { msg.respond({ returnValue: true }); return; }
        closeOne(ids.shift(), next);
      })();
    });
    return;
  }
  if (typeof p.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(p.id) || p.id === "com.opentvlauncher.lg") {
    msg.respond({ returnValue: false, errorText: "bad id" });
    return;
  }
  closeOne(p.id, function () { msg.respond({ returnValue: true }); });
});

// Launcher settings, kept outside the app folder so reinstalls keep them.
//   {}            -> { settings }
//   { set: {..} } -> saves, then { settings }
var SETTINGS_FILE = "/var/lib/webosbrew/opentvlauncher/settings.json";
var SETTING_KEYS = { showLgApps: "boolean", showPerformance: "boolean" };
service.register("settings", function (msg) {
  var fs = require("fs");
  var cur = {};
  try { cur = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) || {}; } catch (e) {}
  var set = msg.payload && msg.payload.set;
  if (set && typeof set === "object") {
    Object.keys(SETTING_KEYS).forEach(function (k) {
      if (typeof set[k] === SETTING_KEYS[k]) cur[k] = set[k];
    });
    try {
      if (!fs.existsSync("/var/lib/webosbrew/opentvlauncher")) fs.mkdirSync("/var/lib/webosbrew/opentvlauncher");
      // Temp file, flush to disk, then rename: never a half-written file,
      // even if the TV is switched off right after
      var tmp = SETTINGS_FILE + ".tmp";
      var fd = fs.openSync(tmp, "w");
      fs.writeSync(fd, JSON.stringify(cur));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fs.renameSync(tmp, SETTINGS_FILE);
    } catch (e) {
      msg.respond({ returnValue: false, errorText: "could not save settings" + (isRoot() ? "" : " (no root yet)") });
      return;
    }
  }
  msg.respond({ returnValue: true, settings: cur });
});

// Performance numbers for the launcher's performance panel:
// { mem: {total, used} (kB), storage: {total, free} (kB) }
service.register("stats", function (msg) {
  var fs = require("fs");
  var out = { returnValue: true };
  try {
    var mi = {};
    fs.readFileSync("/proc/meminfo", "utf8").split("\n").forEach(function (l) {
      var m = /^(\w+):\s+(\d+)/.exec(l);
      if (m) mi[m[1]] = +m[2];
    });
    var avail = mi.MemAvailable != null ? mi.MemAvailable : (mi.MemFree + (mi.Buffers || 0) + (mi.Cached || 0));
    out.mem = { total: mi.MemTotal, used: mi.MemTotal - avail };
  } catch (e) {}
  require("child_process").exec("df -k /mnt/lg/appstore /media/developer 2>/dev/null", { timeout: 4000 }, function (err, txt) {
    var line = String(txt || "").split("\n").filter(function (l) { return /^\//.test(l); })[0];
    if (line) {
      var c = line.trim().split(/\s+/);
      out.storage = { total: +c[1], free: +c[3] };
    }
    msg.respond(out);
  });
});

// Uninstall an app the TV marks as removable (what LG's launcher offers on a
// long press of OK). Refuses this launcher and the Homebrew Channel. { id }
service.register("uninstall", function (msg) {
  uninstallApp(msg.payload && msg.payload.id, function (res) { msg.respond(res); });
});

function uninstallApp(id, respond) {
  var cp = require("child_process");
  var msg = { respond: respond };
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]+$/.test(id) ||
      id === "com.opentvlauncher.lg" || id === "org.webosbrew.hbchannel") {
    msg.respond({ returnValue: false, errorText: "This app can't be uninstalled here." });
    return;
  }
  function ls(uri, payload, wait, cb) {
    cp.execFile("luna-send", ["-n", "1", "-w", String(wait), uri, JSON.stringify(payload)],
      { timeout: wait + 3000 }, function (err, out) { cb(String(out || "")); });
  }
  function listed(cb) {
    ls("luna://com.webos.applicationManager/listLaunchPoints", {}, 6000, function (out) {
      var lp = null;
      try {
        (JSON.parse(out).launchPoints || []).forEach(function (p) { if (p.id === id) lp = p; });
      } catch (e) {}
      cb(lp);
    });
  }
  listed(function (lp) {
    if (!lp) { msg.respond({ returnValue: false, errorText: "App not found." }); return; }
    if (lp.removable !== true) { msg.respond({ returnValue: false, errorText: "This app is part of the TV and can't be uninstalled." }); return; }
    ls("luna://com.webos.applicationManager/closeByAppId", { id: id }, 4000, function () {
      // Removal finishes in the background: wait until the app is gone
      function waitGone(tries, cb) {
        listed(function (still) {
          if (!still) cb(true);
          else if (tries <= 0) cb(false);
          else setTimeout(function () { waitGone(tries - 1, cb); }, 1000);
        });
      }
      // Store apps, then developer-installed apps
      ls("luna://com.webos.appInstallService/remove", { id: id }, 30000, function () {
        waitGone(20, function (gone) {
          if (gone) { msg.respond({ returnValue: true }); return; }
          ls("luna://com.webos.appInstallService/dev/remove", { id: id }, 30000, function () {
            waitGone(10, function (gone2) {
              msg.respond(gone2 ? { returnValue: true } : { returnValue: false, errorText: "The TV didn't remove it." });
            });
          });
        });
      });
    });
  });
}

// Delete with LG's own confirmation popup (native webOS alert): { id, name }
// The popup's buttons reopen the launcher with
//   params.opentvDelete = { id, answer: "delete" | "cancel" }
// and the launcher then deletes the app (uninstall method) with a spinner.
// (The popup may only call system services, so it goes through the
// application manager instead of calling this service directly.)
service.register("askDelete", function (msg) {
  var p = msg.payload || {};
  var id = p.id;
  var name = typeof p.name === "string" ? p.name.slice(0, 60) : id;
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]+$/.test(id)) {
    msg.respond({ returnValue: false, errorText: "bad id" });
    return;
  }
  function reopen(answer) {
    return {
      onclick: "luna://com.webos.applicationManager/launch",
      params: { id: "com.opentvlauncher.lg", params: { opentvDelete: { id: id, answer: answer } } }
    };
  }
  var cancel = reopen("cancel");
  var del = reopen("delete");
  var alert = {
    message: "Delete " + name + "? The app and its data will be removed from this TV.",
    buttons: [
      { label: "Cancel", onclick: cancel.onclick, params: cancel.params },
      { label: "Delete", onclick: del.onclick, params: del.params }
    ],
    onclose: { uri: cancel.onclick, params: cancel.params }
  };
  require("child_process").execFile("luna-send",
    ["-n", "1", "-w", "5000", "luna://com.webos.notification/createAlert", JSON.stringify(alert)],
    { timeout: 8000 }, function (err, out) {
      var res = {};
      try { res = JSON.parse(out); } catch (e) {}
      msg.respond(res.returnValue ? { returnValue: true, alertId: res.alertId }
                                  : { returnValue: false, errorText: "Couldn't show the popup" });
    });
});

// Restart, with LG's own confirmation popup. "Restart" reopens the
// launcher with params.opentvRestart, which then calls "restart".
service.register("askRestart", function (msg) {
  var alert = {
    message: "Restart the TV? Apps that are open will be closed.",
    buttons: [
      { label: "Cancel" },
      { label: "Restart", onclick: "luna://com.webos.applicationManager/launch",
        params: { id: "com.opentvlauncher.lg", params: { opentvRestart: true } } }
    ]
  };
  require("child_process").execFile("luna-send",
    ["-n", "1", "-w", "5000", "luna://com.webos.notification/createAlert", JSON.stringify(alert)],
    { timeout: 8000 }, function (err, out) {
      var res = {};
      try { res = JSON.parse(out); } catch (e) {}
      msg.respond(res.returnValue ? { returnValue: true } : { returnValue: false, errorText: "Couldn't show the popup" });
    });
});

service.register("restart", function (msg) {
  var cp = require("child_process");
  msg.respond({ returnValue: true });
  // LG's own restart first (saves settings properly), then a plain reboot
  setTimeout(function () {
    cp.execFile("luna-send", ["-n", "1", "-w", "8000", "luna://com.webos.service.tvpower/power/reboot",
      JSON.stringify({ reason: "remoteKey" })], { timeout: 10000 }, function (err, out) {
      if (err || !/"returnValue": *true/.test(String(out))) cp.exec("reboot", function () {});
    });
  }, 500);
});
