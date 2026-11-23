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

function parseConfigFile(filePath, baseDir) {
  if (!filePath.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid config storage path');
  }
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const url = sanitizeText(parsed.appsScriptUrl, 500);
  if (url && !isValidAppsScriptUrl(url)) return null;
  return {
    appsScriptUrl: url,
    sheetName: sanitizeText(parsed.sheetName, 120),
    spreadsheetId: sanitizeText(parsed.spreadsheetId, 120),
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
      if (cfg && cfg.appsScriptUrl) return cfg;
    } catch {
      // Ignore unreadable candidate
    }
  }

  const envUrl = sanitizeText(process.env.WMS_APPS_SCRIPT_URL || '', 500);
  if (envUrl && isValidAppsScriptUrl(envUrl)) {
    return {
      appsScriptUrl: envUrl,
      sheetName: sanitizeText(process.env.WMS_SHEET_NAME || '', 120),
      spreadsheetId: sanitizeText(process.env.WMS_SPREADSHEET_ID || '', 120),
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

app.use('/.data', (_req, res) => {
  res.status(403).json({ ok: false, error: 'Forbidden' });
});
app.use('/config', (_req, res) => {
  res.status(403).json({ ok: false, error: 'Forbidden' });
});

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname)));

app.get('/vendor/xlsx.full.min.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/xlsx/dist/xlsx.full.min.js'));
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

  if (!clear) {
    if (!rawUrl || !isValidAppsScriptUrl(rawUrl)) {
      return res.status(400).json({ ok: false, error: 'URL Google Apps Script tidak valid (harus https://script.google.com/macros/...)' });
    }
  }

  const nextConfig = clear
    ? { appsScriptUrl: '', sheetName: '', spreadsheetId: '', lastUpdated: '-' }
    : {
        appsScriptUrl: rawUrl,
        sheetName: sanitizeText(body.sheetName, 120),
        spreadsheetId: sanitizeText(body.spreadsheetId, 120),
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
