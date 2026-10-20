'use strict';
/*
 * pvproxy.js - on-device proxy that removes Prime Video ads on LG webOS TVs.
 *
 * The Prime Video app (Amazon "Ignition" engine) is pointed at this proxy through the
 * "http-proxy-server" option in its default_config.json. The proxy applies the same
 * edits the uBlock Origin / AdGuard filter lists make in a browser, but to the network data:
 *
 *  Responses of Get(Vod)PlaybackResources:
 *    - intraTitlePlaylist[].shouldShowOnScrubBar  -> removed  (ad markers on the progress bar)
 *    - playbackUrls.pauseBehavior, pauseAdsResolution -> removed (pause ads)
 *    - cuepointPlaylist, ...cuepoints, ads            -> removed (ad cue points)
 *    - intraTitlePlaylist entries of type "Remote"    -> removed (the ad breaks)
 *  Requests:
 *    - .../getVideoAds and .../getAds                 -> blocked
 *    - deviceAdInsertionTypeOverride parameter        -> removed
 *    - "CuepointPlaylist" in requested resources      -> removed
 *
 * Certificates: the app is started with "disable-ssl-cert", so it no longer checks
 * certificates itself. To keep every connection safe, this proxy terminates ALL of the
 * app's HTTPS connections and opens its own connection to the real server, which Node.js
 * verifies against the system's trusted certificate authorities. A server with a bad
 * certificate is refused (502), exactly as the app would have done. Only playback
 * responses are edited; everything else, including the video stream, is passed through.
 *
 * Fail-open: anything that cannot be parsed or edited is passed through unchanged.
 *
 * Compatible with Node.js 8 and newer (webOS 4.x and later).
 *
 * Environment:
 *   PROXY_PORT      listen port (default 8888)
 *   PROXY_BIND      listen address (default 127.0.0.1)
 *   TLS_KEY         path to the TLS key (default: key.pem next to this file)
 *   TLS_CERT        path to the TLS certificate (default: cert.pem next to this file)
 *   REMOVE_REMOTE   set to 0 to keep "Remote" playlist entries (uBlock-only edits)
 *   PIDFILE         optional path to write the process id to
 *   PLAIN_PORTS     CONNECT ports passed through without TLS, separated by "," (default 80)
 *   NODE_EXTRA_CA_CERTS  Node.js's own setting: a certificate authority file to trust on top
 *                   of Node.js's built-in list. ctl.sh sets it to the TV's list
 *                   (/etc/ssl/certs/ca-certificates.crt), so older TVs with an old Node.js
 *                   still know newer authorities.
 *
 * Exit code 3 means Amazon's certificates kept being refused; ctl.sh then gives
 * Prime Video back its normal settings (the app checks certificates itself again).
 */
var http = require('http');
var https = require('https');
var net = require('net');
var tls = require('tls');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var URL = require('url').URL;

var PORT = Number(process.env.PROXY_PORT) || 8888;
var BIND = process.env.PROXY_BIND || '127.0.0.1';
var REMOVE_REMOTE = process.env.REMOVE_REMOTE !== '0';
var PLAIN_PORTS = (process.env.PLAIN_PORTS || '80').split(',').map(Number);

var PLAYBACK_RES = /Get(Vod)?PlaybackResources/i;
var AD_REQUEST = /\/(getVideoAds|getAds)(\?|$|\/)/i;
var LOG_PATHS = /getVideoAds|getAds|PlaybackResources/i;
var IDLE_TIMEOUT_MS = 60000;
var HOP_HEADERS = ['proxy-connection', 'proxy-authorization', 'keep-alive', 'upgrade', 'te', 'trailer'];

/* Trusted certificate authorities: Node.js's built-in list, plus the file in
   NODE_EXTRA_CA_CERTS (the TV's list, set by ctl.sh). Node.js reads it at start-up. */
var EXTRA_CA = process.env.NODE_EXTRA_CA_CERTS || '';

/* Connections to the real servers are reused (keep-alive), so the extra TLS handshake
   only happens once per server, not once per video segment. */
