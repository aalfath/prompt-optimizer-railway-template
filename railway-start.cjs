'use strict';
// Railway wrapper for Prompt Optimizer: writes the nginx and browser config, then runs
// nginx, the upstream MCP server and a small health/WebDAV helper. If any process stops,
// the container exits non-zero so Railway's ON_FAILURE restart policy brings it back.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const env = process.env;
const log = (m) => console.log('[railway] ' + m);
const die = (m) => { console.error('[railway] ERROR: ' + m); process.exit(1); };

const PORT = String(env.PORT || '8080');
const HELPER_PORT = 3001;
const MCP_PORT = 3000;
const DATA_DIR = env.DATA_DIR || '/data';
const DAV_ROOT = path.join(DATA_DIR, 'webdav');
const HTML = '/usr/share/nginx/html';

// ---- 1. Access protection: never start an open instance --------------------------------
const user = (env.ACCESS_USERNAME || 'admin').trim() || 'admin';
const password = env.ACCESS_PASSWORD || '';
if (password.length < 8) die('ACCESS_PASSWORD must be set (8+ characters); refusing to start without a login.');
const mcpToken = (env.MCP_AUTH_TOKEN || '').replace(/[^A-Za-z0-9]/g, '');
if (mcpToken.length < 16) die('MCP_AUTH_TOKEN must have at least 16 letters or digits; refusing to start with /mcp open.');

fs.mkdirSync('/etc/nginx/auth', { recursive: true });
fs.mkdirSync('/etc/nginx/snippets', { recursive: true });
const hp = spawnSync('htpasswd', ['-i', '-c', '/etc/nginx/auth/htpasswd', user], { input: password });
if (hp.status !== 0) die('htpasswd failed: ' + String(hp.stderr || ''));
fs.chmodSync('/etc/nginx/auth/htpasswd', 0o644);
fs.writeFileSync('/etc/nginx/snippets/auth.conf',
  'auth_basic "Prompt Optimizer";\nauth_basic_user_file /etc/nginx/auth/htpasswd;\n');

// ---- 2. LLM defaults (OpenAI-compatible "Custom" model) ---------------------------------
if (env.VITE_CUSTOM_API_KEY) {
  if (!env.VITE_CUSTOM_API_BASE_URL) env.VITE_CUSTOM_API_BASE_URL = 'https://api.openai.com/v1';
  if (!env.VITE_CUSTOM_API_MODEL) env.VITE_CUSTOM_API_MODEL = 'gpt-5.6-luna';
}
const providerKeys = Object.keys(env).filter((k) => /^VITE_.*(API_KEY|API_TOKEN)(_.+)?$/.test(k) && env[k].trim());

// ---- 3. Browser runtime config (served only behind the login) ----------------------------
const cfg = {};
for (const k of Object.keys(env).sort()) {
  if (k.startsWith('VITE_') && env[k]) { cfg[k] = env[k]; cfg[k.slice(5)] = env[k]; }
}
fs.writeFileSync(path.join(HTML, 'config.js'),
  '// Generated at container start from VITE_* variables\n' +
  'window.runtime_config = Object.assign({}, (window.runtime_config || {}), ' + JSON.stringify(cfg, null, 2) + ');\n');
log('config.js written with ' + Object.keys(cfg).length / 2 + ' VITE_* value(s) (values not logged)');

// ---- 4. nginx config -------------------------------------------------------------------
const tpl = fs.readFileSync('/etc/railway/nginx.conf.template', 'utf8');
fs.writeFileSync('/etc/nginx/http.d/default.conf',
  tpl.split('${PORT}').join(PORT).split('${MCP_EXPECTED}').join('Bearer ' + mcpToken));
const t = spawnSync('nginx', ['-t', '-q']);
if (t.status !== 0) die('nginx -t failed: ' + String(t.stderr || ''));

// ---- 5. WebDAV backup store on the volume ----------------------------------------------
try { fs.mkdirSync(DAV_ROOT, { recursive: true }); fs.accessSync(DAV_ROOT, fs.constants.W_OK); }
catch (e) { die('cannot write ' + DAV_ROOT + ': ' + e.message); }

// ---- 6. Processes ----------------------------------------------------------------------
const children = new Map();
let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children.values()) { try { c.kill('SIGTERM'); } catch (_) {} }
  setTimeout(() => process.exit(code), 4000).unref();
  const check = setInterval(() => { if ([...children.values()].every((c) => c.exitCode !== null || c.signalCode)) { clearInterval(check); process.exit(code); } }, 200);
}
function run(name, cmd, args, opts) {
  const c = spawn(cmd, args, Object.assign({ stdio: 'inherit' }, opts));
  children.set(name, c);
  c.on('exit', (code, sig) => {
    if (stopping) return;
    console.error('[railway] ' + name + ' stopped unexpectedly (code ' + code + ', signal ' + sig + '); exiting so Railway restarts the service');
    stopAll(1);
  });
  c.on('error', (e) => { console.error('[railway] ' + name + ': ' + e.message); stopAll(1); });
}
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { log('received ' + s + ', stopping'); stopAll(0); });

