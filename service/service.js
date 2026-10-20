// OpenTV Launcher root service. Runs as root once elevated with the
// Homebrew Channel's elevate-service (done by the startup watcher).
// Only specific actions are offered: no generic command execution, so
// other apps on the TV cannot use this service to get root.
var Service = require("webos-service");
var APP_DIR = "/media/developer/apps/usr/palm/applications/com.opentvlauncher.lg";

var service = new Service("com.opentvlauncher.lg.service");

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
  try {
    delete require.cache[require.resolve(APP_DIR + "/sync-icons.js")];
    var mod = require(APP_DIR + "/sync-icons.js");
    var apps = mod.sync();
    msg.respond({ returnValue: true, apps: apps, recent: mod.readRecent() });
  } catch (e) {
    msg.respond({ returnValue: false, errorText: String(e && e.message || e) });
  }
});

// Recently used apps, newest first: { recent: ["netflix", ...] }
// Read-only, so it also works before the service has root.
service.register("recent", function (msg) {
  try {
    delete require.cache[require.resolve(APP_DIR + "/sync-icons.js")];
    msg.respond({ returnValue: true, recent: require(APP_DIR + "/sync-icons.js").readRecent() });
  } catch (e) {
    msg.respond({ returnValue: false, errorText: String(e && e.message || e) });
  }
});

// Apps running in the background: { running: ["netflix", ...] }
service.register("running", function (msg) {
  require("child_process").exec(
    "luna-send -n 1 -w 5000 luna://com.webos.applicationManager/running '{}'",
    { timeout: 8000 },
    function (err, out) {
      try {
        var list = (JSON.parse(out).running || []).map(function (r) { return r.id; });
        msg.respond({ returnValue: true, running: list });
      } catch (e) {
        msg.respond({ returnValue: false, errorText: "could not read running apps" });
      }
    });
});

// Close one background app: { id: "netflix" }
service.register("close", function (msg) {
  var id = msg.payload && msg.payload.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]+$/.test(id) || id === "com.opentvlauncher.lg") {
    msg.respond({ returnValue: false, errorText: "bad id" });
    return;
  }
  require("child_process").execFile("luna-send",
    ["-n", "1", "-w", "5000", "luna://com.webos.applicationManager/closeByAppId", JSON.stringify({ id: id })],
    { timeout: 8000 },
    function (err) { msg.respond({ returnValue: !err }); });
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