var agents = {
  http: new http.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8 }),
  https: new https.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8, rejectUnauthorized: true })
};

/* Certificate safety net: if Amazon's servers keep being refused and none is accepted,
   the TV can't verify them (for example an outdated list). Stop with exit code 3 so
   ctl.sh gives Prime Video back its normal settings, instead of the app failing forever.
   Only Amazon's own servers count: one other server with a bad certificate (telemetry,
   a third-party service) is refused as usual but never switches the proxy off. */
var CERT_FAIL_LIMIT = 6;
var CERT_WINDOW_MS = 120000;
var AMAZON_HOSTS = /(^|\.)(primevideo\.com|amazonvideo\.com|amazon\.dev|amazon\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2}))$/i;
var certFails = [];
var lastCertOk = 0;
function isCertHost(host) { return AMAZON_HOSTS.test(host || ''); }
function certOk(host) {
  if (!module.exports.isCertHost(host)) return;
  lastCertOk = Date.now(); certFails = [];
}
function certRefused(host) {
  if (!module.exports.isCertHost(host)) return;
  var now = Date.now();
  certFails = certFails.filter(function (t) { return now - t < CERT_WINDOW_MS; });
  certFails.push(now);
  if (certFails.length >= CERT_FAIL_LIMIT && now - lastCertOk > CERT_WINDOW_MS) {
    log('[cert] ' + certFails.length + ' Amazon certificates refused in a row (last: ' + host + ');' +
      ' giving Prime Video back its normal settings');
    if (module.exports.onCertGiveUp) module.exports.onCertGiveUp();
  }
}

function log() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift(new Date().toISOString());
  console.log(args.join(' '));
}

/* ---------------- edits ---------------- */

function del(obj, key, label, changes) {
  if (obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key)) {
    delete obj[key];
    changes.push(label);
  }
}

