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
  function luna(uri, params, cb) {
    if (typeof window.PalmServiceBridge === "undefined") {
      if (cb) cb({ returnValue: false, errorText: "preview" });
      return;
    }
    var b = new window.PalmServiceBridge();
    bridges.push(b);
    b.onservicecallback = function (msg) {
      var res = {};
      try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false }; }
      var idx = bridges.indexOf(b);
      if (idx >= 0) bridges.splice(idx, 1);
      if (cb) cb(res);
    };
    b.call(uri, JSON.stringify(params || {}));
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
      if (!res || res.returnValue === false) toast("Couldn't open " + app.name);
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

    tile.addEventListener("mouseenter", function () { setFocus(r, c); });
    tile.addEventListener("click", function () { setFocus(r, c); launch(app); });
    return tile;
  }

  function render() {
    for (var r = 0; r < rows.length; r++) {
      var el = rowEls[r];
      while (el.firstChild) el.removeChild(el.firstChild);
      for (var c = 0; c < rows[r].length; c++) {
        el.appendChild(buildTile(rows[r][c], r, c));
      }
    }
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
    document.getElementById("btnNotif"),
    document.getElementById("btnLgHome"),
    document.getElementById("btnSearch"),
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
    var appId = topBarActions[btn.id];
    if (appId) {
      if (typeof window.PalmServiceBridge === "undefined") {
        toast("Would open " + (btn.getAttribute("aria-label") || btn.id));
      } else {
        luna("luna://com.webos.applicationManager/launch", { id: appId }, function (res) {
          if (!res || res.returnValue === false) toast("Couldn't open " + btn.id);
        });
      }
    }
  }

  topBtns.forEach(function (btn, idx) {
    if (!btn) return;
    btn.addEventListener("mouseenter", function () { setTopFocus(idx); });
    btn.addEventListener("click", function () { setTopFocus(idx); launchTopBtn(); });
  });

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

  function moreColumns() {
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
    drawRecents();
    if (typeof window.PalmServiceBridge === "undefined") {
      rc.items = (rows[0] || []).slice(0, 5).map(function (a) { return { id: a.ids[0], title: a.name, image: "" }; });
      rc.part = "card";
      drawRecents();
      return;
    }
    luna(SERVICE + "/recents", {}, function (res) {
      if (!rc.open) return;
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

  /* ---------- Input ---------- */
  document.addEventListener("keydown", function (e) {
    if (rc.open) {
      if (recentsKey(e.keyCode)) e.preventDefault();
      return;
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
    switch (e.keyCode) {
      case KEY.LEFT:  move("left");  break;
      case KEY.RIGHT: move("right"); break;
      case KEY.UP:    move("up");    break;
      case KEY.DOWN:  move("down");  break;
      case KEY.ENTER:
        if (topFocus >= 0) { launchTopBtn(); }
        else { launch(rows[focus.row][focus.col]); }
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
    closeRecents();
    goHome();
    refreshApps();
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) { updateClock(); goHome(); refreshApps(); }
    else closeRecents();
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
  function toast(text) {
    var t = document.getElementById("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    var stage = document.getElementById("stage");
    if (Math.abs(s - 1) < 0.01) {
      stage.style.transform = "";
      stage.style.left = "0px";
      stage.style.top = "0px";
    } else {
      stage.style.transform = "scale(" + s + ")";
      stage.style.left = (window.innerWidth - 1920 * s) / 2 + "px";
      stage.style.top = (window.innerHeight - 1080 * s) / 2 + "px";
    }
  }
  window.addEventListener("resize", fit);

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
  /* LG's built-in apps are hidden, except the ones listed in apps.js (showLgApps)
     and HDMI inputs. */
  function isHiddenLg(id) {
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
  function refreshApps() {
    if (refreshing) return;
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

  /* ---------- Start ---------- */
  document.getElementById("profile").textContent = cfg.profileInitial || "";
  fit();
  updateClock();
  setInterval(updateClock, 10000);
  render();
  loadInstalled();
})();
