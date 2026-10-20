(function () {
  "use strict";

  var SELF_ID = "com.opentvlauncher.lg";
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, ESC: 27, BACKSPACE: 8 };

  var cfg = window.LAUNCHER_CONFIG || { dock: [], more: [] };
  function freshRows() {
    function copy(a) { var o = {}; for (var k in a) o[k] = a[k]; return o; }
    return [cfg.dock.map(copy), cfg.more.map(copy)];
  }
  var rows = freshRows();
  /* Recent row: at most 10 recently used apps; topped up to 6 with the
     favourites in apps.js (dock), then other apps */
  var RECENT_MAX = 10, RECENT_MIN = 6;
  var rowEls = [document.getElementById("dock"), document.getElementById("more")];
  var focus = { row: 0, col: 0 };
  var installed = null;
  var bgFlip = false;
  var bridges = [];

  /* ---------- webOS Luna calls ---------- */
  /* One Luna call. The callback always runs exactly once: with the reply,
     or with an error after a timeout (default 15 s), so nothing can hang. */
  function luna(uri, params, cb, timeoutMs) {
    var done = false;
    function finish(res) {
      if (done) return;
      done = true;
      if (cb) cb(res);
    }
    if (typeof window.PalmServiceBridge === "undefined") {
      finish({ returnValue: false, errorText: "preview" });
      return;
    }
    var b;
    try { b = new window.PalmServiceBridge(); }
    catch (e) { finish({ returnValue: false, errorText: "no service bridge" }); return; }
    bridges.push(b);
    function release() {
      var idx = bridges.indexOf(b);
      if (idx >= 0) bridges.splice(idx, 1);
    }
    var timer = setTimeout(function () {
      release();
      try { b.cancel(); } catch (e) {}
      finish({ returnValue: false, errorText: "timed out" });
    }, timeoutMs || 15000);
    b.onservicecallback = function (msg) {
      clearTimeout(timer);
      release();
      var res;
      try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false, errorText: "bad reply" }; }
      finish(res);
    };
    try { b.call(uri, JSON.stringify(params || {})); }
    catch (e) { clearTimeout(timer); release(); finish({ returnValue: false, errorText: String(e && e.message || e) }); }
  }

  function resolveId(app) {
    if (!installed) return app.ids[0];
    for (var i = 0; i < app.ids.length; i++) {
      if (installed[app.ids[i]]) return app.ids[i];
    }
    return null;
  }

  function launch(app) {
    var id = resolveId(app);
    if (!id) { toast(app.name + " is not installed"); return; }
    if (typeof window.PalmServiceBridge === "undefined") {
      toast("Preview: " + app.name + " (" + id + ")");
      return;
    }
    var p = { id: id };
    if (app.params) p.params = app.params;
    luna("luna://com.webos.applicationManager/launch", p, function (res) {
      if (!res || res.returnValue === false) toast("Couldn't open " + app.name, true);
    });
  }

  /* ---------- Tile rendering ---------- */

  /* Get the initial letter(s) for an app (fallback when no icon image). */
  function appInitial(name) {
    if (!name) return "?";
    /* Two-letter combos for common names */
    var n = name.trim();
    if (/^HDMI/i.test(n)) return n.replace(/[^0-9]/g, "") ? "H" + n.replace(/[^0-9]/g, "") : "HD";
    if (n === "Live TV") return "TV";
    if (n === "Prime Video") return "PV";
    if (n === "Disney+") return "D+";
    if (n === "Screen Share") return "SS";
    return n.charAt(0).toUpperCase();
  }

  function buildTile(app, r, c) {
    var tile = document.createElement("div");
    tile.className = "tile";
    tile.setAttribute("role", "listitem");
    tile.setAttribute("aria-label", app.name);

    var box = document.createElement("div");
    box.className = "tile-box";
    /* Set brand colour as background */
    box.style.backgroundColor = app.color || "#2C2C2E";

    /* Try real icon image first, then show initial letter */
    if (app.iconUrl) {
      var img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.src = app.iconUrl;
      /* If the image is from listLaunchPoints, it already has its own background,
         so let it fill the tile edge-to-edge for a cleaner look. */
      if (app.iconFill) img.className = "tile-icon-fill";
      img.onerror = function () {
        box.removeChild(img);
        var init = document.createElement("span");
        init.className = "tile-initial";
        init.textContent = appInitial(app.name);
        box.appendChild(init);
      };
      box.appendChild(img);
    } else {
      var init = document.createElement("span");
      init.className = "tile-initial";
      init.textContent = appInitial(app.name);
      box.appendChild(init);
    }
    tile.appendChild(box);

    /* Name below the tile */
    var label = document.createElement("div");
    label.className = "tile-name";
    label.textContent = app.name;
    tile.appendChild(label);

    if (installed && !resolveId(app)) tile.className += " missing";

    var holdTimer = null, held = false;
    tile.addEventListener("mouseenter", function () { setFocus(r, c); });
    tile.addEventListener("mousedown", function () {
      held = false;
      holdTimer = setTimeout(function () { held = true; setFocus(r, c); enterEdit(); }, LONG_PRESS_MS);
    });
    tile.addEventListener("mouseup", function () { clearTimeout(holdTimer); });
    tile.addEventListener("mouseleave", function () { clearTimeout(holdTimer); });
    tile.addEventListener("click", function () {
      if (held) { held = false; return; }
      setFocus(r, c); launch(app);
    });
    return tile;
  }

  function render() {
    for (var r = 0; r < rows.length; r++) {
      var el = rowEls[r];
      /* Build off-screen, then swap in one go (one layout instead of many) */
      var frag = document.createDocumentFragment();
      for (var c = 0; c < rows[r].length; c++) frag.appendChild(buildTile(rows[r][c], r, c));
      el.textContent = "";
      el.appendChild(frag);
    }
    colsCache = 0;
    document.body.classList.remove("apps-loading");
    setFocus(focus.row, focus.col);
  }

  /* ---------- Hero banner ---------- */
  function heroFor(app) {
    return app.hero || {
      base: "#101114", tint: "#30333B", glow: "#4A4E58",
      label: "App", title: app.name, desc: ""
    };
  }

  function paintHero(app) {
    var h = heroFor(app);
    var bg =
      "radial-gradient(1200px 900px at 1500px 280px, " + h.tint + " 0%, rgba(0,0,0,0) 60%)," +
      "radial-gradient(700px 600px at 1700px 500px, " + h.glow + " 0%, rgba(0,0,0,0) 65%)," +
      "radial-gradient(400px 400px at 200px 600px, " + h.tint + "22 0%, rgba(0,0,0,0) 70%)," +
      h.base;
    var a = document.getElementById("bgA");
    var b = document.getElementById("bgB");
    var next = bgFlip ? a : b;
    var prev = bgFlip ? b : a;
    next.style.background = bg;
    next.className = "hero-bg on";
    prev.className = "hero-bg";
    bgFlip = !bgFlip;

    var title = h.title || app.name;
    var titleEl = document.getElementById("heroTitle");
    if (titleEl.textContent === title) return;
    document.getElementById("heroLabel").textContent = h.label || "";
    titleEl.textContent = title;
    document.getElementById("heroDesc").textContent = h.desc || "";
    /* Restart the fade-in */
    var ht = document.getElementById("heroText");
    ht.classList.remove("hero-in");
    void ht.offsetWidth;
    ht.classList.add("hero-in");
  }

  /* ---------- Top bar buttons ---------- */
  var topBtns = [
    /* In screen order, left to right */
    document.getElementById("btnSettings"),
    document.getElementById("btnRestart"),
    document.getElementById("btnNotif"),
    document.getElementById("btnLgHome"),
    document.getElementById("btnSearch"),
    document.getElementById("btnLauncherSettings"),
    document.getElementById("profile")
  ];
  var topBarActions = {
    /* Opened from here, LG's home is left alone by the watcher (autostart.sh) */
    btnLgHome: "com.webos.app.home",
    btnSearch: "com.webos.app.voice",           /* LG search screen */
    btnNotif: "com.webos.app.notificationcenter", /* LG notification panel */
    btnSettings: "com.palm.app.settings",
    /* LG Account panel, same as the profile icon on LG's home */
    profile: "com.webos.app.overlaymembership"
  };
  var topFocus = -1; /* -1 means top bar is not focused */

  function clearTopFocus() {
    topBtns.forEach(function (b) { if (b) b.classList.remove("focused"); });
    topFocus = -1;
  }

  function setTopFocus(idx) {
    idx = Math.max(0, Math.min(topBtns.length - 1, idx));
    clearTopFocus();
    topFocus = idx;
    if (topBtns[idx]) topBtns[idx].classList.add("focused");
    /* Clear tile focus */
    var old = rowEls[focus.row] && rowEls[focus.row].children[focus.col];
    if (old) old.classList.remove("focused");
  }

  function launchTopBtn() {
    var btn = topBtns[topFocus];
    if (!btn) return;
    if (btn.id === "btnLauncherSettings") { openLauncherSettings(); return; }
    if (btn.id === "btnRestart") { askRestart(); return; }
    var appId = topBarActions[btn.id];
    if (appId) {
      if (typeof window.PalmServiceBridge === "undefined") {
        toast("Would open " + (btn.getAttribute("aria-label") || btn.id));
      } else {
        luna("luna://com.webos.applicationManager/launch", { id: appId }, function (res) {
          if (!res || res.returnValue === false) toast("Couldn't open " + (btn.getAttribute("aria-label") || btn.id), true);
        });
      }
    }
  }

  topBtns.forEach(function (btn, idx) {
    if (!btn) return;
    btn.addEventListener("mouseenter", function () { setTopFocus(idx); });
    btn.addEventListener("click", function () { setTopFocus(idx); launchTopBtn(); });
  });

  /* ---------- Launcher settings (dropdown next to Search) ----------
     Saved on the TV by the service (survives reinstalls), with a local
     copy for an instant start. */
  var settings = { showLgApps: true, showPerformance: false };
  try {
    var saved = JSON.parse(localStorage.getItem("opentv.settings") || "null");
    if (saved && typeof saved === "object") for (var sk in saved) settings[sk] = saved[sk];
  } catch (e) {}
  var lsMenu = document.getElementById("lsMenu");
  var lsShowLg = document.getElementById("lsShowLg");
  var lsShowPerf = document.getElementById("lsShowPerf");
  var lsRows = [lsShowLg, lsShowPerf];
  var lsRow = 0;
  var lsOpen = false;

  function drawSettings() {
    /* The switch reads "Hide LG TV apps", so it is on when they are hidden */
    lsShowLg.setAttribute("aria-checked", settings.showLgApps ? "false" : "true");
    lsShowPerf.setAttribute("aria-checked", settings.showPerformance ? "true" : "false");
    document.body.classList.toggle("perf-on", !!settings.showPerformance);
    updatePerfTimer();
  }

  function lsFocusRow(i) {
    lsRow = Math.max(0, Math.min(lsRows.length - 1, i));
    lsRows.forEach(function (r, k) { r.classList.toggle("focused", k === lsRow); });
  }

  /* Settings live in a file on the TV (via the service), so they survive
     restarts and reinstalls. If a save fails (for example right after a
     restart, while the service is still getting root), it is kept as
     "unsaved" and retried until the service confirms it, and the values
     from the file never overwrite an unsaved change. */
  var settingsDirty = false;
  try { settingsDirty = localStorage.getItem("opentv.settingsDirty") === "1"; } catch (e) {}
  var settingsRetry = null;

  function markDirty(on) {
    settingsDirty = on;
    try { localStorage.setItem("opentv.settingsDirty", on ? "1" : "0"); } catch (e) {}
  }

  function saveSettings() {
    try { localStorage.setItem("opentv.settings", JSON.stringify(settings)); } catch (e) {}
    markDirty(true);
    pushSettings();
  }

  function pushSettings() {
    clearTimeout(settingsRetry);
    var sent = JSON.stringify(settings);
    luna(SERVICE + "/settings", { set: settings }, function (res) {
      if (res && res.returnValue) {
        /* Only clear if nothing changed while saving */
        if (JSON.stringify(settings) === sent) markDirty(false);
        return;
      }
      settingsRetry = setTimeout(pushSettings, 3000);
    }, 10000);
  }

  function loadSettings(tries) {
    if (settingsDirty) { pushSettings(); return; }
    luna(SERVICE + "/settings", {}, function (res) {
      if (!res || !res.returnValue || !res.settings) {
        /* Service not ready yet (TV just started): try again */
        if ((tries || 0) < 10) settingsRetry = setTimeout(function () { loadSettings((tries || 0) + 1); }, 3000);
        return;
      }
      if (settingsDirty) { pushSettings(); return; }
      var changed = false;
      for (var k in res.settings) {
        if (settings[k] !== res.settings[k]) { settings[k] = res.settings[k]; changed = true; }
      }
      if (!changed) return;
      try { localStorage.setItem("opentv.settings", JSON.stringify(settings)); } catch (e) {}
      drawSettings();
      if (window.INSTALLED_APPS && window.INSTALLED_APPS.length) applyInstalled(window.INSTALLED_APPS);
    }, 10000);
  }

  function openLauncherSettings() {
    lsOpen = true;
    drawSettings();
    lsFocusRow(0);
    lsMenu.classList.add("open");
    lsMenu.setAttribute("aria-hidden", "false");
  }

  function closeLauncherSettings() {
    if (!lsOpen) return;
    lsOpen = false;
    lsMenu.classList.remove("open");
    lsMenu.setAttribute("aria-hidden", "true");
    lsRows.forEach(function (r) { r.classList.remove("focused"); });
  }

  function toggleShowLg() {
    settings.showLgApps = !settings.showLgApps;
    drawSettings();
    saveSettings();
    if (window.INSTALLED_APPS && window.INSTALLED_APPS.length) applyInstalled(window.INSTALLED_APPS);
    /* applyInstalled re-renders and moves focus to the rows; keep the top bar */
    setTopFocus(topBtns.indexOf(document.getElementById("btnLauncherSettings")));
    toast(settings.showLgApps ? "LG TV apps shown" : "LG TV apps hidden");
  }

  function toggleShowPerf() {
    settings.showPerformance = !settings.showPerformance;
    drawSettings();
    saveSettings();
  }

  function settingsKey(code) {
    switch (code) {
      case KEY.ENTER:
        if (lsRow === 0) toggleShowLg(); else toggleShowPerf();
        break;
      case KEY.UP:
        if (lsRow > 0) lsFocusRow(lsRow - 1); else closeLauncherSettings();
        break;
      case KEY.DOWN:
        lsFocusRow(lsRow + 1);
        break;
      case KEY.BACK:
      case KEY.ESC:
      case KEY.BACKSPACE:
      case KEY.LEFT:
      case KEY.RIGHT:
        closeLauncherSettings(); break;
      default: return false;
    }
    return true;
  }

  lsShowLg.addEventListener("click", function (e) { e.stopPropagation(); lsFocusRow(0); toggleShowLg(); });
  lsShowPerf.addEventListener("click", function (e) { e.stopPropagation(); lsFocusRow(1); toggleShowPerf(); });
  lsShowLg.addEventListener("mouseenter", function () { lsFocusRow(0); });
  lsShowPerf.addEventListener("mouseenter", function () { lsFocusRow(1); });

  /* ---------- Performance panel ---------- */
  var perfTimer = null;

  function fmtKB(kb) {
    var gb = kb / 1048576;
    return gb >= 1 ? gb.toFixed(1) + " GB" : Math.round(kb / 1024) + " MB";
  }

  function setBar(id, pct) {
    var el = document.getElementById(id);
    pct = Math.max(0, Math.min(100, pct));
    el.style.transform = "scaleX(" + (pct / 100) + ")";
    el.classList.toggle("warn", pct >= 70 && pct < 90);
    el.classList.toggle("high", pct >= 90);
  }

  function setText(id, t) { var el = document.getElementById(id); if (el.textContent !== t) el.textContent = t; }

  function showStats(st) {
    document.getElementById("perf").classList.remove("loading");
    if (st.mem && st.mem.total) {
      var mp = Math.round(100 * st.mem.used / st.mem.total);
      setText("pfMemVal", mp + "%");
      setBar("pfMemBar", mp);
      setText("pfMemSub", fmtKB(st.mem.used) + " used of " + fmtKB(st.mem.total) + " \u00b7 " + fmtKB(st.mem.total - st.mem.used) + " free");
    }
    if (st.storage && st.storage.total) {
      var used = st.storage.total - st.storage.free;
      var dp = Math.round(100 * used / st.storage.total);
      setText("pfDiskVal", dp + "%");
      setBar("pfDiskBar", dp);
      setText("pfDiskSub", fmtKB(st.storage.free) + " free of " + fmtKB(st.storage.total));
    }
  }

  function pollStats() {
    if (typeof window.PalmServiceBridge === "undefined") {
      var t = Date.now() / 1000;
      showStats({ mem: { total: 2030540, used: 1400000 + 50000 * Math.sin(t) }, storage: { total: 2820468, free: 993756 } });
      return;
    }
    luna(SERVICE + "/stats", {}, function (res) { if (res && res.returnValue) showStats(res); });
  }

  /* Poll only while the panel is on and the launcher is on screen */
  function updatePerfTimer() {
    var want = settings.showPerformance && !document.hidden;
    if (want && !perfTimer) { pollStats(); perfTimer = setInterval(pollStats, 5000); /* every 5 seconds */ }
    if (!want && perfTimer) { clearInterval(perfTimer); perfTimer = null; }
  }
  drawSettings();

  /* ---------- Focus management ---------- */
  function setFocus(r, c) {
    if (!rows[r] || rows[r].length === 0) return;
    c = Math.max(0, Math.min(rows[r].length - 1, c));
    var prevRow = focus.row;
    var prevCol = focus.col;
    focus.row = r;
    focus.col = c;
    clearTopFocus();

    var old = rowEls[prevRow] && rowEls[prevRow].children[prevCol];
    if (old) old.classList.remove("focused");
    var cur = rowEls[r].children[c];
    if (cur) cur.classList.add("focused");

    document.body.classList.toggle("expanded", r === 1);
    scrollRows(r === 1 ? cur : null);
    if (r === 0) paintHero(rows[0][c]);
  }

  /* Glide the rows up/down (CSS transition on transform) so the focused
     line of All Apps stays on screen. */
  var ROWS_TOP = 600;          /* #rows top in style.css */
  var EXPANDED_SHIFT = 400;    /* how far the rows rise when All Apps is focused */
  var rowsShift = -1;
  function scrollRows(tile) {
    var shift = 0;
    if (tile) {
      shift = EXPANDED_SHIFT;
      var bottom = ROWS_TOP + tile.offsetTop + tile.offsetHeight + 40 - shift;
      if (bottom > 1040) shift += bottom - 1040;
    }
    if (shift === rowsShift) return;
    rowsShift = shift;
    document.getElementById("rows").style.transform = "translate3d(0," + (-shift) + "px,0)";
  }

  /* Tiles per line in All Apps. Measured once after each render/resize
     instead of on every key press. */
  var colsCache = 0;
  function moreColumns() {
    if (colsCache) return colsCache;
    colsCache = measureColumns();
    return colsCache;
  }
  function measureColumns() {
    var el = rowEls[1];
    if (el.children.length < 2) return el.children.length || 1;
    var top = el.children[0].offsetTop;
    var n = 0;
    for (var i = 0; i < el.children.length; i++) {
      if (el.children[i].offsetTop !== top) break;
      n++;
    }
    return n || 1;
  }

  function move(dir) {
    /* If top bar is focused, handle navigation there */
    if (topFocus >= 0) {
      if (dir === "left") { setTopFocus(topFocus - 1); return; }
      if (dir === "right") { setTopFocus(topFocus + 1); return; }
      if (dir === "down") { setFocus(0, focus.col); return; }
      return;
    }
    var r = focus.row, c = focus.col;
    if (dir === "left") return setFocus(r, c - 1);
    if (dir === "right") return setFocus(r, c + 1);
    if (r === 0) {
      if (dir === "up") { setTopFocus(0); return; }
      if (dir === "down" && rows[1].length) setFocus(1, Math.min(c, rows[1].length - 1));
      return;
    }
    var cols = moreColumns();
    if (dir === "up") {
      if (c - cols >= 0) setFocus(1, c - cols);
      else setFocus(0, Math.min(c, rows[0].length - 1));
    } else if (dir === "down" && c + cols < rows[1].length) {
      setFocus(1, c + cols);
    }
  }

  function goHome() {
    clearTopFocus();
    setFocus(0, 0);
  }

  /* ---------- Double Back: Recent Lists ----------
     The same list, snapshots and close actions as LG's Recent Lists
     (com.webos.service.recent), shown inside the launcher. */
  var lastBack = 0;
  var rc = { open: false, items: [], col: 0, part: "card" }; /* part: card | x | all */
  var rcEl = document.getElementById("recents");
  var rcRow = document.getElementById("rcRow");
  var rcAll = document.getElementById("rcCloseAll");
  var X_SVG = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';

  function appById(id) {
    var all = rows[1] || [];
    for (var i = 0; i < all.length; i++) if (all[i].ids.indexOf(id) >= 0) return all[i];
    return null;
  }

  function openRecents() {
    rc.open = true;
    rc.col = 0;
    rc.part = "card";
    rcEl.classList.add("open");
    rcEl.setAttribute("aria-hidden", "false");
    rcEl.classList.add("loading");
    rc.items = [];
    drawRecents();
    if (typeof window.PalmServiceBridge === "undefined") {
      rc.items = (rows[0] || []).slice(0, 5).map(function (a) { return { id: a.ids[0], title: a.name, image: "" }; });
      rcEl.classList.remove("loading");
      rc.part = "card";
      drawRecents();
      return;
    }
    luna(SERVICE + "/recents", {}, function (res) {
      if (!rc.open) return;
      rcEl.classList.remove("loading");
      if (!res || !res.returnValue) toast("Couldn't load Recent Lists", true);
      rc.items = (res && res.recents) || [];
      rc.part = "card";
      drawRecents();
    });
  }

  function closeRecents() {
    if (!rc.open) return;
    rc.open = false;
    rcEl.classList.remove("open");
    rcEl.setAttribute("aria-hidden", "true");
  }

  function drawRecents() {
    while (rcRow.firstChild) rcRow.removeChild(rcRow.firstChild);
    rc.items.forEach(function (it, i) {
      var app = appById(it.id);
      var card = document.createElement("div");
      card.className = "rc-card";
      var x = document.createElement("div");
      x.className = "rc-x";
      x.innerHTML = X_SVG;
      var box = document.createElement("div");
      box.className = "rc-box";
      if (it.image) {
        var img = document.createElement("img");
        img.className = "rc-shot";
        img.onerror = function () { img.style.visibility = "hidden"; };
        img.src = it.image;
        box.appendChild(img);
      } else if (app && app.iconUrl) {
        box.style.backgroundColor = app.color || "#1E1F22";
        var ic = document.createElement("img");
        ic.className = "rc-icon";
        ic.src = app.iconUrl;
        box.appendChild(ic);
      } else {
        var init = document.createElement("span");
        init.className = "tile-initial";
        init.textContent = appInitial(it.title);
        box.appendChild(init);
      }
      var name = document.createElement("div");
      name.className = "rc-name";
      name.textContent = it.title;
      card.appendChild(x);
      card.appendChild(box);
      card.appendChild(name);
      x.addEventListener("click", function (e) { e.stopPropagation(); rc.col = i; rcCloseOne(); });
      card.addEventListener("click", function () { rc.col = i; rc.part = "card"; rcOpenApp(); });
      card.addEventListener("mouseenter", function () { rc.col = i; rc.part = "card"; rcFocus(); });
      rcRow.appendChild(card);
    });
    rcEl.classList.toggle("empty", rc.items.length === 0);
    if (!rc.items.length) rc.part = "all";
    rcFocus();
  }

  function rcFocus() {
    if (rc.col >= rc.items.length) rc.col = rc.items.length - 1;
    if (rc.col < 0) rc.col = 0;
    for (var k = 0; k < rcRow.children.length; k++) {
      rcRow.children[k].classList.toggle("focused", k === rc.col && rc.part === "card");
      rcRow.children[k].classList.toggle("x-focused", k === rc.col && rc.part === "x");
    }
    rcAll.classList.toggle("focused", rc.part === "all");
    /* Keep the focused card on screen */
    var cur = rcRow.children[rc.col];
    var shift = 0;
    if (cur) {
      var right = cur.offsetLeft + cur.offsetWidth + 120;
      if (right > 1884) shift = right - 1884;
    }
    rcRow.style.transform = "translate3d(" + (-shift) + "px,0,0)";
  }

  function rcOpenApp() {
    var it = rc.items[rc.col];
    if (!it) return;
    closeRecents();
    var app = appById(it.id) || { name: it.title, ids: [it.id] };
    if (!installed || !installed[it.id]) {
      luna("luna://com.webos.applicationManager/launch", { id: it.id }, function () {});
    } else {
      launch(app);
    }
  }

  function rcCloseOne() {
    var it = rc.items[rc.col];
    if (!it) return;
    var card = rcRow.children[rc.col];
    if (card) card.classList.add("closing");
    luna(SERVICE + "/recentsClose", { id: it.id }, function () {});
    setTimeout(function () {
      rc.items.splice(rc.items.indexOf(it), 1);
      if (rc.part === "x" && !rc.items.length) rc.part = "all";
      drawRecents();
    }, 300);
  }

  function rcCloseAll() {
    for (var k = 0; k < rcRow.children.length; k++) rcRow.children[k].classList.add("closing");
    luna(SERVICE + "/recentsClose", { all: true }, function () {});
    setTimeout(function () { rc.items = []; drawRecents(); }, 300);
  }

  rcAll.addEventListener("click", rcCloseAll);
  rcAll.addEventListener("mouseenter", function () { rc.part = "all"; rcFocus(); });

  function recentsKey(code) {
    switch (code) {
      case KEY.LEFT:
        if (rc.part !== "all") { rc.col--; rcFocus(); }
        break;
      case KEY.RIGHT:
        if (rc.part !== "all") { rc.col++; rcFocus(); }
        break;
      case KEY.UP:
        if (rc.part === "card") rc.part = "x";
        else rc.part = "all";
        rcFocus();
        break;
      case KEY.DOWN:
        if (rc.part === "all" && rc.items.length) rc.part = "x";
        else if (rc.part === "x") rc.part = "card";
        rcFocus();
        break;
      case KEY.ENTER:
        if (rc.part === "card") rcOpenApp();
        else if (rc.part === "x") rcCloseOne();
        else rcCloseAll();
        break;
      case KEY.BACK:
      case KEY.ESC:
      case KEY.BACKSPACE:
        closeRecents();
        break;
      default: return false;
    }
    return true;
  }

  var lastMoveAt = 0;

  /* ---------- Delete apps, like LG's home: hold OK on an app ----------
     The app lifts and a Delete button appears above it. Up selects it, OK
     asks "Delete <app>?" in a popup, Back leaves edit mode. */
  var LONG_PRESS_MS = 650;
  var ed = { on: false, onX: false, app: null, tile: null, busy: false };
  var pressTimer = null;
  var pressHandled = false;

  function appRemovable(app) {
    var info = installed && installed[resolveId(app)];
    return !!(info && info.removable);
  }

  function enterEdit() {
    if (topFocus >= 0 || !rows[focus.row] || !rows[focus.row][focus.col]) return;
    var app = rows[focus.row][focus.col];
    if (!appRemovable(app)) {
      toast(app.name + " is part of the TV and can't be deleted");
      return;
    }
    ed.on = true;
    ed.onX = false;
    ed.app = app;
    ed.tile = rowEls[focus.row].children[focus.col];
    if (!ed.tile.querySelector(".tile-x")) {
      var x = document.createElement("div");
      x.className = "tile-x";
      x.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg><span>Delete</span>';
      x.addEventListener("click", function (e) { e.stopPropagation(); askDelete(); });
      ed.tile.appendChild(x);
    }
    ed.tile.classList.add("editing");
    ed.tile.classList.remove("x-focused");
  }

  function exitEdit() {
    if (!ed.on || ed.busy) return;
    ed.on = false;
    if (ed.tile) ed.tile.classList.remove("editing", "x-focused");
    ed.tile = null;
  }

  function editKey(e) {
    if (e.repeat) return true;          /* OK still held from the long press */
    if (ed.busy) return true;           /* popup open or deleting */
    switch (e.keyCode) {
      case KEY.UP:
        ed.onX = true; ed.tile.classList.add("x-focused"); break;
      case KEY.DOWN:
        ed.onX = false; ed.tile.classList.remove("x-focused"); break;
      case KEY.ENTER:
        if (ed.onX) askDelete(); else exitEdit();
        break;
      case KEY.BACK:
      case KEY.ESC:
      case KEY.BACKSPACE:
        exitEdit(); break;
      case KEY.LEFT:
      case KEY.RIGHT:
        exitEdit(); return false;       /* leave edit mode and move as usual */
      default: return false;
    }
    return true;
  }

  /* ----- Delete: LG's own confirmation popup (native webOS alert) -----
     The service shows the popup and reports back: asking, deleting, then
     done / cancelled / error. */
  function setDeleting(tile, on) {
    var x = tile && tile.querySelector(".tile-x span");
    if (tile) tile.classList.toggle("deleting", on);
    if (x) x.textContent = on ? "Deleting\u2026" : "Delete";
  }

  function finishDelete(res) {
    var app = ed.app, tile = ed.tile;
    ed.busy = false;
    clearTimeout(ed.waitTimer);
    setDeleting(tile, false);
    if (res.state === "done") {
      exitEdit();
      if (tile) tile.classList.add("removing");
      toast(app.name + " deleted");
      refreshApps(true);
    } else if (res.state === "cancelled") {
      exitEdit();
    } else {
      exitEdit();
      toast(res.errorText || ("Couldn't delete " + app.name), true);
    }
  }

  function startDelete() {
    setDeleting(ed.tile, true);
    if (typeof window.PalmServiceBridge === "undefined") {
      setTimeout(function () { finishDelete({ state: "done" }); }, 1200);
      return;
    }
    luna(SERVICE + "/uninstall", { id: resolveId(ed.app) }, function (res) {
      finishDelete(res && res.returnValue ? { state: "done" } : { state: "error", errorText: res && res.errorText });
    }, 70000);
  }

  /* Show LG's popup. Its buttons reopen this app with the answer
     (see handleDeleteAnswer). */
  function askDelete() {
    if (!ed.on || ed.busy) return;
    ed.busy = true;
    if (typeof window.PalmServiceBridge === "undefined") { startDelete(); return; }
    luna(SERVICE + "/askDelete", { id: resolveId(ed.app), name: ed.app.name }, function (res) {
      if (!res || !res.returnValue) {
        finishDelete({ state: "error", errorText: (res && res.errorText) || "Couldn't show the popup" });
        return;
      }
      /* No answer in 5 minutes: give up quietly */
      ed.waitTimer = setTimeout(function () { finishDelete({ state: "cancelled" }); }, 300000);
    });
  }

  /* ----- Restart the TV (button next to Settings) ----- */
  function askRestart() {
    if (typeof window.PalmServiceBridge === "undefined") { toast("Preview: restart popup"); return; }
    luna(SERVICE + "/askRestart", {}, function (res) {
      if (!res || !res.returnValue) toast((res && res.errorText) || "Couldn't show the popup", true);
    });
  }

  function doRestart() {
    toast("Restarting the TV\u2026");
    luna(SERVICE + "/restart", {}, function (res) {
      if (!res || !res.returnValue) toast((res && res.errorText) || "Couldn't restart the TV", true);
    }, 30000);
  }

  /* Reopened by one of LG's popups:
       params.opentvDelete = { id, answer }   (delete an app)
       params.opentvRestart = true            (restart the TV) */
  function handleDeleteAnswer() {
    var p = {};
    try { p = JSON.parse(window.PalmSystem.launchParams || "{}") || {}; } catch (e) {}
    if (p.opentvRestart) {
      try { window.PalmSystem.launchParams = "{}"; } catch (e) {}
      doRestart();
      return true;
    }
    var d = p.opentvDelete;
    if (!d) return false;
    try { window.PalmSystem.launchParams = "{}"; } catch (e) {}
    if (!ed.on || !ed.busy || resolveId(ed.app) !== d.id) return true;
    clearTimeout(ed.waitTimer);
    if (d.answer === "delete") startDelete();
    else finishDelete({ state: "cancelled" });
    return true;
  }

  /* OK on a tile: open on release, or edit mode if held */
  function tileEnterDown(e) {
    if (e.repeat || pressTimer) return;
    pressHandled = false;
    pressTimer = setTimeout(function () {
      pressTimer = null;
      pressHandled = true;
      enterEdit();
    }, LONG_PRESS_MS);
  }

  document.addEventListener("keyup", function (e) {
    if (e.keyCode !== KEY.ENTER) return;
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
      if (!pressHandled && !ed.on && topFocus < 0) launch(rows[focus.row][focus.col]);
    }
  });

  /* ---------- Input ---------- */
  document.addEventListener("keydown", function (e) {
    if (rc.open) {
      if (recentsKey(e.keyCode)) e.preventDefault();
      return;
    }
    if (lsOpen) {
      if (settingsKey(e.keyCode)) e.preventDefault();
      return;
    }
    if (ed.on) {
      if (editKey(e)) { e.preventDefault(); return; }
    }
    if (e.keyCode === KEY.BACK || e.keyCode === KEY.ESC || e.keyCode === KEY.BACKSPACE) {
      var now = Date.now();
      if (now - lastBack < 600) {
        lastBack = 0;
        openRecents();
        e.preventDefault();
        return;
      }
      lastBack = now;
    }
    /* Holding an arrow: one step every 110 ms, so the animation keeps up */
    if (e.repeat && e.keyCode >= KEY.LEFT && e.keyCode <= KEY.DOWN) {
      var t = Date.now();
      if (t - lastMoveAt < 110) { e.preventDefault(); return; }
      lastMoveAt = t;
    } else if (e.keyCode >= KEY.LEFT && e.keyCode <= KEY.DOWN) {
      lastMoveAt = Date.now();
    }
    switch (e.keyCode) {
      case KEY.LEFT:  move("left");  break;
      case KEY.RIGHT: move("right"); break;
      case KEY.UP:    move("up");    break;
      case KEY.DOWN:  move("down");  break;
      case KEY.ENTER:
        if (topFocus >= 0) { if (!e.repeat) launchTopBtn(); }
        else { tileEnterDown(e); }
        break;
      case KEY.BACK:
      case KEY.ESC:
      case KEY.BACKSPACE:
        if (topFocus >= 0) goHome();
        else if (focus.row === 1) goHome();
        break;
      default: return;
    }
    e.preventDefault();
  });

  /* When reopened while already running (Home button, wake), webOS only
     sends this event; the app must bring itself to the front. */
  document.addEventListener("webOSRelaunch", function () {
    try { if (window.PalmSystem && window.PalmSystem.activate) window.PalmSystem.activate(); } catch (e) {}
    /* Answer from the delete popup: stay where we are */
    if (handleDeleteAnswer()) return;
    closeRecents();
    closeLauncherSettings();
    exitEdit();
    goHome();
    refreshApps();
  });
  document.addEventListener("visibilitychange", function () {
    updatePerfTimer();
    if (!document.hidden) { updateClock(); goHome(); refreshApps(); loadSettings(); }
    else { closeRecents(); closeLauncherSettings(); if (!ed.busy) exitEdit(); }
  });

  /* ---------- Clock, toast, scaling ---------- */
  function updateClock() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    document.getElementById("clock").textContent =
      h + ":" + (m < 10 ? "0" : "") + m + " " + ampm;
  }

  var toastTimer = null;
  function toast(text, isError) {
    var t = document.getElementById("toast");
    t.textContent = text;
    t.classList.toggle("error", !!isError);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  /* The design is 1920x1080. Scale it to fit the screen, then let the stage
     fill any leftover space (4:3, 21:9, ...) so there are no black bars:
     the banner, top bar and panels stretch, the rows stay in place. */
  var stageW = 1920;
  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    var s = Math.min(w / 1920, h / 1080);
    var stage = document.getElementById("stage");
    stageW = Math.round(w / s);
    stage.style.width = stageW + "px";
    stage.style.height = Math.round(h / s) + "px";
    stage.style.left = "0px";
    stage.style.top = "0px";
    stage.style.transform = Math.abs(s - 1) < 0.001 ? "" : "scale(" + s + ")";
  }
  window.addEventListener("resize", function () { fit(); colsCache = 0; });

  /* ---------- Discover installed apps ---------- */

  /*
   * Build a local icon URL from the app id.
   * sync-icons.sh copies every app's icon into icons/<appid>.<ext>
   * inside the launcher directory. We try .png first.
   */
  function localIcon(appId) {
    return "icons/" + appId + ".png";
  }

  /*
   * list: [{ id, title, color, icon }] written by sync-icons.js on the TV
   * (window.INSTALLED_APPS), or launch points from Luna as a fallback.
   */
  /* "Hide LG TV apps" off (default): every app is shown. On: LG's built-in
     apps are hidden, except the ones listed in apps.js (showLgApps: Browser
     and Apps) and HDMI inputs. */
  function isHiddenLg(id) {
    if (settings.showLgApps) return false;
    var keep = cfg.showLgApps || [];
    if (keep.indexOf(id) >= 0) return false;
    if (/^com\.webos\.app\.hdmi\d$/.test(id)) return false;
    return /^(com\.webos\.|com\.palm\.|com\.lge\.|webos\.)/.test(id);
  }

  function copyApp(a) { var o = {}; for (var k in a) o[k] = a[k]; return o; }

  function applyInstalled(list) {
    if (!list || !list.length) return;
    installed = {};
    list.forEach(function (a) { installed[a.id] = a; });

    /* All Apps: favourites (dock), then the rest of apps.js, then every
       other installed app. Hidden: not installed, LG's own apps, ourselves. */
    var all = [];
    var byId = {};
    function add(app, fav) {
      var id = resolveId(app);
      if (!id || id === SELF_ID || isHiddenLg(id) || byId[id]) return;
      var a = installed[id];
      if (a && a.icon !== false) {
        app.iconUrl = localIcon(id);
        app.iconFill = true;
        /* Tile background matches the icon's own background colour */
        if (a.color) app.color = a.color;
      }
      app.fav = !!fav;
      all.push(app);
      app.ids.forEach(function (i) { byId[i] = app; });
    }
    cfg.dock.forEach(function (a) { add(copyApp(a), true); });
    cfg.more.forEach(function (a) { add(copyApp(a), false); });
    list.forEach(function (a) {
      add({ name: a.title || a.id, ids: [a.id], color: a.color || "#2C2C2E" }, false);
    });

    /* Recent: newest first, then favourites and other apps to reach 6 */
    var recent = [];
    var taken = [];
    function take(app) {
      if (!app || taken.indexOf(app) >= 0) return;
      taken.push(app);
      recent.push(app);
    }
    (window.RECENT_APPS || []).forEach(function (id) {
      if (recent.length < RECENT_MAX) take(byId[id]);
    });
    all.forEach(function (app) { if (recent.length < RECENT_MIN && app.fav) take(app); });
    all.forEach(function (app) { if (recent.length < RECENT_MIN) take(app); });

    rows = [recent, all];
    if (focus.col >= rows[focus.row].length) focus.col = 0;
    render();
  }

  var SERVICE = "luna://com.opentvlauncher.lg.service";

  function loadInstalled() {
    /* Instant: the list saved at the last sync */
    if (window.INSTALLED_APPS && window.INSTALLED_APPS.length) {
      applyInstalled(window.INSTALLED_APPS);
    }
    /* Fresh: the root service copies icons for newly installed apps
       and returns the current list */
    refreshApps();
  }

  var refreshing = false;
  var lastRefresh = 0;
  /* force: after an uninstall. Otherwise at most once every 3 seconds. */
  function refreshApps(force) {
    if (refreshing) return;
    if (!force && Date.now() - lastRefresh < 3000) return;
    lastRefresh = Date.now();
    refreshing = true;
    luna(SERVICE + "/apps", {}, function (res) {
      refreshing = false;
      if (res && res.returnValue && res.apps) {
        var before = JSON.stringify([window.INSTALLED_APPS || [], window.RECENT_APPS || []]);
        window.INSTALLED_APPS = res.apps;
        window.RECENT_APPS = res.recent || [];
        if (JSON.stringify([res.apps, window.RECENT_APPS]) !== before) applyInstalled(res.apps);
        return;
      }
      /* No root yet: still pick up the recent list */
      luna(SERVICE + "/recent", {}, function (r) {
        if (!r || !r.returnValue || !r.recent) return;
        if (JSON.stringify(r.recent) === JSON.stringify(window.RECENT_APPS || [])) return;
        window.RECENT_APPS = r.recent;
        if (window.INSTALLED_APPS && window.INSTALLED_APPS.length) applyInstalled(window.INSTALLED_APPS);
      });
      /* Service unavailable: ask the system directly as a last resort */
      if (!window.INSTALLED_APPS || !window.INSTALLED_APPS.length) {
        luna("luna://com.webos.applicationManager/listLaunchPoints", {}, function (r) {
          if (!r || !r.launchPoints) return;
          applyInstalled(r.launchPoints.map(function (lp) {
            return { id: lp.id, title: lp.title, color: lp.iconColor, icon: true };
          }));
        });
      }
    });
  }

  /* Placeholder tiles while the app list is loading (first start after
     installing, before any icons were copied) */
  function renderSkeleton() {
    document.body.classList.add("apps-loading");
    [6, 10].forEach(function (n, r) {
      var frag = document.createDocumentFragment();
      for (var i = 0; i < n; i++) {
        var t = document.createElement("div");
        t.className = "tile skeleton";
        t.innerHTML = '<div class="tile-box"></div><div class="tile-name"></div>';
        frag.appendChild(t);
      }
      rowEls[r].textContent = "";
      rowEls[r].appendChild(frag);
    });
  }

  /* ---------- Start ---------- */
  document.getElementById("profile").textContent = cfg.profileInitial || "";
  fit();
  updateClock();
  setInterval(function () { if (!document.hidden) updateClock(); }, 10000);
  if (window.INSTALLED_APPS && window.INSTALLED_APPS.length) {
    loadInstalled();
  } else {
    renderSkeleton();
    loadInstalled();
    /* Still nothing after 8 seconds: show the apps from apps.js */
    setTimeout(function () {
      if (!installed) { rows = freshRows(); render(); }
    }, 8000);
  }
  loadSettings();
  /* boot.js: started fine, no fallback to LG's home needed */
  window.__launcherReady = true;
})();