function editPlaybackJson(text, removeRemote) {
  if (removeRemote === undefined) removeRemote = REMOVE_REMOTE;
  var j;
  try { j = JSON.parse(text); } catch (e) { return { error: 'not JSON' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { error: 'not an object' };
  var changes = [];

  del(j, 'cuepointPlaylist', 'cuepointPlaylist', changes);
  del(j, 'ads', 'ads', changes);

  var vpu = j.vodPlaybackUrls && j.vodPlaybackUrls.result && j.vodPlaybackUrls.result.playbackUrls;
  del(vpu, 'cuepoints', 'vodPlaybackUrls.cuepoints', changes);

  var pu = j.vodPlaylistedPlaybackUrls && j.vodPlaylistedPlaybackUrls.result &&
    j.vodPlaylistedPlaybackUrls.result.playbackUrls;
  if (pu && typeof pu === 'object') {
    del(pu, 'pauseBehavior', 'pauseBehavior', changes);
    del(pu, 'pauseAdsResolution', 'pauseAdsResolution', changes);
    del(pu, 'cuepoints', 'playlisted.cuepoints', changes);
    if (Array.isArray(pu.intraTitlePlaylist)) {
      var flags = 0;
      pu.intraTitlePlaylist.forEach(function (item) {
        if (item && typeof item === 'object' && 'shouldShowOnScrubBar' in item) {
          delete item.shouldShowOnScrubBar;
          flags++;
        }
      });
      if (flags) changes.push('shouldShowOnScrubBar x' + flags);
      if (removeRemote) {
        var before = pu.intraTitlePlaylist.length;
        var kept = pu.intraTitlePlaylist.filter(function (x) { return !(x && x.type === 'Remote'); });
        var hasMain = kept.some(function (x) { return x && x.type === 'Main'; });
        // Only drop ad entries when the actual programme is still there.
        if (hasMain && kept.length < before) {
          pu.intraTitlePlaylist = kept;
          changes.push('Remote ad break x' + (before - kept.length));
        }
      }
    }
  }
  if (!changes.length) return { changes: changes, body: null, keys: Object.keys(j) };
  return { changes: changes, body: JSON.stringify(j) };
}

/* "A,CuepointPlaylist,B" -> "A,B" (also with %2C). A list of only CuepointPlaylist is kept. */
function stripCuepoint(value) {
  var m = value.match(/,|%2C/i);
  if (!m) return value;
  var parts = value.split(/,|%2C/i);
  var kept = parts.filter(function (p) { return !/^CuepointPlaylist$/i.test(p); });
  return kept.length && kept.length < parts.length ? kept.join(m[0]) : value;
}

/* key=value&key=value: drop deviceAdInsertionTypeOverride, clean CuepointPlaylist lists */
function cleanQuery(query) {
  return query.split('&')
    .filter(function (kv) { return kv && !/^deviceAdInsertionTypeOverride(=|$)/i.test(kv); })
    .map(function (kv) {
      var i = kv.indexOf('=');
      return i < 0 ? kv : kv.slice(0, i + 1) + stripCuepoint(kv.slice(i + 1));
    })
    .join('&');
}

function rewritePath(p) {
  var q = p.indexOf('?');
  if (q < 0) return p;
  var query = cleanQuery(p.slice(q + 1));
  return query ? p.slice(0, q) + '?' + query : p.slice(0, q);
}

function rewriteBody(text) {
  var t = text.replace(/^\s+/, '');
  if (t.charAt(0) === '{') {
    var j;
    try { j = JSON.parse(text); } catch (e) { return text; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return text;
    var changed = false;
    if (Object.prototype.hasOwnProperty.call(j, 'deviceAdInsertionTypeOverride')) {
      delete j.deviceAdInsertionTypeOverride;
      changed = true;
    }
    Object.keys(j).forEach(function (k) {
      if (typeof j[k] === 'string') {
        var v = stripCuepoint(j[k]);
        if (v !== j[k]) { j[k] = v; changed = true; }
      }
    });
    return changed ? JSON.stringify(j) : text;
  }
  if (/=/.test(text) && !/\s/.test(text.trim())) return cleanQuery(text);
  return text;
}

function decode(buf, enc) {
  switch ((enc || '').toLowerCase()) {
    case 'gzip': return zlib.gunzipSync(buf);
    case 'deflate': return zlib.inflateSync(buf);
    case 'br':
      if (!zlib.brotliDecompressSync) throw new Error('brotli not supported by this Node.js');
      return zlib.brotliDecompressSync(buf);
    case '': case 'identity': return buf;
    default: throw new Error('unknown encoding ' + enc);
  }
}

/* ---------------- forwarding ---------------- */

function readAll(stream, cb) {
  var chunks = [];
  var done = false;
  stream.on('data', function (c) { chunks.push(c); });
  stream.on('end', function () { if (!done) { done = true; cb(null, Buffer.concat(chunks)); } });
  stream.on('error', function (e) { if (!done) { done = true; cb(e); } });
}

function fail(res, code) {
  try {
    if (!res.headersSent) res.writeHead(code || 502, { 'content-length': 0 });
    res.end();
  } catch (e) { /* ignore */ }
}

/* Where a request goes: the CONNECT target for decrypted HTTPS, the absolute URL otherwise */
function target(req) {
  var t = req.socket && req.socket.otvTarget;
  if (t) return { secure: true, hostname: t.host, port: t.port, path: req.url };
  var u;
  try { u = new URL(req.url); } catch (e) { return null; }
  if (u.protocol !== 'http:') return null;
  return { secure: false, hostname: u.hostname, port: Number(u.port) || 80, path: u.pathname + u.search };
}

function forward(req, res) {
  var t = target(req);
  if (!t) return fail(res, 400);
  var hostname = t.hostname, port = t.port, reqPath = t.path, secure = t.secure;

  if (LOG_PATHS.test(reqPath)) log('[req]', req.method, hostname + reqPath.split('?')[0]);

  if (AD_REQUEST.test(reqPath)) {
    log('[block]', hostname + reqPath.split('?')[0]);
    req.resume();
    res.writeHead(403, { 'content-type': 'text/plain', 'content-length': 0 });
    return res.end();
  }

  var headers = Object.assign({}, req.headers);
  HOP_HEADERS.forEach(function (h) { delete headers[h]; });
  var isPR = PLAYBACK_RES.test(reqPath);

  var finished = false;
  var up = null;
  res.on('finish', function () { finished = true; });
  res.on('close', function () { if (!finished && up) up.abort(); }); // the app gave up: stop the download too

  function send(body) {
    var opts = {
      hostname: hostname, port: port, path: reqPath, method: req.method, headers: headers,
      agent: secure ? agents.https : agents.http
    };
    if (secure) opts.servername = net.isIP(hostname) ? undefined : hostname;
    up = (secure ? https : http).request(opts, function (ur) {
      if (secure) certOk(hostname);
      if (!isPR) {
        res.writeHead(ur.statusCode, ur.headers);
        ur.pipe(res);
        return;
      }
      readAll(ur, function (err, raw) {
        if (err) { log('[pv] response read failed:', err.message); return fail(res); }
        var h = Object.assign({}, ur.headers);
        var out = raw;
        try {
          var r = editPlaybackJson(decode(raw, ur.headers['content-encoding']).toString('utf8'));
          if (r.error) log('[pv] left unchanged:', r.error);
          else if (!r.body) log('[pv] nothing to remove; top keys:', (r.keys || []).join(','));
          else {
            out = Buffer.from(r.body, 'utf8');
            delete h['content-encoding'];
            log('[pv] removed:', r.changes.join(', '));
          }
        } catch (e) {
          out = raw; // fail open
          log('[pv] edit failed, original passed through:', e.message);
        }
        delete h['transfer-encoding'];
        h['content-length'] = out.length;
        res.writeHead(ur.statusCode, h);
        res.end(out);
      });
    });
    up.setTimeout(IDLE_TIMEOUT_MS, function () {
      log('[timeout]', hostname);
      up.abort();
    });
    up.on('error', function (e) {
      if (/certificate|self.signed|unable to verify|altnames|CERT_/i.test(e.message + ' ' + (e.code || ''))) {
        log('[cert] refused', hostname + ':', e.message);
        certRefused(hostname);
      } else if (!finished) {
        log('[upstream error]', hostname, e.message);
      }
      fail(res);
    });
    if (body) up.end(body);
    else req.pipe(up);
  }

  if (!isPR) return send(null);

  /* Node.js before 10.16 / 11.7 can't unpack Brotli. Ask for gzip on this one request,
     so the playback data can still be edited on older TVs. */
  if (!zlib.brotliDecompressSync && /\bbr\b/i.test(headers['accept-encoding'] || '')) {
    headers['accept-encoding'] = 'gzip, deflate';
  }

  try {
    var np = rewritePath(reqPath);
    if (np !== reqPath) { log('[pv] request params cleaned'); reqPath = np; }
  } catch (e) { log('[pv] path rewrite skipped:', e.message); }

  readAll(req, function (err, body) {
    if (err) { log('[pv] request body read failed:', err.message); return fail(res); }
    var enc = (headers['content-encoding'] || '').toLowerCase();
    if (body.length && (enc === '' || enc === 'identity')) {
      var s = body.toString('utf8');
      var ns = rewriteBody(s);
      if (ns !== s) { body = Buffer.from(ns, 'utf8'); log('[pv] request body cleaned'); }
    }
    headers['content-length'] = body.length;
    delete headers['transfer-encoding'];
    send(body);
  });
}

/* WebSocket and other upgrades: connect to the real server (verified), then pass bytes */
function upgrade(req, sock, head) {
  var t = target(req);
  sock.on('error', function () {});
  if (!t) return sock.destroy();
  var lines = [req.method + ' ' + t.path + ' HTTP/1.1'];
  for (var i = 0; i < req.rawHeaders.length; i += 2) {
    if (!/^proxy-/i.test(req.rawHeaders[i])) lines.push(req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1]);
  }
  var connected = function () {
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  };
  var up = t.secure
    ? tls.connect({ host: t.hostname, port: t.port, servername: net.isIP(t.hostname) ? undefined : t.hostname }, connected)
    : net.connect(t.port, t.hostname, connected);
  up.on('error', function (e) { log('[upgrade error]', t.hostname, e.message); sock.destroy(); });
  sock.on('close', function () { up.destroy(); });
}

/* ---------------- servers ---------------- */

function start(tlsOpts, port, bind) {
  port = port || PORT;
  bind = bind || BIND;
  var ctx = tls.createSecureContext({ key: tlsOpts.key, cert: tlsOpts.cert });

  var server = http.createServer(function (req, res) {
    try { forward(req, res); } catch (e) { log('[forward]', e.message); fail(res); }
  });
  server.on('upgrade', function (req, sock, head) {
    try { upgrade(req, sock, head); } catch (e) { log('[upgrade]', e.message); sock.destroy(); }
  });
  server.on('clientError', function (e, s) { s.destroy(); });

  /* Each server is logged once (the list is cleared when it gets long) */
  var seen = {};
  var seenCount = 0;
  function firstTime(key) {
    if (seen[key]) return false;
    if (++seenCount > 500) { seen = {}; seenCount = 1; }
    seen[key] = true;
    return true;
  }
  server.on('connect', function (req, sock, head) {
    var i = req.url.lastIndexOf(':');
    var host = i > 0 ? req.url.slice(0, i) : req.url;
    var p = i > 0 ? Number(req.url.slice(i + 1)) || 443 : 443;
    host = host.replace(/^\[|\]$/g, '');
    sock.on('error', function () {});
    sock.setTimeout(0);

    if (PLAIN_PORTS.indexOf(p) < 0) {
      /* HTTPS: answer the app ourselves, then fetch from the real (verified) server */
      if (firstTime(host)) log('[https]', host);
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) sock.unshift(head);
      var ts = new tls.TLSSocket(sock, { isServer: true, secureContext: ctx });
      ts.otvTarget = { host: host, port: p };
      ts.on('error', function (e) { log('[tls]', host, e.message); ts.destroy(); });
      server.emit('connection', ts);
      return;
    }

    /* Plain HTTP port (80): pass it through, there is no certificate to verify */
    if (firstTime(host + ':' + p)) log('[tunnel]', host + ':' + p);
    var up = net.connect(p, host, function () {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(sock);
      sock.pipe(up);
    });
    up.on('error', function () {
      try { sock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch (e) { sock.destroy(); }
    });
    sock.on('close', function () { up.destroy(); });
  });

  server.listen(port, bind, function () {
    log('pvproxy listening on ' + bind + ':' + port + ' (remove Remote: ' + REMOVE_REMOTE + ', verifying all HTTPS' +
      (EXTRA_CA ? ', also trusting ' + EXTRA_CA : '') + ')');
  });
  return server;
}

module.exports = {
  editPlaybackJson: editPlaybackJson,
  rewritePath: rewritePath,
  rewriteBody: rewriteBody,
  stripCuepoint: stripCuepoint,
  decode: decode,
  start: start,
  onCertGiveUp: null,
  isCertHost: isCertHost,
  _resetCertState: function () { certFails = []; lastCertOk = 0; } // for the tests
};

if (require.main === module) {
  process.on('uncaughtException', function (e) { log('[uncaught]', (e && e.stack) || e); });
  process.on('unhandledRejection', function (e) { log('[unhandled]', (e && e.stack) || e); });
  if (process.env.PIDFILE) {
    try { fs.writeFileSync(process.env.PIDFILE, String(process.pid)); } catch (e) { /* ignore */ }
  }
  var keyPath = process.env.TLS_KEY || path.join(__dirname, 'key.pem');
  var certPath = process.env.TLS_CERT || path.join(__dirname, 'cert.pem');
  var tlsOpts;
  try {
    tlsOpts = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  } catch (e) {
    log('cannot read TLS key/certificate (' + keyPath + ', ' + certPath + '): ' + e.message);
    process.exit(2);
  }
  module.exports.onCertGiveUp = function () { process.exit(3); };
  start(tlsOpts);
}
