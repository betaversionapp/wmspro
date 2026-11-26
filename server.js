const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(__dirname, '.data');
const CONFIG_DIR = path.resolve(__dirname, 'config');
const CONFIG_FILE = path.resolve(DATA_DIR, 'sheet-config.json');
const WORKSPACE_CONFIG_FILE = path.resolve(CONFIG_DIR, 'sheet-config.json');

function isValidAppsScriptUrl(raw) {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'script.google.com' && host !== 'script.googleusercontent.com') return false;
    if (host === 'script.google.com' && !parsed.pathname.startsWith('/macros/')) return false;
    return true;
  } catch {
    return false;
  }
}

function sanitizeText(val, maxLen = 120) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function isValidSpreadsheetId(raw) {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return /^[A-Za-z0-9_-]{10,120}$/.test(trimmed);
}

function parseConfigFile(filePath, baseDir) {
  if (!filePath.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid config storage path');
  }
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const url = sanitizeText(parsed.appsScriptUrl, 500);
  if (url && !isValidAppsScriptUrl(url)) return null;
  const spreadsheetId = sanitizeText(parsed.spreadsheetId, 120);
  return {
    appsScriptUrl: url,
    sheetName: sanitizeText(parsed.sheetName, 120),
    spreadsheetId: isValidSpreadsheetId(spreadsheetId) ? spreadsheetId : '',
    lastUpdated: sanitizeText(parsed.lastUpdated, 80) || '-'
  };
}

function readSharedSheetConfig() {
  const candidates = [
    [WORKSPACE_CONFIG_FILE, CONFIG_DIR],
    [CONFIG_FILE, DATA_DIR]
  ];
  for (const [filePath, baseDir] of candidates) {
    try {
      const cfg = parseConfigFile(filePath, baseDir);
      if (cfg && (cfg.appsScriptUrl || cfg.spreadsheetId)) return cfg;
    } catch {
      // Ignore unreadable candidate
    }
  }

  const envUrl = sanitizeText(process.env.WMS_APPS_SCRIPT_URL || '', 500);
  const envSid = sanitizeText(process.env.WMS_SPREADSHEET_ID || '', 120);
  if ((envUrl && isValidAppsScriptUrl(envUrl)) || (envSid && isValidSpreadsheetId(envSid))) {
    return {
      appsScriptUrl: isValidAppsScriptUrl(envUrl) ? envUrl : '',
      sheetName: sanitizeText(process.env.WMS_SHEET_NAME || '', 120),
      spreadsheetId: isValidSpreadsheetId(envSid) ? envSid : '',
      lastUpdated: 'Server Env'
    };
  }
  return { appsScriptUrl: '', sheetName: '', spreadsheetId: '', lastUpdated: '-' };
}

function writeConfigAtomically(filePath, baseDir, cfg) {
  if (!filePath.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid config storage path');
  }
  fs.mkdirSync(baseDir, { recursive: true });
  const tmpFile = path.resolve(baseDir, 'sheet-config.tmp.json');
  if (!tmpFile.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid temp path');
  }
  fs.writeFileSync(tmpFile, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmpFile, filePath);
}

function writeSharedSheetConfig(cfg) {
  writeConfigAtomically(WORKSPACE_CONFIG_FILE, CONFIG_DIR, cfg);
  try {
    writeConfigAtomically(CONFIG_FILE, DATA_DIR, cfg);
  } catch {
    // Non-fatal mirror to .data
  }
}

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/favicon.ico', (_req, res) => {
  const pubIcon = path.resolve(__dirname, 'public', 'favicon.ico');
  const rootIcon = path.resolve(__dirname, 'favicon.ico');
  if (fs.existsSync(pubIcon)) return res.sendFile(pubIcon);
  if (fs.existsSync(rootIcon)) return res.sendFile(rootIcon);
  return res.status(204).end();
});

app.get('/vendor/xlsx.full.min.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/xlsx/dist/xlsx.full.min.js'));
});

function readFirebaseConfig() {
  const envApiKey = sanitizeText(process.env.FIREBASE_API_KEY || '', 160);
  const envProjectId = sanitizeText(process.env.FIREBASE_PROJECT_ID || '', 120);
  if (envApiKey && envProjectId) {
    return {
      projectId: envProjectId,
      appId: sanitizeText(process.env.FIREBASE_APP_ID || '', 160),
      apiKey: envApiKey,
      authDomain: sanitizeText(process.env.FIREBASE_AUTH_DOMAIN || `${envProjectId}.firebaseapp.com`, 160),
      storageBucket: sanitizeText(process.env.FIREBASE_STORAGE_BUCKET || '', 160),
      messagingSenderId: sanitizeText(process.env.FIREBASE_MESSAGING_SENDER_ID || '', 80),
      oAuthClientId: sanitizeText(process.env.FIREBASE_OAUTH_CLIENT_ID || '', 180)
    };
  }

  const fbPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (!fbPath.startsWith(__dirname + path.sep) || !fs.existsSync(fbPath)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(fbPath, 'utf8'));
  return {
    projectId: sanitizeText(raw.projectId, 120),
    appId: sanitizeText(raw.appId, 160),
    apiKey: sanitizeText(raw.apiKey, 160),
    authDomain: sanitizeText(raw.authDomain, 160),
    storageBucket: sanitizeText(raw.storageBucket, 160),
    messagingSenderId: sanitizeText(raw.messagingSenderId, 80),
    oAuthClientId: sanitizeText(raw.oAuthClientId, 180)
  };
}

app.get('/api/firebase-config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const config = readFirebaseConfig();
    if (!config || !config.apiKey) {
      return res.status(404).json({ ok: false, error: 'Firebase config not found' });
    }
    return res.json({ ok: true, config });
  } catch {
    return res.status(500).json({ ok: false, error: 'Invalid Firebase config' });
  }
});

app.get('/api/sheet-config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const config = readSharedSheetConfig();
  res.json({ ok: true, config });
});

app.post('/api/sheet-config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.get('X-Requested-With') !== 'WMSPro') {
    return res.status(403).json({ ok: false, error: 'Missing required header' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const clear = body.clear === true;
  const rawUrl = sanitizeText(body.appsScriptUrl, 500);
  const rawSid = sanitizeText(body.spreadsheetId, 120);

  if (!clear) {
    if (rawUrl && !isValidAppsScriptUrl(rawUrl)) {
      return res.status(400).json({ ok: false, error: 'URL Google Apps Script tidak valid (harus https://script.google.com/macros/...)' });
    }
    if (rawSid && !isValidSpreadsheetId(rawSid)) {
      return res.status(400).json({ ok: false, error: 'Format Spreadsheet ID tidak valid' });
    }
    if (!rawUrl && !rawSid) {
      return res.status(400).json({ ok: false, error: 'Masukkan URL Apps Script atau pilih Google Spreadsheet ID' });
    }
  }

  const nextConfig = clear
    ? { appsScriptUrl: '', sheetName: '', spreadsheetId: '', lastUpdated: '-' }
    : {
        appsScriptUrl: rawUrl,
        sheetName: sanitizeText(body.sheetName, 120),
        spreadsheetId: rawSid,
        lastUpdated: sanitizeText(body.lastUpdated, 80) || new Date().toLocaleString('id-ID')
      };

  try {
    writeSharedSheetConfig(nextConfig);
    return res.json({ ok: true, config: nextConfig });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Gagal menyimpan konfigurasi server' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WMS Pro server running at http://0.0.0.0:${PORT}`);
});
