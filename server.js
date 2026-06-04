/**
 * XPX GAMING ORIGINALS — BACKEND v2.0
 * server.js  |  © 2026 Aashryaaa Pvt. Ltd.
 *
 * Endpoints:
 *   POST /api/verify-key          — verify bundle encryption key → returns session token
 *   POST /api/verify-session      — verify session token on access.html load
 *   POST /api/verify-ticket-p1    — verify Phase 1 ticket → marks used
 *   POST /api/verify-ticket-p2    — verify Phase 2 ticket → marks used → returns download token
 *   GET  /api/download            — serve .exe file with valid download token
 *   GET  /admin                   — admin dashboard
 *   GET  /admin/data              — raw JSON data
 *   GET  /                        — health check
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ============================================================
   CONFIG
   ============================================================ */
const ADMIN_PASSWORD   = process.env.ADMIN_PASSWORD || 'XPXadmin@2026';
const KEYS_FILE        = path.join(__dirname, 'keys.json');
const EXE_FILE         = path.join(__dirname, '100GamesBundleXPX_Setup.exe');
const EXE_FILENAME     = '100GamesBundleXPX_Setup.exe';
const TRIAL_EXE_FILE   = path.join(__dirname, 'CyberpunkTrial_Setup.exe');
const TRIAL_EXE_NAME   = 'CyberpunkTrial_Setup.exe';

// Session token expires in 15 minutes
const SESSION_TTL_MS   = 15 * 60 * 1000;
// Download token expires in 5 minutes
const DOWNLOAD_TTL_MS  = 5  * 60 * 1000;

/* ============================================================
   MIDDLEWARE
   ============================================================ */
app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      'https://xpxbundle100.netlify.app',
      'https://xpx.netlify.app',
      'http://localhost',
      'http://127.0.0.1',
    ];
    if (!origin || allowed.some(a => origin.startsWith(a))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
}));
app.use(express.json());

/* ============================================================
   HELPERS
   ============================================================ */
function readKeys() {
  return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
}
function writeKeys(data) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}
function genToken(prefix = 'tok') {
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
}
function isMaster(key, data) {
  return key === data.master.key;
}

/* ============================================================
   CLEANUP expired tokens periodically
   ============================================================ */
setInterval(() => {
  try {
    const data = readKeys();
    const now  = Date.now();
    let changed = false;

    Object.keys(data.sessionTokens).forEach(tok => {
      if (data.sessionTokens[tok].expiresAt < now) {
        delete data.sessionTokens[tok];
        changed = true;
      }
    });
    Object.keys(data.downloadTokens).forEach(tok => {
      if (data.downloadTokens[tok].expiresAt < now) {
        delete data.downloadTokens[tok];
        changed = true;
      }
    });
    if (changed) writeKeys(data);
  } catch(e) {}
}, 60 * 1000); // every minute

/* ============================================================
   POST /api/verify-key
   Verifies encryption key → returns session token for access.html
   ============================================================ */
app.post('/api/verify-key', (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string' || !key.trim()) {
    return res.json({ success: false, message: 'No key provided.' });
  }

  const trimmed = key.trim();
  const ip      = getIP(req);
  const data    = readKeys();

  // Master key
  if (isMaster(trimmed, data)) {
    const token = genToken('sess');
    data.sessionTokens[token] = { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, master: true };
    writeKeys(data);
    console.log(`[${new Date().toISOString()}] MASTER KEY used from ${ip}`);
    return res.json({ success: true, master: true, sessionToken: token, message: 'Master key verified.' });
  }

  // One-time keys
  const idx = data.keys.findIndex(k => k.key === trimmed);
  if (idx === -1) {
    console.log(`[${new Date().toISOString()}] INVALID KEY: "${trimmed}" from ${ip}`);
    return res.json({ success: false, message: 'Invalid encryption key. Please check your key and try again.' });
  }
  if (data.keys[idx].used) {
    console.log(`[${new Date().toISOString()}] USED KEY attempt: "${trimmed}" from ${ip}`);
    return res.json({ success: false, message: 'This key has already been redeemed. Please contact support on Discord.' });
  }

  // Mark used + create session token
  data.keys[idx].used     = true;
  data.keys[idx].usedAt   = new Date().toISOString();
  data.keys[idx].usedByIP = ip;
  const token = genToken('sess');
  data.sessionTokens[token] = { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, master: false };
  writeKeys(data);

  console.log(`[${new Date().toISOString()}] KEY REDEEMED: "${trimmed}" from ${ip} → session ${token.slice(0,16)}...`);
  return res.json({ success: true, master: false, sessionToken: token, message: 'Key verified. Access granted.' });
});

