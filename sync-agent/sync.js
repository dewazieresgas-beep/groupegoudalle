'use strict';

/**
 * Agent de synchronisation Goudalle
 *
 * Tourne en arrière-plan sur le PC du conducteur.
 * Quand le WiFi de l'entreprise est détecté, synchronise automatiquement
 * tous les dossiers chantier (data.json + fichiers) vers le serveur intranet.
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');

// ── Config ────────────────────────────────────────────────────────────────────
const DIR         = __dirname;
const CONFIG_PATH = path.join(DIR, 'config.json');
const STATE_PATH  = path.join(DIR, 'sync-state.json');
const LOG_PATH    = path.join(DIR, 'sync.log');
const MAX_LOG_MB  = 5;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('[ERREUR] config.json introuvable.\nCopiez config.example.json en config.json et remplissez-le.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return {}; }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg) {
  const ts   = new Date().toLocaleString('fr-FR', { hour12: false });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    // Rotation si log > MAX_LOG_MB
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > MAX_LOG_MB * 1024 * 1024) {
      fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    }
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch { /* ignore log errors */ }
}

// ── Détection WiFi (Windows) ──────────────────────────────────────────────────
function getWifiSSID() {
  return new Promise(resolve => {
    exec('netsh wlan show interfaces', { encoding: 'utf8' }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const m = (stdout || '').match(/\bSSID\s+:\s+(.+)/);
      resolve(m ? m[1].trim() : null);
    });
  });
}

// ── Appels API ────────────────────────────────────────────────────────────────
function apiRequest(config, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const baseUrl = config.serverUrl.replace(/\/$/, '');
    const fullUrl = new URL(baseUrl + urlPath);
    const payload = JSON.stringify(body);
    const mod     = fullUrl.protocol === 'https:' ? https : http;

    const opts = {
      hostname : fullUrl.hostname,
      port     : fullUrl.port || (fullUrl.protocol === 'https:' ? 443 : 3000),
      path     : fullUrl.pathname + fullUrl.search,
      method,
      headers  : {
        'Content-Type'     : 'application/json',
        'Content-Length'   : Buffer.byteLength(payload),
        'x-goudalle-token' : config.serverToken,
      },
    };

    const req = mod.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data, status: res.statusCode }); }
      });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Scan récursif des fichiers d'un dossier chantier ─────────────────────────
function scanFiles(dir, rootDir, lastSyncMs, acc = []) {
  if (!fs.existsSync(dir)) return acc;

  const IGNORE = new Set(['data.json', 'index.html', 'sync-state.json', 'thumbs.db', 'desktop.ini']);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      scanFiles(full, rootDir, lastSyncMs, acc);
    } else if (entry.isFile() && !IGNORE.has(entry.name.toLowerCase())) {
      const stat  = fs.statSync(full);
      if (!lastSyncMs || stat.mtimeMs > lastSyncMs) {
        acc.push({
          fullPath : full,
          relPath  : path.relative(rootDir, full).replace(/\\/g, '/'),
          size     : stat.size,
          mtime    : stat.mtimeMs,
        });
      }
    }
  }
  return acc;
}

