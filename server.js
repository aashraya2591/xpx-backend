/**
 * XPX GAMING ORIGINALS — BACKEND v3.0
 * server.js  |  © 2026 Aashryaaa Pvt. Ltd.
 *
 * Endpoints:
 *   POST /api/verify-key          — verify redeem key → returns session token
 *   POST /api/verify-session      — verify session token on access.html load
 *   GET  /api/download            — serve .exe file with valid download token
 *   POST /api/submit-order        — customer submits order + screenshot → emails admin
 *   POST /api/verify-order        — admin verifies order → picks unused key → emails customer
 *   GET  /admin                   — admin dashboard
 *   GET  /                        — health check
 */

'use strict';

const express      = require('express');
const cors         = require('cors');
const fs           = require('fs');
const path         = require('path');
const crypto       = require('crypto');
const multer       = require('multer');
const nodemailer   = require('nodemailer');

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

const GMAIL_USER       = process.env.GMAIL_USER;
const GMAIL_PASS       = process.env.GMAIL_PASS;
const ADMIN_EMAIL      = 'gamingxpx941@gmail.com';

// Session token expires in 15 minutes
const SESSION_TTL_MS   = 15 * 60 * 1000;
// Download token expires in 5 minutes
const DOWNLOAD_TTL_MS  = 5  * 60 * 1000;

/* ============================================================
   NODEMAILER TRANSPORTER
   ============================================================ */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 30000,
});

/* ============================================================
   MULTER — memory storage (screenshot stored in RAM, attached to email)
   ============================================================ */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  },
});

/* ============================================================
   MIDDLEWARE
   ============================================================ */