/* ============================================================
   POST /api/verify-session
   Called by access.html on load — validates session token
   ============================================================ */
app.post('/api/verify-session', (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken) return res.json({ valid: false, reason: 'no_token' });

  const data = readKeys();
  const sess = data.sessionTokens[sessionToken];

  if (!sess)                        return res.json({ valid: false, reason: 'invalid_token' });
  if (sess.expiresAt < Date.now())  return res.json({ valid: false, reason: 'expired' });

  return res.json({ valid: true });
});

/* ============================================================
   POST /api/verify-ticket-p1
   Phase 1 ticket verification — marks used
   ============================================================ */
app.post('/api/verify-ticket-p1', (req, res) => {
  const { ticket, sessionToken } = req.body;
  if (!ticket || !sessionToken) return res.json({ success: false, message: 'Missing fields.' });

  const ip   = getIP(req);
  const data = readKeys();

  // Validate session
  const sess = data.sessionTokens[sessionToken];
  if (!sess || sess.expiresAt < Date.now()) {
    return res.json({ success: false, message: 'Session expired. Please go back and verify your encryption key again.' });
  }

  const trimmed = ticket.trim();

  // Master key → skip ticket validation
  if (sess.master) {
    console.log(`[${new Date().toISOString()}] MASTER P1 bypass from ${ip}`);
    return res.json({ success: true, message: 'Phase 1 verified (master).' });
  }

  const idx = data.phase1Tickets.findIndex(t => t.key === trimmed);
  if (idx === -1) {
    return res.json({ success: false, message: 'Invalid Phase 1 ticket. Please check and try again.' });
  }
  if (data.phase1Tickets[idx].used) {
    return res.json({ success: false, message: 'This Phase 1 ticket has already been used. Contact support on Discord.' });
  }

  data.phase1Tickets[idx].used     = true;
  data.phase1Tickets[idx].usedAt   = new Date().toISOString();
  data.phase1Tickets[idx].usedByIP = ip;
  writeKeys(data);

  console.log(`[${new Date().toISOString()}] P1 TICKET USED: "${trimmed}" from ${ip}`);
  return res.json({ success: true, message: 'Phase 1 verified.' });
});

/* ============================================================
   POST /api/verify-ticket-p2
   Phase 2 ticket verification — marks used → returns download token
   ============================================================ */