// ── Synchronisation d'un chantier ─────────────────────────────────────────────
async function syncChantier(chantierPath, state, config) {
  const dataPath = path.join(chantierPath, 'data.json');
  if (!fs.existsSync(dataPath)) return;

  let data;
  try { data = JSON.parse(fs.readFileSync(dataPath, 'utf8')); }
  catch (e) { log(`  ✗ data.json illisible (${path.basename(chantierPath)}): ${e.message}`); return; }

  const chantierName = data.infos?.nom || path.basename(chantierPath);
  const key          = chantierPath;
  const chantierState = { ...state[key] };

  log(`→ ${chantierName}`);

  // 1. Synchroniser data.json (workflow + infos)
  let chantierId = data.meta?.serverId || chantierState.serverId || null;
  try {
    const res = await apiRequest(config, 'POST', '/api/chantiers/sync', { data, chantierId });
    if (res.success) {
      chantierId = res.chantierId;
      // Mémoriser l'ID serveur dans data.json pour les syncs suivantes
      if (data.meta?.serverId !== chantierId) {
        data.meta = { ...data.meta, serverId: chantierId };
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
      }
      chantierState.serverId = chantierId;
      log(`  ✓ Workflow (id: ${chantierId}${res.created ? ', nouveau' : ''})`);
    } else {
      log(`  ✗ Workflow: ${res.error || JSON.stringify(res)}`);
      return;
    }
  } catch (e) {
    log(`  ✗ Serveur injoignable: ${e.message}`);
    return;
  }

  // 2. Synchroniser les fichiers (uniquement ceux modifiés depuis la dernière synchro)
  const lastSyncMs = chantierState.lastSync ? new Date(chantierState.lastSync).getTime() : null;
  const files      = scanFiles(chantierPath, chantierPath, lastSyncMs);

  const MAX_FILE_MB = config.maxFileMB || 40;

  if (files.length === 0) {
    log(`  ✓ Aucun nouveau fichier`);
  } else {
    log(`  → ${files.length} fichier(s) à envoyer`);
    let ok = 0, fail = 0, skipped = 0;
    for (const f of files) {
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        log(`  ! Ignoré (>${MAX_FILE_MB} Mo) : ${f.relPath}`);
        skipped++;
        continue;
      }
      try {
        const content_b64 = fs.readFileSync(f.fullPath).toString('base64');
        const res = await apiRequest(config, 'POST', `/api/chantiers/${chantierId}/file`, {
          path     : f.relPath,
          content_b64,
          mtime    : new Date(f.mtime).toISOString(),
          size     : f.size,
        });
        if (res.success) { ok++; }
        else { log(`  ✗ ${f.relPath}: ${res.error || '?'}`); fail++; }
      } catch (e) {
        log(`  ✗ ${f.relPath}: ${e.message}`); fail++;
      }
    }
    const parts = [`${ok} ok`];
    if (fail)    parts.push(`${fail} erreur(s)`);
    if (skipped) parts.push(`${skipped} ignoré(s)`);
    log(`  ✓ Fichiers: ${parts.join(', ')}`);
  }

  chantierState.lastSync = new Date().toISOString();
  state[key] = chantierState;
}

// ── Synchronisation de tous les chantiers ─────────────────────────────────────
async function syncAll(config, state) {
  const folder = config.chantiersFolder;
  if (!fs.existsSync(folder)) {
    log(`⚠  Dossier introuvable : ${folder}`);
    return;
  }

  const dirs = fs.readdirSync(folder, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => path.join(folder, e.name))
    .filter(p => fs.existsSync(path.join(p, 'data.json')));

  if (dirs.length === 0) {
    log('Aucun dossier chantier trouvé (data.json absent).');
    return;
  }

  log(`━━ Synchronisation de ${dirs.length} chantier(s) ━━`);
  for (const dir of dirs) {
    await syncChantier(dir, state, config);
  }
  saveState(state);
  log(`━━ Terminé ━━\n`);
}

// ── Boucle principale ─────────────────────────────────────────────────────────
async function main() {
  const config = loadConfig();
  const state  = loadState();
  const intervalMs = (config.syncIntervalMinutes || 5) * 60 * 1000;

  log('════════════════════════════════════════');
  log('  Agent de synchronisation Goudalle');
  log(`  Dossier : ${config.chantiersFolder}`);
  log(`  WiFi    : ${config.companyWifi}`);
  log(`  Délai   : ${config.syncIntervalMinutes || 5} min`);
  log('════════════════════════════════════════\n');

  let lastSyncDone = false;

  async function tick() {
    const ssid    = await getWifiSSID();
    const onWifi  = ssid === config.companyWifi || config.companyWifi === '*';

    if (onWifi) {
      if (!lastSyncDone) log(`WiFi entreprise détecté : "${ssid}"`);
      await syncAll(config, state);
      lastSyncDone = true;
    } else {
      if (lastSyncDone) {
        log(`WiFi changé (${ssid || 'déconnecté'}) — synchronisation suspendue.\n`);
        lastSyncDone = false;
      }
    }
  }

  await tick();
  setInterval(tick, intervalMs);
}

main().catch(err => {
  log(`ERREUR FATALE: ${err.message}`);
  process.exit(1);
});
