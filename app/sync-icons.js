// Copies every app's icon into icons/<appId>.png and writes installed.js.
// Used two ways, both as root:
//   node sync-icons.js            (from the startup watcher)
//   require(".../sync-icons.js")  (from com.opentvlauncher.lg.service)
var fs = require("fs");
var path = require("path");
var cp = require("child_process");

var DIR = __dirname;
var ICONS = path.join(DIR, "icons");
/* Recently used apps, newest first, one id per line. Written by the
   startup watcher (autostart.sh); lives outside the app folder so a
   reinstall keeps it. */
var RECENT_FILE = "/var/lib/webosbrew/opentvlauncher/recent.txt";

function readRecent() {
  try {
    return fs.readFileSync(RECENT_FILE, "utf8").split("\n")
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l; })
      .slice(0, 30);
  } catch (e) { return []; }
}

function sync() {
  if (!fs.existsSync(ICONS)) fs.mkdirSync(ICONS);

  var out = cp.execSync(
    "luna-send -n 1 luna://com.webos.applicationManager/listLaunchPoints '{}'",
    { encoding: "utf8", timeout: 20000 }
  );
  var lps = (JSON.parse(out).launchPoints) || [];

  var list = [];
  lps.forEach(function (lp) {
    /* Medium (115px) icon first, then large (130px), then small (80px) */
    var src = [lp.mediumLargeIcon, lp.largeIcon, lp.icon].filter(function (p) {
      return p && p.charAt(0) === "/" && fs.existsSync(p);
    })[0];
    var hasIcon = false;
    if (src) {
      var dest = path.join(ICONS, lp.id + ".png");
      try {
        /* Only copy when new or changed */
        var s = fs.statSync(src);
        var d = fs.existsSync(dest) ? fs.statSync(dest) : null;
        if (!d || d.size !== s.size || d.mtimeMs < s.mtimeMs) fs.copyFileSync(src, dest);
        hasIcon = true;
      } catch (e) {}
    }
    list.push({
      id: lp.id,
      title: lp.title || lp.id,
      color: lp.iconColor || "",
      icon: hasIcon
    });
  });

  fs.writeFileSync(
    path.join(DIR, "installed.js"),
    "window.INSTALLED_APPS = " + JSON.stringify(list) + ";\n" +
    "window.RECENT_APPS = " + JSON.stringify(readRecent()) + ";\n"
  );
  return list;
}

module.exports = { sync: sync, readRecent: readRecent };

if (require.main === module) {
  var list = sync();
  console.log("synced " + list.length + " apps, " +
    list.filter(function (a) { return a.icon; }).length + " icons");
}