app.post('/api/verify-ticket-p2', (req, res) => {
  const { ticket, sessionToken } = req.body;
  if (!ticket || !sessionToken) return res.json({ success: false, message: 'Missing fields.' });

  const ip   = getIP(req);
  const data = readKeys();

  // Validate session
  const sess = data.sessionTokens[sessionToken];
  if (!sess || sess.expiresAt < Date.now()) {
    return res.json({ success: false, message: 'Session expired. Please go back and verify your encryption key again.' });
  }

  const trimmed = ticket.trim();

  // Master key → skip ticket validation, still give download token
  if (sess.master) {
    const dlToken = genToken('dl');
    data.downloadTokens[dlToken] = { createdAt: Date.now(), expiresAt: Date.now() + DOWNLOAD_TTL_MS };
    writeKeys(data);
    console.log(`[${new Date().toISOString()}] MASTER P2 bypass from ${ip} → dl token issued`);
    return res.json({ success: true, downloadToken: dlToken, message: 'Phase 2 verified (master).' });
  }

  const idx = data.phase2Tickets.findIndex(t => t.key === trimmed);
  if (idx === -1) {
    return res.json({ success: false, message: 'Invalid Phase 2 ticket. Please check and try again.' });
  }
  if (data.phase2Tickets[idx].used) {
    return res.json({ success: false, message: 'This Phase 2 ticket has already been used. Contact support on Discord.' });
  }

  data.phase2Tickets[idx].used     = true;
  data.phase2Tickets[idx].usedAt   = new Date().toISOString();
  data.phase2Tickets[idx].usedByIP = ip;

  const dlToken = genToken('dl');
  data.downloadTokens[dlToken] = { createdAt: Date.now(), expiresAt: Date.now() + DOWNLOAD_TTL_MS };
  writeKeys(data);

  console.log(`[${new Date().toISOString()}] P2 TICKET USED: "${trimmed}" from ${ip} → dl token issued`);
  return res.json({ success: true, downloadToken: dlToken, message: 'Phase 2 verified. Download ready.' });
});

/* ============================================================
   GET /api/download?token=DOWNLOAD_TOKEN
   Serves the .exe file directly — burns token after use
   ============================================================ */
