/**
 * XPX GAMING ORIGINALS — KEY VERIFICATION BACKEND
 * server.js  |  © 2026 Aashryaaa Pvt. Ltd.
 *
 * Endpoints:
 *   POST /api/verify-key        — verify a bundle encryption key
 *   GET  /admin                 — admin dashboard (password protected)
 *   GET  /admin/data            — admin raw data (password protected)
 */

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ============================================================
   CONFIG — change ADMIN_PASSWORD before deploying
   ============================================================ */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'XPXadmin@2026';
const KEYS_FILE      = path.join(__dirname, 'keys.json');

/* ============================================================
   MIDDLEWARE
   ============================================================ */
app.use(cors({
  origin: '*', // lock this down to your domain after deploying e.g. 'https://yourdomain.com'
  methods: ['GET', 'POST'],
}));
app.use(express.json());

/* ============================================================
   HELPERS — read / write keys.json atomically
   ============================================================ */
function readKeys() {
  const raw = fs.readFileSync(KEYS_FILE, 'utf8');
  return JSON.parse(raw);
}

function writeKeys(data) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/* ============================================================
   POST /api/verify-key
   Body: { key: "XXXX-XXXX-XXXX-XXXX" }
   Returns:
     200 { success: true,  message: "...", master: bool }
     200 { success: false, message: "..." }
   ============================================================ */
app.post('/api/verify-key', (req, res) => {
  const { key } = req.body;

  // Basic validation
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    return res.json({ success: false, message: 'No key provided.' });
  }

  const trimmedKey = key.trim();
  const ip         = getClientIP(req);
  const data       = readKeys();

  // ── Check master key first ──────────────────────────────
  if (trimmedKey === data.master.key) {
    console.log(`[${new Date().toISOString()}] MASTER KEY used from IP: ${ip}`);
    return res.json({
      success: true,
      master:  true,
      message: 'Master key verified. Access granted.',
    });
  }

  // ── Check one-time keys ─────────────────────────────────
  const keyIndex = data.keys.findIndex(
    (k) => k.key === trimmedKey
  );

  // Key not found at all
  if (keyIndex === -1) {
    console.log(`[${new Date().toISOString()}] INVALID KEY attempt: "${trimmedKey}" from IP: ${ip}`);
    return res.json({
      success: false,
      message: 'Invalid encryption key. Please check your key and try again.',
    });
  }

  const keyEntry = data.keys[keyIndex];

  // Key already used
  if (keyEntry.used) {
    console.log(`[${new Date().toISOString()}] ALREADY USED KEY attempt: "${trimmedKey}" from IP: ${ip}`);
    return res.json({
      success: false,
      message: 'This key has already been redeemed and cannot be used again. Please contact support on Discord.',
    });
  }

  // ── Valid, unused key — mark it as used ─────────────────
  data.keys[keyIndex].used      = true;
  data.keys[keyIndex].usedAt    = new Date().toISOString();
  data.keys[keyIndex].usedByIP  = ip;
  writeKeys(data);

  console.log(`[${new Date().toISOString()}] KEY REDEEMED: "${trimmedKey}" from IP: ${ip}`);

  return res.json({
    success: true,
    master:  false,
    message: 'Key verified. Access granted.',
  });
});

/* ============================================================
   GET /admin?password=XPXadmin@2026
   Simple HTML dashboard — shows all key statuses
   ============================================================ */
