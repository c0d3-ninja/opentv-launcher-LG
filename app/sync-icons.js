// Copies every app's icon into icons/<appId>.png and writes installed.js.
// Used two ways, both as root:
//   node sync-icons.js            (from the startup watcher)
//   require(".../sync-icons.js")  (from com.opentvlauncher.lg.service)
// Everything is asynchronous, so the service keeps answering other
// requests (memory panel, uninstall, ...) while icons are being copied.
var fs = require("fs");
var path = require("path");
var cp = require("child_process");

var DIR = __dirname;
var ICONS = path.join(DIR, "icons");
/* Recently used apps, newest first, one id per line. Written by the
   startup watcher (autostart.sh); lives outside the app folder so a
   reinstall keeps it. */
var RECENT_FILE = "/var/lib/webosbrew/opentvlauncher/recent.txt";

function readRecent(cb) {
  fs.readFile(RECENT_FILE, "utf8", function (err, txt) {
    if (err) { cb([]); return; }
    cb(txt.split("\n")
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l; })
      .slice(0, 30));
  });
}

// First existing file from the list, or null.
function firstExisting(paths, cb) {
  var i = 0;
  (function next() {
    if (i >= paths.length) { cb(null, null); return; }
    var p = paths[i++];
    if (!p || p.charAt(0) !== "/") { next(); return; }
    fs.stat(p, function (err, st) {
      if (!err && st.isFile()) cb(p, st); else next();
    });
  })();
}

// Copy one app's icon if it is new or changed. cb(hasIcon)
function copyIcon(lp, cb) {
  /* Medium (115px) icon first, then large (130px), then small (80px) */
  firstExisting([lp.mediumLargeIcon, lp.largeIcon, lp.icon], function (src, st) {
    if (!src) { cb(false); return; }
    var dest = path.join(ICONS, lp.id + ".png");
    fs.stat(dest, function (err, d) {
      if (!err && d.size === st.size && d.mtimeMs >= st.mtimeMs) { cb(true); return; }
      fs.copyFile(src, dest, function (e) { cb(!e); });
    });
  });
}

// cb(err, list) with list = [{ id, title, color, icon, removable }]
function sync(cb) {
  fs.mkdir(ICONS, function () {
    cp.execFile("luna-send", ["-n", "1", "-w", "15000",
      "luna://com.webos.applicationManager/listLaunchPoints", "{}"],
      { timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
      function (err, out) {
        var lps;
        try { lps = JSON.parse(out).launchPoints || []; }
        catch (e) { cb(new Error("could not read the app list")); return; }

        var list = new Array(lps.length);
        var left = lps.length;
        if (!left) { finish(); return; }
        lps.forEach(function (lp, i) {
          copyIcon(lp, function (hasIcon) {
            list[i] = {
              id: lp.id,
              title: lp.title || lp.id,
              color: lp.iconColor || "",
              icon: hasIcon,
              removable: lp.removable === true
            };
            if (--left === 0) finish();
          });
        });

        function finish() {
          readRecent(function (recent) {
            var js = "window.INSTALLED_APPS = " + JSON.stringify(list) + ";\n" +
                     "window.RECENT_APPS = " + JSON.stringify(recent) + ";\n";
            /* Write to a temp file, then rename, so the page never loads half a file */
            var tmp = path.join(DIR, "installed.js.tmp");
            fs.writeFile(tmp, js, function (e) {
              if (e) { cb(e); return; }
              fs.rename(tmp, path.join(DIR, "installed.js"), function (e2) {
                cb(e2 || null, list, recent);
              });
            });
          });
        }
      });
  });
}

module.exports = { sync: sync, readRecent: readRecent };

if (require.main === module) {
  sync(function (err, list) {
    if (err) { console.log("sync failed: " + err.message); process.exit(1); }
    console.log("synced " + list.length + " apps, " +
      list.filter(function (a) { return a.icon; }).length + " icons");
  });
}