const mcpEnabled = providerKeys.length > 0;
if (mcpEnabled) {
  const mcpEnv = Object.assign({}, env, {
    NODE_ENV: 'production', NODE_PATH: '/app',
    NODE_OPTIONS: (env.MCP_NODE_OPTIONS || '--max-old-space-size=192'),
    MCP_LOG_LEVEL: env.MCP_LOG_LEVEL || 'info',
    MCP_DEFAULT_LANGUAGE: env.MCP_DEFAULT_LANGUAGE || 'en-US',
  });
  if (!env.MCP_DEFAULT_MODEL_PROVIDER && env.VITE_CUSTOM_API_KEY) mcpEnv.MCP_DEFAULT_MODEL_PROVIDER = 'custom';
  delete mcpEnv.PORT; delete mcpEnv.ACCESS_PASSWORD; delete mcpEnv.MCP_AUTH_TOKEN;
  run('mcp-server', 'node', ['-r', './preload-env.cjs', 'dist/start.cjs', '--transport=http', '--port=' + MCP_PORT],
    { cwd: '/app/mcp-server', env: mcpEnv });
} else {
  log('no LLM API key set: the web app works with keys entered in the browser, the MCP server stays off');
}

// ---- 7. Helper: /healthz and /dav (127.0.0.1 only; nginx adds the login) ----------------
function davPath(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch (_) { return null; }
  if (p.includes('\0') || !(p === '/dav' || p.startsWith('/dav/'))) return null;
  const rel = path.posix.normalize('/' + p.slice(4)).replace(/\/+$/, '');
  if (rel.split('/').includes('..')) return null;
  return { rel, abs: path.join(DAV_ROOT, rel) };
}
const enc = (rel, dir) => '/dav' + rel.split('/').map(encodeURIComponent).join('/') + (dir ? '/' : '');
const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function propEntry(rel, st) {
  const dir = st.isDirectory();
  return '<D:response><D:href>' + xmlEsc(enc(rel, dir)) + '</D:href><D:propstat><D:prop>' +
    '<D:resourcetype>' + (dir ? '<D:collection/>' : '') + '</D:resourcetype>' +
    (dir ? '' : '<D:getcontentlength>' + st.size + '</D:getcontentlength><D:getcontenttype>' + ctype(rel) + '</D:getcontenttype>') +
    '<D:getlastmodified>' + st.mtime.toUTCString() + '</D:getlastmodified>' +
    '<D:getetag>"' + etag(st) + '"</D:getetag>' +
    '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
}
const etag = (st) => st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16);
const ctype = (rel) => rel.endsWith('.json') ? 'application/json' : 'application/octet-stream';

function handleDav(req, res, p) {
  const send = (code, body, headers) => { res.writeHead(code, Object.assign({ 'Content-Length': Buffer.byteLength(body || '') }, headers || {})); res.end(body || ''); };
  let st = null;
  try { st = fs.statSync(p.abs); } catch (_) {}
  switch (req.method) {
    case 'OPTIONS':
      return send(200, '', { DAV: '1', Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, PROPFIND' });
    case 'GET': case 'HEAD':
      if (!st) return send(404, 'Not found');
      if (st.isDirectory()) return send(200, '', { 'Content-Type': 'text/plain' });
      res.writeHead(200, { 'Content-Length': st.size, 'Content-Type': ctype(p.rel), 'Last-Modified': st.mtime.toUTCString(), ETag: '"' + etag(st) + '"' });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(p.abs).pipe(res);
    case 'PUT': {
      if (st && st.isDirectory()) return send(409, 'Is a collection');
      fs.mkdirSync(path.dirname(p.abs), { recursive: true });
      const tmp = path.join(path.dirname(p.abs), '.upload-' + crypto.randomBytes(6).toString('hex'));
      const out = fs.createWriteStream(tmp);
      req.pipe(out);
      out.on('finish', () => { fs.renameSync(tmp, p.abs); send(st ? 204 : 201, ''); });
      out.on('error', (e) => { try { fs.unlinkSync(tmp); } catch (_) {} send(500, e.message); });
      return;
    }
    case 'DELETE':
      if (!st) return send(404, 'Not found');
      if (p.rel === '') return send(403, 'Refusing to delete the root');
      fs.rmSync(p.abs, { recursive: true, force: true });
      return send(204, '');
    case 'MKCOL':
      if (st) return send(405, 'Already exists');
      if (!fs.existsSync(path.dirname(p.abs))) return send(409, 'Parent missing');
      fs.mkdirSync(p.abs);
      return send(201, '');
    case 'PROPFIND': {
      if (!st) return send(404, 'Not found');
      let body = propEntry(p.rel, st);
      if (st.isDirectory() && String(req.headers.depth || '1') !== '0') {
        for (const name of fs.readdirSync(p.abs)) {
          if (name.startsWith('.upload-')) continue;
          try { body += propEntry(p.rel + '/' + name, fs.statSync(path.join(p.abs, name))); } catch (_) {}
        }
      }
      return send(207, '<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">' + body + '</D:multistatus>',
        { 'Content-Type': 'application/xml; charset=utf-8' });
    }
    default:
      return send(405, 'Method not allowed');
  }
}

const helper = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') {
    if (!mcpEnabled) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"status":"ok","mcp":"off"}'); }
    const r = http.get({ host: '127.0.0.1', port: MCP_PORT, path: '/healthz', timeout: 4000 }, (up) => {
      res.writeHead(up.statusCode === 200 ? 200 : 503, { 'Content-Type': 'application/json' });
      up.pipe(res);
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'starting', mcp: e.message })); });
    return;
  }
  const p = davPath(url.pathname);
  if (!p) { res.writeHead(404); return res.end(); }
  try { handleDav(req, res, p); } catch (e) { res.writeHead(500); res.end(e.message); }
});
helper.on('error', (e) => { console.error('[railway] helper: ' + e.message); stopAll(1); });
helper.listen(HELPER_PORT, '127.0.0.1', () => {
  run('nginx', 'nginx', ['-g', 'daemon off;']);
  log('Prompt Optimizer listening on port ' + PORT + ' (user "' + user + '", MCP ' + (mcpEnabled ? 'on at /mcp' : 'off') + ')');
});