app.get('/admin', (req, res) => {
  const { password } = req.query;

  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).send(`
      <html><head><title>XPX Admin</title>
      <style>
        body { font-family: monospace; background: #06060a; color: #e8c97a; display: flex;
               align-items: center; justify-content: center; height: 100vh; margin: 0; }
        form { display: flex; flex-direction: column; gap: 12px; }
        input { background: #12121c; border: 1px solid #2a2a3a; color: #fff;
                padding: 10px 14px; font-size: 14px; border-radius: 4px; font-family: monospace; }
        button { background: #c9a84c; color: #000; border: none; padding: 10px 24px;
                 font-weight: 700; letter-spacing: 2px; cursor: pointer; border-radius: 4px; }
        h2 { margin: 0 0 8px; letter-spacing: 4px; }
      </style></head><body>
      <form method="GET" action="/admin">
        <h2>XPX ADMIN</h2>
        <input type="password" name="password" placeholder="Admin password" autofocus />
        <button type="submit">ENTER</button>
      </form>
      </html>
    `);
  }

  const data  = readKeys();
  const keys  = data.keys;
  const used  = keys.filter((k) => k.used).length;
  const avail = keys.length - used;

  const rows = keys.map((k, i) => `
    <tr style="background:${k.used ? 'rgba(224,92,75,0.08)' : 'rgba(57,217,138,0.05)'}">
      <td style="color:#6b6878">${i + 1}</td>
      <td style="font-family:monospace;letter-spacing:1px">${k.key}</td>
      <td style="color:${k.used ? '#e05c4b' : '#39d98a'};font-weight:700">
        ${k.used ? '✗ USED' : '✓ AVAILABLE'}
      </td>
      <td style="color:#6b6878;font-size:11px">${k.usedAt ? new Date(k.usedAt).toLocaleString() : '—'}</td>
      <td style="color:#6b6878;font-size:11px">${k.usedByIP || '—'}</td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html><head>
      <title>XPX Admin Dashboard</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', monospace; background: #06060a; color: #eeeaf0; padding: 32px 24px; }
        .header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 32px; }
        .logo { font-size: 28px; font-weight: 900; letter-spacing: 6px; color: #e8c97a; }
        .subtitle { font-size: 11px; letter-spacing: 3px; color: #6b6878; text-transform: uppercase; }
        .stats { display: flex; gap: 20px; margin-bottom: 32px; flex-wrap: wrap; }
        .stat { background: #0d0d14; border: 1px solid #1a1a28; border-radius: 10px;
                padding: 20px 28px; min-width: 140px; }
        .stat-num { font-size: 36px; font-weight: 900; line-height: 1; color: #e8c97a; }
        .stat-label { font-size: 10px; letter-spacing: 2px; color: #6b6878; margin-top: 4px; text-transform: uppercase; }
        .stat.green .stat-num { color: #39d98a; }
        .stat.red   .stat-num { color: #e05c4b; }
        .master-box { background: rgba(201,168,76,0.06); border: 1px solid rgba(201,168,76,0.25);
                      border-radius: 8px; padding: 14px 20px; margin-bottom: 24px;
                      font-size: 13px; color: #9591a0; }
        .master-box strong { color: #e8c97a; }
        table { width: 100%; border-collapse: collapse; background: #0d0d14;
                border: 1px solid #1a1a28; border-radius: 10px; overflow: hidden; }
        th { background: #12121c; padding: 12px 16px; text-align: left;
             font-size: 10px; letter-spacing: 2px; color: #6b6878; text-transform: uppercase;
             border-bottom: 1px solid #1a1a28; }
        td { padding: 10px 16px; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.03); }
        tr:last-child td { border-bottom: none; }
        .refresh { display: inline-block; margin-bottom: 16px; font-size: 11px;
                   color: #6b6878; letter-spacing: 1px; }
        .refresh a { color: #e8c97a; text-decoration: none; }
      </style>
    </head><body>
      <div class="header">
        <div class="logo">XPX</div>
        <div class="subtitle">Admin Dashboard — Key Management</div>
      </div>

      <div class="stats">
        <div class="stat"><div class="stat-num">${keys.length}</div><div class="stat-label">Total Keys</div></div>
        <div class="stat green"><div class="stat-num">${avail}</div><div class="stat-label">Available</div></div>
        <div class="stat red"><div class="stat-num">${used}</div><div class="stat-label">Used / Expired</div></div>
      </div>

      <div class="master-box">
        🔑 <strong>Master Key:</strong> ${data.master.key} &nbsp;|&nbsp;
        <strong style="color:#39d98a">Unlimited · Never Expires · Owner Only</strong>
      </div>

      <p class="refresh">Last loaded: ${new Date().toLocaleString()} — <a href="/admin?password=${ADMIN_PASSWORD}">Refresh</a></p>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Key</th>
            <th>Status</th>
            <th>Used At</th>
            <th>IP Address</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>
  `);
});

/* ============================================================
   GET /admin/data?password=...
   Returns raw JSON — useful for building custom tooling
   ============================================================ */
app.get('/admin/data', (req, res) => {
  const { password } = req.query;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const data = readKeys();
  res.json({
    totalKeys:  data.keys.length,
    usedKeys:   data.keys.filter((k) => k.used).length,
    availKeys:  data.keys.filter((k) => !k.used).length,
    keys:       data.keys,
  });
});

/* ============================================================
   Health check
   ============================================================ */
app.get('/', (req, res) => {
  res.json({ status: 'online', service: 'XPX Gaming Key Verification API', version: '1.0.0' });
});

/* ============================================================
   START
   ============================================================ */
app.listen(PORT, () => {
  console.log(`\n🎮 XPX Gaming Backend running on port ${PORT}`);
  console.log(`   Admin dashboard: http://localhost:${PORT}/admin?password=${ADMIN_PASSWORD}`);
  console.log(`   API endpoint:    http://localhost:${PORT}/api/verify-key\n`);
});