app.get('/api/download', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(403).json({ error: 'No download token provided.' });

  const data = readKeys();
  const dl   = data.downloadTokens[token];

  if (!dl) {
    return res.status(403).send(`
      <html><head><title>Access Denied</title></head>
      <body style="background:#06060a;color:#e05c4b;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;">
        <div style="font-size:48px;">⛔</div>
        <div style="font-size:18px;letter-spacing:2px;">INVALID DOWNLOAD TOKEN</div>
        <div style="font-size:12px;color:#6b6878;">This link is invalid or has already been used.</div>
        <a href="javascript:history.back()" style="color:#c9a84c;font-size:12px;margin-top:8px;">← Go Back</a>
      </body></html>
    `);
  }

  if (dl.expiresAt < Date.now()) {
    delete data.downloadTokens[token];
    writeKeys(data);
    return res.status(403).send(`
      <html><head><title>Link Expired</title></head>
      <body style="background:#06060a;color:#e05c4b;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;">
        <div style="font-size:48px;">⏰</div>
        <div style="font-size:18px;letter-spacing:2px;">DOWNLOAD LINK EXPIRED</div>
        <div style="font-size:12px;color:#6b6878;">Your download link has expired (5 min limit). Please go back and verify again.</div>
        <a href="javascript:history.back()" style="color:#c9a84c;font-size:12px;margin-top:8px;">← Go Back</a>
      </body></html>
    `);
  }

  // Check exe exists
  if (!fs.existsSync(EXE_FILE)) {
    return res.status(500).json({ error: 'Installer file not found on server. Contact support.' });
  }

  // Burn the token immediately
  delete data.downloadTokens[token];
  writeKeys(data);

  const ip = getIP(req);
  console.log(`[${new Date().toISOString()}] DOWNLOAD served to ${ip}`);

  // Stream the file
  res.setHeader('Content-Disposition', `attachment; filename="${EXE_FILENAME}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', fs.statSync(EXE_FILE).size);
  fs.createReadStream(EXE_FILE).pipe(res);
});

/* ============================================================
   GET /admin
   ============================================================ */
app.get('/admin', (req, res) => {
  const { password } = req.query;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).send(`
      <html><head><title>XPX Admin</title>
      <style>
        body{font-family:monospace;background:#06060a;color:#e8c97a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
        form{display:flex;flex-direction:column;gap:12px;}
        input{background:#12121c;border:1px solid #2a2a3a;color:#fff;padding:10px 14px;font-size:14px;border-radius:4px;font-family:monospace;}
        button{background:#c9a84c;color:#000;border:none;padding:10px 24px;font-weight:700;letter-spacing:2px;cursor:pointer;border-radius:4px;}
        h2{margin:0 0 8px;letter-spacing:4px;}
      </style></head><body>
      <form method="GET" action="/admin">
        <h2>XPX ADMIN</h2>
        <input type="password" name="password" placeholder="Admin password" autofocus/>
        <button type="submit">ENTER</button>
      </form></html>
    `);
  }

  const data    = readKeys();
  const keys    = data.keys;
  const p1      = data.phase1Tickets;
  const p2      = data.phase2Tickets;
  const exeExists      = fs.existsSync(EXE_FILE);
  const trialExeExists = fs.existsSync(TRIAL_EXE_FILE);

  const keyRows = keys.map((k,i) => `
    <tr style="background:${k.used?'rgba(224,92,75,0.08)':'rgba(57,217,138,0.05)'}">
      <td style="color:#6b6878">${i+1}</td>
      <td style="font-family:monospace;font-size:12px">${k.key}</td>
      <td style="color:${k.used?'#e05c4b':'#39d98a'};font-weight:700">${k.used?'✗ USED':'✓ AVAILABLE'}</td>
      <td style="color:#6b6878;font-size:11px">${k.usedAt?new Date(k.usedAt).toLocaleString():'—'}</td>
      <td style="color:#6b6878;font-size:11px">${k.usedByIP||'—'}</td>
    </tr>`).join('');

  const p1Rows = p1.map((k,i) => `
    <tr style="background:${k.used?'rgba(224,92,75,0.08)':'rgba(57,217,138,0.05)'}">
      <td style="color:#6b6878">${i+1}</td>
      <td style="font-family:monospace;font-size:12px">${k.key}</td>
      <td style="color:${k.used?'#e05c4b':'#39d98a'};font-weight:700">${k.used?'✗ USED':'✓ AVAILABLE'}</td>
      <td style="color:#6b6878;font-size:11px">${k.usedAt?new Date(k.usedAt).toLocaleString():'—'}</td>
      <td style="color:#6b6878;font-size:11px">${k.usedByIP||'—'}</td>
    </tr>`).join('');

  const p2Rows = p2.map((k,i) => `
    <tr style="background:${k.used?'rgba(224,92,75,0.08)':'rgba(57,217,138,0.05)'}">
      <td style="color:#6b6878">${i+1}</td>
      <td style="font-family:monospace;font-size:12px">${k.key}</td>
      <td style="color:${k.used?'#e05c4b':'#39d98a'};font-weight:700">${k.used?'✗ USED':'✓ AVAILABLE'}</td>
      <td style="color:#6b6878;font-size:11px">${k.usedAt?new Date(k.usedAt).toLocaleString():'—'}</td>
      <td style="color:#6b6878;font-size:11px">${k.usedByIP||'—'}</td>
    </tr>`).join('');

  const tableStyle = `width:100%;border-collapse:collapse;background:#0d0d14;border:1px solid #1a1a28;border-radius:10px;overflow:hidden;margin-bottom:40px;`;
  const thStyle    = `background:#12121c;padding:10px 14px;text-align:left;font-size:10px;letter-spacing:2px;color:#6b6878;text-transform:uppercase;border-bottom:1px solid #1a1a28;`;
  const tdStyle    = `padding:8px 14px;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.03);`;

  res.send(`<!DOCTYPE html><html><head><title>XPX Admin</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Segoe UI',monospace;background:#06060a;color:#eeeaf0;padding:32px 24px;}
    h2{font-size:22px;font-weight:900;letter-spacing:4px;color:#e8c97a;margin-bottom:24px;}
    h3{font-size:14px;letter-spacing:3px;color:#9591a0;text-transform:uppercase;margin:32px 0 12px;}
    .stats{display:flex;gap:16px;margin-bottom:32px;flex-wrap:wrap;}
    .stat{background:#0d0d14;border:1px solid #1a1a28;border-radius:10px;padding:16px 24px;min-width:120px;}
    .stat-num{font-size:32px;font-weight:900;line-height:1;color:#e8c97a;}
    .stat.green .stat-num{color:#39d98a;} .stat.red .stat-num{color:#e05c4b;} .stat.blue .stat-num{color:#4af0ff;}
    .stat-label{font-size:10px;letter-spacing:2px;color:#6b6878;margin-top:4px;text-transform:uppercase;}
    .master-box{background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:8px;padding:12px 18px;margin-bottom:24px;font-size:13px;color:#9591a0;}
    .master-box strong{color:#e8c97a;}
    .exe-box{background:${exeExists?'rgba(57,217,138,0.06)':'rgba(224,92,75,0.06)'};border:1px solid ${exeExists?'rgba(57,217,138,0.25)':'rgba(224,92,75,0.25)'};border-radius:8px;padding:12px 18px;margin-bottom:24px;font-size:13px;color:#9591a0;}
    .refresh{font-size:11px;color:#6b6878;margin-bottom:16px;} .refresh a{color:#e8c97a;}
    table{${tableStyle}} th{${thStyle}} td{${tdStyle}}
    tr:last-child td{border-bottom:none;}
  </style></head><body>
  <h2>XPX ADMIN DASHBOARD</h2>

  <div class="exe-box">
    📦 <strong>Bundle Launcher:</strong> ${exeExists ? '✅ File present on server — downloads working' : '❌ FILE MISSING — upload 100GamesBundleXPX_Setup.exe to the repo'}
  </div>
  <div class="exe-box" style="background:${trialExeExists?'rgba(57,217,138,0.06)':'rgba(224,92,75,0.06)'};border-color:${trialExeExists?'rgba(57,217,138,0.25)':'rgba(224,92,75,0.25)'};">
    🎮 <strong>Cyberpunk Trial Launcher:</strong> ${trialExeExists ? '✅ File present on server — trial downloads working' : '❌ FILE MISSING — upload CyberpunkTrialXPX_Setup.exe to the repo'}
  </div>

  <div class="master-box">
    🔑 <strong>Master Key:</strong> ${data.master.key} &nbsp;|&nbsp; <strong style="color:#39d98a">Unlimited · Never Expires</strong>
  </div>
  <div class="master-box" style="border-color:rgba(74,240,255,0.25);background:rgba(74,240,255,0.04);">
    🎮 <strong style="color:#4af0ff">Trial Token:</strong> ${data.trialToken.key} &nbsp;|&nbsp; <strong style="color:#39d98a">Unlimited · Never Expires · Cyberpunk 24hr Trial</strong>
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-num">${keys.length}</div><div class="stat-label">Total Keys</div></div>
    <div class="stat green"><div class="stat-num">${keys.filter(k=>!k.used).length}</div><div class="stat-label">Keys Available</div></div>
    <div class="stat red"><div class="stat-num">${keys.filter(k=>k.used).length}</div><div class="stat-label">Keys Used</div></div>
    <div class="stat blue"><div class="stat-num">${p1.filter(k=>!k.used).length}</div><div class="stat-label">P1 Available</div></div>
    <div class="stat blue"><div class="stat-num">${p2.filter(k=>!k.used).length}</div><div class="stat-label">P2 Available</div></div>
    <div class="stat red"><div class="stat-num">${Object.keys(data.sessionTokens).length}</div><div class="stat-label">Active Sessions</div></div>
  </div>

  <p class="refresh">Last loaded: ${new Date().toLocaleString()} — <a href="/admin?password=${ADMIN_PASSWORD}">Refresh</a></p>

  <h3>Encryption Keys</h3>
  <table><thead><tr><th>#</th><th>Key</th><th>Status</th><th>Used At</th><th>IP</th></tr></thead><tbody>${keyRows}</tbody></table>

  <h3>Phase 1 Tickets</h3>
  <table><thead><tr><th>#</th><th>Ticket</th><th>Status</th><th>Used At</th><th>IP</th></tr></thead><tbody>${p1Rows}</tbody></table>

  <h3>Phase 2 Tickets</h3>
  <table><thead><tr><th>#</th><th>Ticket</th><th>Status</th><th>Used At</th><th>IP</th></tr></thead><tbody>${p2Rows}</tbody></table>

  </body></html>`);
});

/* ============================================================
   POST /api/verify-trial-token
   Verifies Cyberpunk trial token — unlimited use, never expires
   ============================================================ */
app.post('/api/verify-trial-token', (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string' || !token.trim()) {
    return res.json({ success: false, message: 'No token provided.' });
  }

  const ip   = getIP(req);
  const data = readKeys();

  if (token.trim() !== data.trialToken.key) {
    console.log(`[${new Date().toISOString()}] INVALID TRIAL TOKEN from ${ip}`);
    return res.json({ success: false, message: 'Invalid trial token. Get your free token from the XPX Discord #purchase channel.' });
  }

  // Generate a one-time download token for the trial exe
  const dlToken = genToken('trial');
  data.downloadTokens[dlToken] = { createdAt: Date.now(), expiresAt: Date.now() + DOWNLOAD_TTL_MS, trial: true };
  writeKeys(data);

  console.log(`[${new Date().toISOString()}] TRIAL TOKEN used from ${ip} → trial dl token issued`);
  return res.json({ success: true, downloadToken: dlToken, message: 'Trial token verified. Download starting.' });
});

/* ============================================================
   GET /api/download-trial?token=DOWNLOAD_TOKEN
   Serves the Cyberpunk trial .exe — burns token after use
   ============================================================ */
app.get('/api/download-trial', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(403).json({ error: 'No download token provided.' });

  const data = readKeys();
  const dl   = data.downloadTokens[token];

  if (!dl || !dl.trial) {
    return res.status(403).send(`
      <html><head><title>Access Denied</title></head>
      <body style="background:#06060a;color:#e05c4b;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;">
        <div style="font-size:48px;">⛔</div>
        <div style="font-size:18px;letter-spacing:2px;">INVALID DOWNLOAD TOKEN</div>
        <div style="font-size:12px;color:#6b6878;">This link is invalid or has already been used.</div>
        <a href="javascript:history.back()" style="color:#c9a84c;font-size:12px;margin-top:8px;">← Go Back</a>
      </body></html>
    `);
  }

  if (dl.expiresAt < Date.now()) {
    delete data.downloadTokens[token];
    writeKeys(data);
    return res.status(403).send(`
      <html><head><title>Link Expired</title></head>
      <body style="background:#06060a;color:#e05c4b;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;">
        <div style="font-size:48px;">⏰</div>
        <div style="font-size:18px;letter-spacing:2px;">DOWNLOAD LINK EXPIRED</div>
        <div style="font-size:12px;color:#6b6878;">Please go back and verify your token again.</div>
        <a href="javascript:history.back()" style="color:#c9a84c;font-size:12px;margin-top:8px;">← Go Back</a>
      </body></html>
    `);
  }

  if (!fs.existsSync(TRIAL_EXE_FILE)) {
    return res.status(500).json({ error: 'Trial installer not found on server. Contact support.' });
  }

  // Burn token
  delete data.downloadTokens[token];
  writeKeys(data);

  const ip = getIP(req);
  console.log(`[${new Date().toISOString()}] TRIAL DOWNLOAD served to ${ip}`);

  res.setHeader('Content-Disposition', `attachment; filename="${TRIAL_EXE_NAME}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', fs.statSync(TRIAL_EXE_FILE).size);
  fs.createReadStream(TRIAL_EXE_FILE).pipe(res);
});

/* ============================================================
   Health check
   ============================================================ */
app.get('/', (req, res) => {
  res.json({ status: 'online', service: 'XPX Gaming Key Verification API', version: '2.0.0' });
});

/* ============================================================
   START
   ============================================================ */
app.listen(PORT, () => {
  console.log(`\n🎮 XPX Gaming Backend v2.0 running on port ${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin?password=${ADMIN_PASSWORD}`);
  console.log(`   EXE file: ${fs.existsSync(EXE_FILE) ? '✅ present' : '❌ MISSING — upload exe to repo'}\n`);
});