app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      'https://xpxoriginals100.netlify.app',
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
function genOrderId() {
  return `XPX-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
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
}, 60 * 1000);

/* ============================================================
   POST /api/submit-order
   Customer submits order + screenshot → saved to keys.json → emails admin
   ============================================================ */
app.post('/api/submit-order', upload.single('screenshot'), async (req, res) => {
  try {
    const { name, email, whatsapp } = req.body;

    if (!name || !email) {
      return res.json({ success: false, message: 'Name and email are required.' });
    }
    if (!req.file) {
      return res.json({ success: false, message: 'Payment screenshot is required.' });
    }

    const ip      = getIP(req);
    const orderId = genOrderId();
    const data    = readKeys();

    // Save order to keys.json
    if (!data.orders) data.orders = [];
    const order = {
      orderId,
      name,
      email,
      whatsapp: whatsapp || '',
      status: 'pending',       // pending | verified | rejected
      submittedAt: new Date().toISOString(),
      verifiedAt: null,
      assignedKey: null,
      ip,
    };
    data.orders.push(order);
    writeKeys(data);

    // Email admin with screenshot attached
    const screenshotExt = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
    await transporter.sendMail({
      from: `"XPX Gaming Orders" <${GMAIL_USER}>`,
      to: ADMIN_EMAIL,
      subject: `[NEW ORDER] ${orderId} — ${name}`,
      html: `
        <div style="font-family:monospace;background:#06060a;color:#eeeaf0;padding:24px;border-radius:8px;">
          <h2 style="color:#e8c97a;letter-spacing:3px;margin-bottom:16px;">NEW ORDER RECEIVED</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;width:140px;">Order ID</td><td style="color:#4af0ff;font-weight:700;">${orderId}</td></tr>
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;">Customer Name</td><td style="color:#eeeaf0;">${name}</td></tr>
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;">Email</td><td style="color:#eeeaf0;">${email}</td></tr>
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;">WhatsApp</td><td style="color:#eeeaf0;">${whatsapp || '—'}</td></tr>
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;">Submitted At</td><td style="color:#eeeaf0;">${new Date().toLocaleString()}</td></tr>
            <tr><td style="color:#9591a0;padding:6px 12px 6px 0;">IP Address</td><td style="color:#eeeaf0;">${ip}</td></tr>
          </table>
          <p style="margin-top:20px;color:#9591a0;">Payment screenshot is attached. Go to the <strong style="color:#e8c97a;">Admin Dashboard</strong> to verify and send the redeem key.</p>
        </div>
      `,
      attachments: [
        {
          filename: `payment_${orderId}.${screenshotExt}`,
          content: req.file.buffer,
          contentType: req.file.mimetype,
        },
      ],
    });

    console.log(`[${new Date().toISOString()}] ORDER SUBMITTED: ${orderId} — ${email} from ${ip}`);
    return res.json({ success: true, orderId, message: 'Order submitted successfully.' });

  } catch (err) {
    console.error('submit-order error:', err);
    return res.json({ success: false, message: 'Server error. Please try again or contact support on Discord.' });
  }
});

/* ============================================================
   POST /api/verify-order
   Admin verifies order → assigns unused key → emails customer
   ============================================================ */
app.post('/api/verify-order', async (req, res) => {
  try {
    const { orderId, password } = req.body;

    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, message: 'Unauthorized.' });
    }
    if (!orderId) {
      return res.json({ success: false, message: 'Order ID required.' });
    }

    const data = readKeys();
    if (!data.orders) return res.json({ success: false, message: 'No orders found.' });

    const orderIdx = data.orders.findIndex(o => o.orderId === orderId);
    if (orderIdx === -1) return res.json({ success: false, message: 'Order not found.' });

    const order = data.orders[orderIdx];
    if (order.status === 'verified') {
      return res.json({ success: false, message: `Order already verified. Key sent: ${order.assignedKey}` });
    }

    // Pick first unused redeem key
    const keyIdx = data.keys.findIndex(k => !k.used);
    if (keyIdx === -1) {
      return res.json({ success: false, message: 'No unused redeem keys available! Add more keys to keys.json.' });
    }

    const assignedKey = data.keys[keyIdx].key;

    // Mark key as used
    data.keys[keyIdx].used      = true;
    data.keys[keyIdx].usedAt    = new Date().toISOString();
    data.keys[keyIdx].usedByIP  = order.ip;
    data.keys[keyIdx].orderId   = orderId;

    // Update order status
    data.orders[orderIdx].status      = 'verified';
    data.orders[orderIdx].verifiedAt  = new Date().toISOString();
    data.orders[orderIdx].assignedKey = assignedKey;
    writeKeys(data);

    // Email customer their redeem key
    await transporter.sendMail({
      from: `"XPX Gaming Originals" <${GMAIL_USER}>`,
      to: order.email,
      subject: `Your XPX Gaming Redeem Key — ${orderId}`,
      html: `
        <div style="font-family:monospace;background:#06060a;color:#eeeaf0;padding:32px;border-radius:8px;max-width:600px;">
          <div style="text-align:center;margin-bottom:28px;">
            <div style="font-size:28px;font-weight:900;letter-spacing:6px;color:#e8c97a;">XPX GAMING</div>
            <div style="font-size:12px;letter-spacing:4px;color:#9591a0;margin-top:4px;">ORIGINALS — 100+ BUNDLE PACKAGE</div>
          </div>

          <h2 style="color:#39d98a;letter-spacing:2px;margin-bottom:8px;">✅ PAYMENT VERIFIED</h2>
          <p style="color:#9591a0;margin-bottom:24px;">Hi <strong style="color:#eeeaf0;">${order.name}</strong>, your payment has been verified. Here is your Redeem Key:</p>

          <div style="background:#12121c;border:1px solid rgba(201,168,76,0.4);border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
            <div style="font-size:11px;letter-spacing:3px;color:#9591a0;margin-bottom:8px;">YOUR REDEEM KEY</div>
            <div style="font-size:22px;font-weight:900;letter-spacing:4px;color:#e8c97a;">${assignedKey}</div>
          </div>

          <div style="background:rgba(57,217,138,0.06);border:1px solid rgba(57,217,138,0.2);border-radius:8px;padding:16px;margin-bottom:24px;">
            <div style="font-size:11px;letter-spacing:3px;color:#39d98a;margin-bottom:10px;">HOW TO USE YOUR KEY</div>
            <ol style="color:#9591a0;padding-left:20px;line-height:2;">
              <li>Go to <a href="https://xpxbundle100.netlify.app/payment.html" style="color:#4af0ff;">xpxbundle100.netlify.app/payment.html</a></li>
              <li>Enter your Redeem Key in the key field</li>
              <li>Click <strong style="color:#eeeaf0;">REDEEM</strong> to unlock the Bundle Launcher download</li>
              <li>Run the launcher and enter your password when prompted</li>
              <li>Restart Steam — your 100+ games will appear instantly</li>
            </ol>
          </div>

          <p style="color:#6b6878;font-size:12px;">Order ID: ${orderId} &nbsp;|&nbsp; Keep this email for your records.</p>
          <p style="color:#6b6878;font-size:12px;margin-top:8px;">Need help? Join our <a href="https://discord.com/invite/bUqCGbSCwu" style="color:#5865F2;">XPX Discord</a> and ask in #support.</p>

          <div style="border-top:1px solid #1a1a28;margin-top:24px;padding-top:16px;font-size:11px;color:#4a4858;text-align:center;">
            © 2026 XPX Gaming Originals — Aashryaaa Pvt. Ltd.
          </div>
        </div>
      `,
    });

    console.log(`[${new Date().toISOString()}] ORDER VERIFIED: ${orderId} → key ${assignedKey} → emailed ${order.email}`);
    return res.json({ success: true, message: `Key ${assignedKey} sent to ${order.email}` });

  } catch (err) {
    console.error('verify-order error:', err);
    return res.json({ success: false, message: 'Server error during verification.' });
  }
});

/* ============================================================
   POST /api/reject-order
   Admin rejects an order
   ============================================================ */
app.post('/api/reject-order', async (req, res) => {
  try {
    const { orderId, password, reason } = req.body;

    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, message: 'Unauthorized.' });
    }

    const data = readKeys();
    if (!data.orders) return res.json({ success: false, message: 'No orders found.' });

    const orderIdx = data.orders.findIndex(o => o.orderId === orderId);
    if (orderIdx === -1) return res.json({ success: false, message: 'Order not found.' });

    const order = data.orders[orderIdx];
    if (order.status === 'verified') {
      return res.json({ success: false, message: 'Cannot reject an already verified order.' });
    }

    data.orders[orderIdx].status     = 'rejected';
    data.orders[orderIdx].rejectedAt = new Date().toISOString();
    data.orders[orderIdx].rejectReason = reason || 'Payment could not be verified.';
    writeKeys(data);

    // Email customer about rejection
    await transporter.sendMail({
      from: `"XPX Gaming Originals" <${GMAIL_USER}>`,
      to: order.email,
      subject: `XPX Gaming — Order Update (${orderId})`,
      html: `
        <div style="font-family:monospace;background:#06060a;color:#eeeaf0;padding:32px;border-radius:8px;max-width:600px;">
          <div style="text-align:center;margin-bottom:28px;">
            <div style="font-size:28px;font-weight:900;letter-spacing:6px;color:#e8c97a;">XPX GAMING</div>
            <div style="font-size:12px;letter-spacing:4px;color:#9591a0;margin-top:4px;">ORIGINALS — 100+ BUNDLE PACKAGE</div>
          </div>
          <h2 style="color:#e05c4b;letter-spacing:2px;margin-bottom:8px;">⚠ ORDER COULD NOT BE VERIFIED</h2>
          <p style="color:#9591a0;">Hi <strong style="color:#eeeaf0;">${order.name}</strong>,</p>
          <p style="color:#9591a0;margin-top:8px;">We were unable to verify your payment for order <strong style="color:#eeeaf0;">${orderId}</strong>.</p>
          <p style="color:#9591a0;margin-top:8px;">Reason: <strong style="color:#e05c4b;">${reason || 'Payment could not be verified.'}</strong></p>
          <p style="color:#9591a0;margin-top:16px;">If you believe this is a mistake, please join our Discord and open a ticket in #support with your payment proof.</p>
          <a href="https://discord.com/invite/bUqCGbSCwu" style="display:inline-block;margin-top:16px;background:#5865F2;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700;letter-spacing:2px;">JOIN DISCORD</a>
          <div style="border-top:1px solid #1a1a28;margin-top:24px;padding-top:16px;font-size:11px;color:#4a4858;text-align:center;">
            © 2026 XPX Gaming Originals — Aashryaaa Pvt. Ltd.
          </div>
        </div>
      `,
    });

    console.log(`[${new Date().toISOString()}] ORDER REJECTED: ${orderId}`);
    return res.json({ success: true, message: `Order ${orderId} rejected and customer notified.` });

  } catch (err) {
    console.error('reject-order error:', err);
    return res.json({ success: false, message: 'Server error during rejection.' });
  }
});

/* ============================================================
   POST /api/verify-key
   Verifies redeem key → returns session token for access.html
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
    return res.json({ success: false, message: 'Invalid redeem key. Please check your key and try again.' });
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

  const dlToken = genToken('trial');
  data.downloadTokens[dlToken] = { createdAt: Date.now(), expiresAt: Date.now() + DOWNLOAD_TTL_MS, trial: true };
  writeKeys(data);

  console.log(`[${new Date().toISOString()}] TRIAL TOKEN used from ${ip} → trial dl token issued`);
  return res.json({ success: true, downloadToken: dlToken, message: 'Trial token verified. Download starting.' });
});

/* ============================================================
   GET /api/download?token=DOWNLOAD_TOKEN
   Serves the .exe file — burns token after use
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

  if (!fs.existsSync(EXE_FILE)) {
    return res.status(500).json({ error: 'Installer file not found on server. Contact support.' });
  }

  delete data.downloadTokens[token];
  writeKeys(data);

  const ip = getIP(req);
  console.log(`[${new Date().toISOString()}] DOWNLOAD served to ${ip}`);

  res.setHeader('Content-Disposition', `attachment; filename="${EXE_FILENAME}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', fs.statSync(EXE_FILE).size);
  fs.createReadStream(EXE_FILE).pipe(res);
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
        <a href="javascript:history.back()" style="color:#c9a84c;font-size:12px;margin-top:8px;">← Go Back</a>
      </body></html>
    `);
  }

  if (!fs.existsSync(TRIAL_EXE_FILE)) {
    return res.status(500).json({ error: 'Trial installer not found on server. Contact support.' });
  }

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
   GET /admin
   Admin dashboard with orders + keys
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

  const data         = readKeys();
  const keys         = data.keys;
  const orders       = data.orders || [];
  const exeExists    = fs.existsSync(EXE_FILE);
  const trialExists  = fs.existsSync(TRIAL_EXE_FILE);

  const pendingOrders   = orders.filter(o => o.status === 'pending');
  const verifiedOrders  = orders.filter(o => o.status === 'verified');
  const rejectedOrders  = orders.filter(o => o.status === 'rejected');

  const orderRows = orders.slice().reverse().map(o => {
    const isPending  = o.status === 'pending';
    const isVerified = o.status === 'verified';
    const rowBg      = isPending ? 'rgba(201,168,76,0.06)' : isVerified ? 'rgba(57,217,138,0.05)' : 'rgba(224,92,75,0.05)';
    const statusCol  = isPending ? '#e8c97a' : isVerified ? '#39d98a' : '#e05c4b';
    const statusTxt  = isPending ? '⏳ PENDING' : isVerified ? '✅ VERIFIED' : '❌ REJECTED';

    return `
      <tr style="background:${rowBg}">
        <td style="font-family:monospace;font-size:11px;color:#4af0ff;">${o.orderId}</td>
        <td>${o.name}</td>
        <td style="font-family:monospace;font-size:12px;">${o.email}</td>
        <td style="font-size:11px;color:#9591a0;">${o.whatsapp || '—'}</td>
        <td style="color:${statusCol};font-weight:700;font-size:12px;">${statusTxt}</td>
        <td style="font-family:monospace;font-size:11px;color:#e8c97a;">${o.assignedKey || '—'}</td>
        <td style="font-size:11px;color:#9591a0;">${new Date(o.submittedAt).toLocaleString()}</td>
        <td>
          ${isPending ? `
            <button onclick="verifyOrder('${o.orderId}')" style="background:#39d98a;color:#000;border:none;padding:6px 14px;border-radius:4px;font-weight:700;font-size:11px;letter-spacing:1px;cursor:pointer;margin-right:6px;">VERIFY</button>
            <button onclick="rejectOrder('${o.orderId}')" style="background:#e05c4b;color:#fff;border:none;padding:6px 14px;border-radius:4px;font-weight:700;font-size:11px;letter-spacing:1px;cursor:pointer;">REJECT</button>
          ` : `<span style="color:#6b6878;font-size:11px;">${isVerified ? 'Done' : 'Rejected'}</span>`}
        </td>
      </tr>`;
  }).join('');

  const keyRows = keys.map((k,i) => `
    <tr style="background:${k.used?'rgba(224,92,75,0.06)':'rgba(57,217,138,0.04)'}">
      <td style="color:#6b6878">${i+1}</td>
      <td style="font-family:monospace;font-size:12px">${k.key}</td>
      <td style="color:${k.used?'#e05c4b':'#39d98a'};font-weight:700">${k.used?'✗ USED':'✓ AVAILABLE'}</td>
      <td style="color:#6b6878;font-size:11px">${k.usedAt?new Date(k.usedAt).toLocaleString():'—'}</td>
      <td style="color:#4af0ff;font-size:11px">${k.orderId||'—'}</td>
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
    .stat.green .stat-num{color:#39d98a;} .stat.red .stat-num{color:#e05c4b;} .stat.blue .stat-num{color:#4af0ff;} .stat.yellow .stat-num{color:#e8c97a;}
    .stat-label{font-size:10px;letter-spacing:2px;color:#6b6878;margin-top:4px;text-transform:uppercase;}
    .exe-box{background:rgba(57,217,138,0.06);border:1px solid rgba(57,217,138,0.25);border-radius:8px;padding:12px 18px;margin-bottom:16px;font-size:13px;color:#9591a0;}
    .exe-box.missing{background:rgba(224,92,75,0.06);border-color:rgba(224,92,75,0.25);}
    .master-box{background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:8px;padding:12px 18px;margin-bottom:16px;font-size:13px;color:#9591a0;}
    .refresh{font-size:11px;color:#6b6878;margin-bottom:16px;} .refresh a{color:#e8c97a;}
    table{${tableStyle}} th{${thStyle}} td{${tdStyle}}
    tr:last-child td{border-bottom:none;}
    #toast{position:fixed;bottom:24px;right:24px;background:#12121c;border:1px solid #2a2a3a;color:#39d98a;padding:12px 20px;border-radius:8px;font-size:13px;letter-spacing:1px;display:none;z-index:999;}
  </style></head><body>
  <h2>XPX ADMIN DASHBOARD</h2>

  <div class="exe-box ${exeExists?'':'missing'}">
    📦 <strong>Bundle Launcher:</strong> ${exeExists ? '✅ Present — downloads working' : '❌ MISSING — upload 100GamesBundleXPX_Setup.exe'}
  </div>
  <div class="exe-box ${trialExists?'':'missing'}">
    🎮 <strong>Cyberpunk Trial Launcher:</strong> ${trialExists ? '✅ Present — trial downloads working' : '❌ MISSING — upload CyberpunkTrial_Setup.exe'}
  </div>
  <div class="master-box">
    🔑 <strong>Master Key:</strong> ${data.master.key} &nbsp;|&nbsp; <strong style="color:#39d98a">Unlimited · Never Expires</strong>
  </div>
  <div class="master-box" style="border-color:rgba(74,240,255,0.25);background:rgba(74,240,255,0.04);">
    🎮 <strong style="color:#4af0ff">Trial Token:</strong> ${data.trialToken.key} &nbsp;|&nbsp; <strong style="color:#39d98a">Unlimited · Never Expires</strong>
  </div>

  <div class="stats">
    <div class="stat yellow"><div class="stat-num">${pendingOrders.length}</div><div class="stat-label">Pending Orders</div></div>
    <div class="stat green"><div class="stat-num">${verifiedOrders.length}</div><div class="stat-label">Verified Orders</div></div>
    <div class="stat red"><div class="stat-num">${rejectedOrders.length}</div><div class="stat-label">Rejected Orders</div></div>
    <div class="stat green"><div class="stat-num">${keys.filter(k=>!k.used).length}</div><div class="stat-label">Keys Available</div></div>
    <div class="stat red"><div class="stat-num">${keys.filter(k=>k.used).length}</div><div class="stat-label">Keys Used</div></div>
  </div>

  <p class="refresh">Last loaded: ${new Date().toLocaleString()} — <a href="/admin?password=${ADMIN_PASSWORD}">Refresh</a></p>

  <h3>Orders</h3>
  <table><thead><tr>
    <th>Order ID</th><th>Name</th><th>Email</th><th>WhatsApp</th><th>Status</th><th>Assigned Key</th><th>Submitted</th><th>Actions</th>
  </tr></thead><tbody>${orderRows || '<tr><td colspan="8" style="text-align:center;color:#6b6878;padding:24px;">No orders yet</td></tr>'}</tbody></table>

  <h3>Redeem Keys</h3>
  <table><thead><tr><th>#</th><th>Key</th><th>Status</th><th>Used At</th><th>Order ID</th></tr></thead><tbody>${keyRows}</tbody></table>

  <div id="toast"></div>

  <script>
    const PASS = '${ADMIN_PASSWORD}';

    function showToast(msg, ok) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.color = ok ? '#39d98a' : '#e05c4b';
      t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 4000);
    }

    async function verifyOrder(orderId) {
      if (!confirm('Verify order ' + orderId + '? This will pick an unused key and email it to the customer.')) return;
      const r = await fetch('/api/verify-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, password: PASS })
      });
      const d = await r.json();
      showToast(d.message, d.success);
      if (d.success) setTimeout(() => location.reload(), 2000);
    }

    async function rejectOrder(orderId) {
      const reason = prompt('Rejection reason (optional):') || 'Payment could not be verified.';
      if (!confirm('Reject order ' + orderId + '? Customer will be notified by email.')) return;
      const r = await fetch('/api/reject-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, password: PASS, reason })
      });
      const d = await r.json();
      showToast(d.message, d.success);
      if (d.success) setTimeout(() => location.reload(), 2000);
    }
  </script>
  </body></html>`);
});

/* ============================================================
   Health check + keep-alive ping
   ============================================================ */
app.get('/', (req, res) => {
  res.json({ status: 'online', service: 'XPX Gaming Key Verification API', version: '3.0.0' });
});

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

/* ============================================================
   START
   ============================================================ */
app.listen(PORT, () => {
  console.log(`\n🎮 XPX Gaming Backend v3.0 running on port ${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin?password=${ADMIN_PASSWORD}`);
  console.log(`   EXE file: ${fs.existsSync(EXE_FILE) ? '✅ present' : '❌ MISSING'}\n`);
});
