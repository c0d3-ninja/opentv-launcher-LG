'use strict';
/*
 * primeconfig.js - builds the Prime Video (Ignition) launch config that routes the app
 * through pvproxy. The app's own default_config.json is kept and two options are added:
 *
 *   "http-proxy-server": "127.0.0.1:<port>"   send the app's traffic through pvproxy
 *   "disable-ssl-cert": true                   accept pvproxy's local certificate
 *
 * Usage: node primeconfig.js <original default_config.json> <output file> <port>
 * The original may be missing; it is then treated as {}.
 */
var fs = require('fs');

var src = process.argv[2];
var out = process.argv[3];
var port = Number(process.argv[4]) || 8888;

if (!out) {
  console.error('usage: node primeconfig.js <original> <output> <port>');
  process.exit(2);
}

var cfg = {};
try {
  var text = fs.readFileSync(src, 'utf8');
  var parsed = JSON.parse(text);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cfg = parsed;
} catch (e) {
  // missing or unreadable original: start from an empty config
}

cfg['http-proxy-server'] = '127.0.0.1:' + port;
cfg['disable-ssl-cert'] = true;

fs.writeFileSync(out, JSON.stringify(cfg, null, 4) + '\n');
