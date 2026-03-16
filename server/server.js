/**
 * Serveur API pour l'intranet Groupe Goudalle
 * 
 * Stockage : SQLite (fichier unique goudalle.db)
 * Toutes les données sont dans server/goudalle.db
 * 
 * Pour lancer : node server.js
 * Par défaut sur le port 3000
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// Fichier de stockage JSON
const DB_PATH = path.join(__dirname, 'goudalle.json');

// ─── INITIALISATION DU STOCKAGE ──────────────────────────────────────────────────

let store = {};
if (fs.existsSync(DB_PATH)) {
  try { store = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch { store = {}; }
}

function saveStore() {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf8');
}

// ─── UTILITAIRES ────────────────────────────────────────────────────────────────

function dbGet(key, defaultValue) {
  return key in store ? store[key] : defaultValue;
}

function dbSet(key, value) {
  store[key] = value;
  saveStore();
}

// ─── MIDDLEWARES ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Sert les fichiers statiques du site (HTML, CSS, JS, images)
app.use(express.static(path.join(__dirname, '..')));

// ─── ROUTES : UTILISATEURS ──────────────────────────────────────────────────────

app.get('/api/users', (req, res) => {
  res.json(dbGet('users', {}));
});

app.put('/api/users', (req, res) => {
  dbSet('users', req.body);
  res.json({ success: true });
});

// ─── ROUTES : CODE ADMIN ────────────────────────────────────────────────────────

app.get('/api/admin-code', (req, res) => {
  res.json(dbGet('admin_code', { code: '0000' }));
});

app.put('/api/admin-code', (req, res) => {
  dbSet('admin_code', req.body);
  res.json({ success: true });
});

// ─── ROUTES : AUDIT ─────────────────────────────────────────────────────────────

app.get('/api/audit', (req, res) => {
  res.json(dbGet('audit', []));
});

app.put('/api/audit', (req, res) => {
  dbSet('audit', req.body);
  res.json({ success: true });
});

// ─── ROUTES : KPIs GOUDALLE MAÇONNERIE ─────────────────────────────────────────

app.get('/api/kpis', (req, res) => {
  res.json(dbGet('kpis', []));
});

app.put('/api/kpis', (req, res) => {
  dbSet('kpis', req.body);
  res.json({ success: true });
});

// ─── ROUTES : SEUILS KPI ────────────────────────────────────────────────────────

app.get('/api/thresholds', (req, res) => {
  res.json(dbGet('thresholds', { ratioThreshold: 5 }));
});

app.put('/api/thresholds', (req, res) => {
  dbSet('thresholds', req.body);
  res.json({ success: true });
});

// ─── ROUTES : CBCO CHIFFRE D'AFFAIRES ──────────────────────────────────────────

app.get('/api/cbco', (req, res) => {
  res.json(dbGet('cbco', []));
});

app.put('/api/cbco', (req, res) => {
  dbSet('cbco', req.body);
  res.json({ success: true });
});

// ─── ROUTES : CBCO PRODUCTIVITÉ USINE ────────────────────────────────────────────

app.get('/api/cbco-productivite', (req, res) => {
  res.json(dbGet('cbco_productivite', []));
});

app.put('/api/cbco-productivite', (req, res) => {
  dbSet('cbco_productivite', req.body);
  res.json({ success: true });
});

app.get('/api/cbco-securite', (req, res) => {
  res.json(dbGet('cbco_securite', {}));
});

app.put('/api/cbco-securite', (req, res) => {
  dbSet('cbco_securite', req.body);
  res.json({ success: true });
});

// ─── ROUTES : CBCO COMMERCIAL ───────────────────────────────────────────────────

app.get('/api/cbco-commercial', (req, res) => {
  res.json(dbGet('cbco_commercial', []));
});

app.put('/api/cbco-commercial', (req, res) => {
  dbSet('cbco_commercial', req.body);
  res.json({ success: true });
});

// ─── ROUTES : SYLVE BALANCE ─────────────────────────────────────────────────────

app.get('/api/sylve-balance', (req, res) => {
  res.json(dbGet('sylve_balance', { cbco: [], gc: [], gm: [] }));
});

app.put('/api/sylve-balance', (req, res) => {
  dbSet('sylve_balance', req.body);
  res.json({ success: true });
});

// ─── ROUTES : SYLVE CA ──────────────────────────────────────────────────────────

app.get('/api/sylve-ca', (req, res) => {
  res.json(dbGet('sylve_ca', { cbco: 0, gc: 0, gm: 0, bilanDate: '' }));
});

app.put('/api/sylve-ca', (req, res) => {
  dbSet('sylve_ca', req.body);
  res.json({ success: true });
});

// ─── ROUTES : SYLVE PAIEMENTS EN ATTENTE ────────────────────────────────────────

app.get('/api/sylve-paiements', (req, res) => {
  res.json(dbGet('sylve_paiements', {}));
});

app.put('/api/sylve-paiements', (req, res) => {
  dbSet('sylve_paiements', req.body);
  res.json({ success: true });
});

// ─── ROUTES : RAPPELS EMAIL ─────────────────────────────────────────────────────

app.get('/api/reminders-config', (req, res) => {
  res.json(dbGet('reminders_config', {
    enabled: false, siteUrl: '',
    emailjsServiceId: '', emailjsTemplateId: '', emailjsPublicKey: '',
    indicators: { gm: { recurrence: 'hebdomadaire' }, cbco: { recurrence: 'mensuel' } }
  }));
});

app.put('/api/reminders-config', (req, res) => {
  dbSet('reminders_config', req.body);
  res.json({ success: true });
});

app.get('/api/reminders-sent', (req, res) => {
  res.json(dbGet('reminders_sent', []));
});

app.put('/api/reminders-sent', (req, res) => {
  dbSet('reminders_sent', req.body);
  res.json({ success: true });
});

// ─── EXCEL GOUDALLE MAÇONNERIE : CONFIG + WATCHER + AUTO-IMPORT ─────────────────

// Fonction qui parse le fichier Excel et retourne les données
function parseGMExcel(cfg) {
  const excelPath = path.join(cfg.folder, cfg.filename);
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Fichier introuvable : "${excelPath}"`);
  }
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[cfg.sheet];
  if (!sheet) {
    throw new Error(`Feuille "${cfg.sheet}" introuvable. Feuilles disponibles : ${workbook.SheetNames.join(', ')}`);
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const toNum = v => (v !== null && v !== undefined && v !== '' && !isNaN(parseFloat(v))) ? parseFloat(v) : null;
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const m3Raw = row[2]; // Colonne C = référence, ligne ignorée si vide
    if (m3Raw === null || m3Raw === undefined || m3Raw === '') continue;
    const yearRaw = row[0]; const weekRaw = row[1];
    if (!yearRaw || !weekRaw) continue;
    const weekMatch = String(weekRaw).match(/(\d+)/);
    if (!weekMatch) continue;
    const week = parseInt(weekMatch[1]);
    const year = parseInt(yearRaw);
    if (isNaN(year) || isNaN(week)) continue;
    data.push({
      year, week,
      m3:              toNum(m3Raw),
      hours:           toNum(row[3]),   // D : Heures MO
      tempsBeton:      toNum(row[5]),   // F : Heures béton
      tempsAciers:     toNum(row[6]),   // G : Heures acier
      tempsChargement: toNum(row[7]),   // H : Heures Chargement
      tempsCentrale:   toNum(row[8]),   // I : Heures Centrale à béton
      qtAcierFaconne:  toNum(row[9]),   // J : Qté Acier façonné (T)
      comment:         row[15] ? String(row[15]).trim() : ''  // P : Commentaire
    });
  }
  return data;
}

// Fusionne les données Excel dans le store KPIs
function applyExcelDataToKpis(data) {
  const existing = dbGet('kpis', []);
  const now = new Date().toISOString();
  let added = 0, updated = 0;
  for (const row of data) {
    const idx = existing.findIndex(k => k.year === row.year && k.week === row.week);
    if (idx >= 0) {
      existing[idx] = { ...existing[idx], ...row, updatedAt: now, updatedBy: 'excel-auto' };
      updated++;
    } else {
      const maxId = existing.reduce((max, k) => Math.max(max, k.id || 0), 0);
      existing.push({ id: maxId + 1, ...row, status: 'published', createdAt: now, createdBy: 'excel-auto', updatedAt: now, updatedBy: 'excel-auto' });
      added++;
    }
  }
  dbSet('kpis', existing);
  return { added, updated };
}

// Gestionnaire du watcher (référence pour pouvoir l'arrêter)
let gmWatcher = null;

function startGMWatcher(cfg) {
  if (gmWatcher) { gmWatcher.stop(); gmWatcher = null; }
  const excelPath = path.join(cfg.folder, cfg.filename);
  if (!fs.existsSync(excelPath)) {
    console.log(`[GM-Watch] Fichier introuvable, surveillance impossible : ${excelPath}`);
    return;
  }
  // fs.watchFile utilise le polling (compatible réseau/lecteurs mappés)
  fs.watchFile(excelPath, { interval: 10000 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs) {
      console.log(`[GM-Watch] Modification détectée dans ${cfg.filename}, import automatique...`);
      try {
        const data = parseGMExcel(cfg);
        const result = applyExcelDataToKpis(data);
        const cfg2 = dbGet('gm_excel_config', {});
        dbSet('gm_excel_config', { ...cfg2, lastSync: new Date().toISOString(), lastSyncResult: result });
        console.log(`[GM-Watch] Import OK — ${result.added} ajouté(s), ${result.updated} mis à jour`);
      } catch (e) {
        console.error(`[GM-Watch] Erreur : ${e.message}`);
      }
    }
  });
  gmWatcher = { stop: () => fs.unwatchFile(excelPath) };
  console.log(`[GM-Watch] Surveillance active : ${excelPath}`);
}

// Au démarrage : reprendre la surveillance si une config existait déjà
(function resumeWatcherOnStartup() {
  const cfg = dbGet('gm_excel_config', null);
  if (cfg && cfg.active) {
    console.log(`[GM-Watch] Reprise de la surveillance au démarrage...`);
    startGMWatcher(cfg);
  }
})();

// ─── ROUTES : CONFIG EXCEL GM ────────────────────────────────────────────────────

// Lire la config actuelle
app.get('/api/gm-excel-config', (req, res) => {
  res.json(dbGet('gm_excel_config', null));
});

// Sauvegarder la config et lancer la surveillance + premier import
app.put('/api/gm-excel-config', (req, res) => {
  const { folder, filename, sheet } = req.body;
  if (!folder || !filename || !sheet) {
    return res.status(400).json({ success: false, error: 'Champs manquants : folder, filename, sheet' });
  }
  try {
    const data = parseGMExcel({ folder, filename, sheet });
    const result = applyExcelDataToKpis(data);
    const cfg = { folder, filename, sheet, active: true, lastSync: new Date().toISOString(), lastSyncResult: result };
    dbSet('gm_excel_config', cfg);
    startGMWatcher(cfg);
    res.json({ success: true, result, rowCount: data.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Désynchroniser (arrêter la surveillance)
app.delete('/api/gm-excel-config', (req, res) => {
  if (gmWatcher) { gmWatcher.stop(); gmWatcher = null; }
  dbSet('gm_excel_config', null);
  res.json({ success: true });
});

// Import manuel (forcer une relecture immédiate)
app.post('/api/gm-import-excel', (req, res) => {
  const cfg = dbGet('gm_excel_config', null);
  if (!cfg || !cfg.active) {
    return res.status(400).json({ success: false, error: 'Aucune synchronisation configurée.' });
  }
  try {
    const data = parseGMExcel(cfg);
    const result = applyExcelDataToKpis(data);
    dbSet('gm_excel_config', { ...cfg, lastSync: new Date().toISOString(), lastSyncResult: result });
    res.json({ success: true, result, source: cfg.filename });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── ROUTE FALLBACK ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ─── DÉMARRAGE ───────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log(`║   Intranet Groupe Goudalle - Serveur       ║`);
  console.log(`║   http://localhost:${PORT}                    ║`);
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
  console.log(`🗄️  Base de données : ${DB_PATH}`);
  console.log('✅ Serveur prêt - accessible depuis le réseau');
  console.log('');
});
