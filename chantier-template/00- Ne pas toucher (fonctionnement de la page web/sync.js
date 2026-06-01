'use strict';

/**
 * Agent de synchronisation — Dossier chantier Groupe Goudalle
 *
 * Ce fichier est dans le dossier du chantier.
 * Il synchronise automatiquement ce chantier vers le serveur intranet
 * dès que le WiFi de l'entreprise est détecté.
 *
 * Lancement manuel  : node sync.js
 * Au démarrage auto : double-cliquer installer.bat
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');

// ── Chemins (tout est dans le dossier du chantier) ────────────────────────────
const CHANTIER_DIR  = __dirname;
const CONFIG_PATH   = path.join(CHANTIER_DIR, 'sync-config.json');
const DATA_PATH     = path.join(CHANTIER_DIR, 'data.json');
const STATE_PATH    = path.join(CHANTIER_DIR, 'sync-state.json');
const LOG_PATH      = path.join(CHANTIER_DIR, 'sync.log');

// ── Config ────────────────────────────────────────────────────────────────────
function loadConfig() {
  // Source principale : section config dans data.json (remplie via index.html)
  let fromData = {};
  if (fs.existsSync(DATA_PATH)) {
    try {
      const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      if (d.config) fromData = d.config;
    } catch {}
  }

  // Fallback : sync-config.json
  let fromFile = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { fromFile = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  }

  const cfg = { ...fromFile, ...fromData };

  if (!cfg.serverUrl || cfg.serverUrl.includes('ADRESSE')) {
    console.error('[ERREUR] Remplir l\'adresse du serveur dans index.html (section Synchronisation) ou dans sync-config.json.');
    process.exit(1);
  }
  return cfg;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return {}; }
}

function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// ── Logs ──────────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toLocaleString('fr-FR', { hour12: false })}] ${msg}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 4 * 1024 * 1024)
      fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch {}
}

// ── Détection WiFi (Windows) ──────────────────────────────────────────────────
function getWifiSSID() {
  return new Promise(resolve => {
    exec('netsh wlan show interfaces', { encoding: 'utf8' }, (err, out) => {
      if (err) { resolve(null); return; }
      const m = (out || '').match(/\bSSID\s+:\s+(.+)/);
      resolve(m ? m[1].trim() : null);
    });
  });
}

// ── HTTP utilitaire ───────────────────────────────────────────────────────────
function httpRequest(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const u       = new URL(url);
    const payload = body ? JSON.stringify(body) : '';
    const mod     = u.protocol === 'https:' ? https : http;
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    if (token) headers['x-goudalle-token'] = token;

    const req = mod.request(
      { hostname: u.hostname, port: u.port || 3000, path: u.pathname, method, headers },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ raw: data }); }
        });
      }
    );
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Récupérer le token depuis /api/health ────────────────────────────────────
async function fetchToken(cfg) {
  const res = await httpRequest('GET', cfg.serverUrl.replace(/\/$/, '') + '/api/health', null, null);
  if (!res.token) throw new Error('Token non reçu depuis /api/health');
  return res.token;
}

// ── Scan des fichiers à synchroniser ─────────────────────────────────────────
const IGNORE = new Set(['data.json', 'index.html', 'Suivi-Chantier.html', 'sync.js', 'sync.bat', 'installer.bat',
                        'sync-config.json', 'sync-state.json', 'sync.log', 'sync.log.old', 'package.json']);

function scanFiles(dir, root, lastSyncMs, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      scanFiles(full, root, lastSyncMs, acc);
    } else if (!IGNORE.has(e.name)) {
      const stat = fs.statSync(full);
      if (!lastSyncMs || stat.mtimeMs > lastSyncMs) {
        acc.push({
          fullPath : full,
          relPath  : path.relative(root, full).replace(/\\/g, '/'),
          size     : stat.size,
        });
      }
    }
  }
  return acc;
}

// ── Synchronisation ───────────────────────────────────────────────────────────
async function sync(cfg) {
  if (!fs.existsSync(DATA_PATH)) {
    log('data.json introuvable — ouverture de index.html requise en premier.');
    return;
  }

  let data;
  try { data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch (e) { log('data.json illisible : ' + e.message); return; }

  const chantierName = data.infos?.nom || path.basename(CHANTIER_DIR);
  const state        = loadState();
  log(`━━ Synchronisation : ${chantierName} ━━`);

  // 1. Récupérer le token serveur
  let token;
  try { token = await fetchToken(cfg); }
  catch (e) { log('✗ Serveur inaccessible : ' + e.message); return; }

  const base = cfg.serverUrl.replace(/\/$/, '');

  // 2. Envoyer data.json → crée ou met à jour le chantier
  let chantierId = data.meta?.serverId || state.serverId || null;
  try {
    const res = await httpRequest('POST', base + '/api/chantiers/sync', { data, chantierId }, token);
    if (res.success) {
      chantierId = res.chantierId;
      if (data.meta?.serverId !== chantierId) {
        data.meta = { ...data.meta, serverId: chantierId };
        fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
      }
      state.serverId = chantierId;
      log(`✓ Workflow (id: ${chantierId}${res.created ? ' — nouveau chantier' : ''})`);
    } else {
      log('✗ Workflow : ' + (res.error || JSON.stringify(res))); return;
    }
  } catch (e) { log('✗ Workflow : ' + e.message); return; }

  // 3. Envoyer les fichiers nouveaux / modifiés
  const lastSyncMs = state.lastSync ? new Date(state.lastSync).getTime() : null;
  const files      = scanFiles(CHANTIER_DIR, CHANTIER_DIR, lastSyncMs);
  const maxMB      = cfg.maxFileMB || 40;

  if (!files.length) {
    log('✓ Aucun nouveau fichier');
  } else {
    log(`→ ${files.length} fichier(s) à envoyer`);
    let ok = 0, fail = 0, skip = 0;
    for (const f of files) {
      if (f.size > maxMB * 1024 * 1024) { log(`  ! Ignoré (>${maxMB} Mo) : ${f.relPath}`); skip++; continue; }
      try {
        const b64 = fs.readFileSync(f.fullPath).toString('base64');
        const res = await httpRequest('POST', `${base}/api/chantiers/${chantierId}/file`,
          { path: f.relPath, content_b64: b64, size: f.size }, token);
        res.success ? ok++ : (log(`  ✗ ${f.relPath}`), fail++);
      } catch (e) { log(`  ✗ ${f.relPath} : ${e.message}`); fail++; }
    }
    log(`✓ Fichiers : ${ok} ok${fail ? `, ${fail} erreur(s)` : ''}${skip ? `, ${skip} ignoré(s)` : ''}`);
  }

  state.lastSync = new Date().toISOString();
  saveState(state);
  log(`━━ Terminé — ${new Date().toLocaleTimeString('fr-FR')} ━━\n`);
}

// ── Serveur de contrôle local ─────────────────────────────────────────────────
// Permet à index.html de déclencher une sync et d'afficher le statut en temps réel.
// Port stable dérivé du chemin du dossier (≠ par chantier → pas de conflit).

function hashPort(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return ((h >>> 0) % 8000) + 20000; // entre 20000 et 28000
}

const CONTROL_PORT = hashPort(CHANTIER_DIR);
let syncInProgress = false;

function startControlServer(cfg) {
  const srv = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end('{}'); return; }

    const state = loadState();

    if (req.url === '/status' && req.method === 'GET') {
      res.end(JSON.stringify({
        running   : true,
        syncing   : syncInProgress,
        lastSync  : state.lastSync || null,
        chantier  : path.basename(CHANTIER_DIR),
      }));

    } else if (req.url === '/sync' && req.method === 'POST') {
      if (syncInProgress) { res.end(JSON.stringify({ queued: true })); return; }
      syncInProgress = true;
      res.end(JSON.stringify({ started: true }));
      try { await sync(cfg); } finally { syncInProgress = false; }

    } else {
      res.writeHead(404); res.end('{}');
    }
  });

  srv.on('error', () =>
    log(`Port ${CONTROL_PORT} déjà utilisé — contrôle depuis index.html désactivé pour ce chantier.`)
  );

  srv.listen(CONTROL_PORT, '127.0.0.1', () => {
    log(`Contrôle local : http://127.0.0.1:${CONTROL_PORT}/status`);
    const st = loadState();
    st.localPort = CONTROL_PORT;
    saveState(st);
  });
}

// ── Boucle principale ─────────────────────────────────────────────────────────
async function main() {
  const cfg         = loadConfig();
  const intervalMs  = (cfg.syncIntervalMinutes || 5) * 60 * 1000;
  let lastOnWifi    = false;

  log('════════════════════════════════════════');
  log(`  Sync Goudalle — ${path.basename(CHANTIER_DIR)}`);
  log(`  Serveur : ${cfg.serverUrl}`);
  log(`  WiFi    : ${cfg.companyWifi}`);
  log(`  Délai   : ${cfg.syncIntervalMinutes || 5} min`);
  log('════════════════════════════════════════\n');

  startControlServer(cfg);

  async function tick() {
    const ssid   = await getWifiSSID();
    const onWifi = ssid === cfg.companyWifi || cfg.companyWifi === '*';

    if (onWifi) {
      if (!lastOnWifi) log(`WiFi entreprise détecté : "${ssid}"`);
      lastOnWifi = true;
      await sync(cfg);
    } else {
      if (lastOnWifi) log(`WiFi changé (${ssid || 'hors connexion'}) — sync suspendue.\n`);
      lastOnWifi = false;
    }
  }

  await tick();
  setInterval(tick, intervalMs);
}

main().catch(e => { log('ERREUR FATALE : ' + e.message); process.exit(1); });
