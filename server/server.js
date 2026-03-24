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
const { PDFParse } = require('pdf-parse');

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

// ─── ROUTES : ACHATS (IMPORTS ONAYA) ──────────────────────────────────────────────

app.get('/api/achats-imports', (req, res) => {
  res.json(dbGet('achats_imports', []));
});

app.put('/api/achats-imports', (req, res) => {
  dbSet('achats_imports', req.body);
  res.json({ success: true });
});

app.get('/api/achats-factures', (req, res) => {
  res.json(dbGet('achats_factures', []));
});

app.put('/api/achats-factures', (req, res) => {
  dbSet('achats_factures', req.body);
  res.json({ success: true });
});

app.get('/api/achats-lignes', (req, res) => {
  res.json(dbGet('achats_lignes', []));
});

app.put('/api/achats-lignes', (req, res) => {
  dbSet('achats_lignes', req.body);
  res.json({ success: true });
});

app.get('/api/achats-regles', (req, res) => {
  res.json(dbGet('achats_regles', []));
});

app.put('/api/achats-regles', (req, res) => {
  dbSet('achats_regles', req.body);
  res.json({ success: true });
});

app.post('/api/achats-parse-pdf', async (req, res) => {
  try {
    const contentBase64 = String(req.body?.contentBase64 || '');
    if (!contentBase64) {
      return res.status(400).json({ success: false, error: 'Champ contentBase64 manquant.' });
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    const parser = new PDFParse({ data: buffer });
    await parser.load();
    const parsed = await parser.getText();
    const text = String(parsed?.text || '').replace(/\r/g, '');
    await parser.destroy();
    res.json({ success: true, text, pages: Array.isArray(parsed?.pages) ? parsed.pages.length : null });
  } catch (e) {
    res.status(500).json({ success: false, error: `Erreur parsing PDF: ${e.message}` });
  }
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
      objectifRatio:   toNum(row[5]),   // F : Objectif h/m³
      tempsBeton:      toNum(row[6]),   // G : Heures béton
      tempsAciers:     toNum(row[7]),   // H : Heures acier
      tempsChargement: toNum(row[8]),   // I : Heures Chargement
      tempsCentrale:   toNum(row[9]),   // J : Heures Centrale à béton
      qtAcierFaconne:  toNum(row[10]),  // K : Qté Acier façonné (T)
      comment:         row[16] ? String(row[16]).trim() : ''  // Q : Commentaire
    });
  }
  return data;
}

// Fusionne les données Excel dans le store KPIs
// Les lignes supprimées de l'Excel sont aussi supprimées du site
function applyExcelDataToKpis(data) {
  const existing = dbGet('kpis', []);
  const now = new Date().toISOString();
  let added = 0, updated = 0, removed = 0;

  // Construire un Set des clés présentes dans l'Excel (année+semaine)
  const excelKeys = new Set(data.map(r => `${r.year}_${r.week}`));

  // Supprimer du store les entrées Excel qui n'existent plus dans le fichier
  // (on ne touche pas aux entrées créées manuellement, i.e. createdBy !== 'excel-auto')
  const kept = existing.filter(k => {
    const key = `${k.year}_${k.week}`;
    if (k.createdBy === 'excel-auto' && !excelKeys.has(key)) {
      removed++;
      return false;
    }
    return true;
  });

  // Ajouter ou mettre à jour les entrées Excel
  for (const row of data) {
    const idx = kept.findIndex(k => k.year === row.year && k.week === row.week);
    if (idx >= 0) {
      kept[idx] = { ...kept[idx], ...row, updatedAt: now, updatedBy: 'excel-auto' };
      updated++;
    } else {
      const maxId = kept.reduce((max, k) => Math.max(max, k.id || 0), 0);
      kept.push({ id: maxId + 1, ...row, status: 'published', createdAt: now, createdBy: 'excel-auto', updatedAt: now, updatedBy: 'excel-auto' });
      added++;
    }
  }

  dbSet('kpis', kept);
  return { added, updated, removed };
}

// Gestionnaire du watcher (référence pour pouvoir l'arrêter)
let gmWatcher = null;

function startGMWatcher(cfg) {
  if (gmWatcher) { clearInterval(gmWatcher); gmWatcher = null; }
  const excelPath = path.join(cfg.folder, cfg.filename);
  if (!fs.existsSync(excelPath)) {
    console.log(`[GM-Watch] Fichier introuvable, surveillance impossible : ${excelPath}`);
    return;
  }
  let lastMtime = fs.statSync(excelPath).mtimeMs;
  // Polling toutes les 30s (plus fiable que fs.watchFile sur lecteur réseau + Excel)
  gmWatcher = setInterval(() => {
    try {
      if (!fs.existsSync(excelPath)) return;
      const mtime = fs.statSync(excelPath).mtimeMs;
      if (mtime !== lastMtime) {
        lastMtime = mtime;
        console.log(`[GM-Watch] Modification détectée dans ${cfg.filename}, import automatique...`);
        try {
          const data = parseGMExcel(cfg);
          const result = applyExcelDataToKpis(data);
          const cfg2 = dbGet('gm_excel_config', {});
          dbSet('gm_excel_config', { ...cfg2, lastSync: new Date().toISOString(), lastSyncResult: result });
          console.log(`[GM-Watch] Import OK — ${result.added} ajouté(s), ${result.updated} mis à jour`);
        } catch (e) {
          console.error(`[GM-Watch] Erreur lecture : ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`[GM-Watch] Erreur stat : ${e.message}`);
    }
  }, 30000);
  console.log(`[GM-Watch] Surveillance active (polling 30s) : ${excelPath}`);
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
  if (gmWatcher) { clearInterval(gmWatcher); gmWatcher = null; }
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

// ─── EXCEL CBCO (CHIFFRE D'AFFAIRES) : CONFIG + WATCHER + AUTO-IMPORT ───────────

function parseCBCOMonthCell(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return { month: value.getMonth() + 1, year: value.getFullYear() };
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value, { date1904: true });
    if (parsed && parsed.y && parsed.m) {
      return { month: parsed.m, year: parsed.y };
    }
  }

  const raw = String(value).trim().toLowerCase().replace(/\./g, '');
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const match = normalized.match(/^([a-z]+)[\s\-_\/]*(\d{2,4})$/);
  if (!match) return null;

  const monthToken = match[1];
  const yearToken = match[2];
  const monthMap = {
    janv: 1, janvier: 1, jan: 1,
    fevr: 2, fevrier: 2, fev: 2,
    mars: 3,
    avr: 4, avril: 4,
    mai: 5,
    juin: 6,
    juil: 7, juillet: 7,
    aout: 8, aou: 8,
    sept: 9, septembre: 9,
    oct: 10, octobre: 10,
    nov: 11, novembre: 11,
    dec: 12, decembre: 12
  };

  const month = monthMap[monthToken];
  if (!month) return null;
  const yNum = parseInt(yearToken, 10);
  if (!Number.isFinite(yNum)) return null;
  const year = yearToken.length === 2 ? (2000 + yNum) : yNum;
  return { month, year };
}

function parseCBCOKiloValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  // Les cellules sont formatées en K€ mais stockées en valeur brute (EUR) dans l'XLS:
  // convertir systématiquement les numériques en K€ pour rester cohérent avec l'UI.
  if (typeof value === 'number' && Number.isFinite(value)) return value / 1000;
  const cleaned = String(value)
    .replace(/\s/g, '')
    .replace(/[kK€]/g, '')
    .replace(',', '.');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCBCOExcel(cfg) {
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
  const map = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const monthInfo = parseCBCOMonthCell(row[0]); // A : mois
    if (!monthInfo) continue;

    const montantChantiersCours = parseCBCOKiloValue(row[1]);    // B
    const montantChantiersTermines = parseCBCOKiloValue(row[2]); // C
    const montantTotal = montantChantiersCours + montantChantiersTermines;
    const key = `${monthInfo.year}_${monthInfo.month}`;

    map.set(key, {
      year: monthInfo.year,
      month: monthInfo.month,
      montantChantiersCours,
      montantChantiersTermines,
      montantTotal
    });
  }

  return [...map.values()];
}

function applyExcelDataToCBCO(data) {
  const existing = dbGet('cbco', []);
  const now = new Date().toISOString();
  let added = 0, updated = 0, removed = 0;

  const excelKeys = new Set(data.map(r => `${r.year}_${r.month}`));

  const kept = existing.filter(entry => {
    const key = `${entry.year}_${entry.month}`;
    if (entry.createdBy === 'excel-auto' && !excelKeys.has(key)) {
      removed++;
      return false;
    }
    return true;
  });

  for (const row of data) {
    const idx = kept.findIndex(e => e.year === row.year && e.month === row.month);
    if (idx >= 0) {
      kept[idx] = {
        ...kept[idx],
        ...row,
        updatedAt: now,
        updatedBy: 'excel-auto'
      };
      updated++;
    } else {
      const maxId = kept.reduce((max, e) => Math.max(max, Number(e.id) || 0), 0);
      kept.push({
        id: maxId + 1,
        ...row,
        cumulAnnuel: 0,
        createdAt: now,
        createdBy: 'excel-auto',
        updatedAt: now,
        updatedBy: 'excel-auto'
      });
      added++;
    }
  }

  // Recalculer le cumul annuel en exercice fiscal (octobre -> septembre)
  const fiscalMonth = (month) => (month >= 10 ? month - 9 : month + 3); // oct=1 ... sep=12
  const fiscalYear = (year, month) => (month >= 10 ? year : year - 1);
  kept.sort((a, b) => {
    const fyA = fiscalYear(a.year, a.month);
    const fyB = fiscalYear(b.year, b.month);
    if (fyA !== fyB) return fyA - fyB;
    return fiscalMonth(a.month) - fiscalMonth(b.month);
  });
  let currentFy = null;
  let cumul = 0;
  kept.forEach((entry) => {
    const fy = fiscalYear(entry.year, entry.month);
    if (fy !== currentFy) {
      currentFy = fy;
      cumul = 0;
    }
    cumul += Number(entry.montantTotal) || 0;
    entry.cumulAnnuel = cumul;
  });

  dbSet('cbco', kept);
  return { added, updated, removed };
}

let cbcoWatcher = null;

function startCBCOWatcher(cfg) {
  if (cbcoWatcher) { clearInterval(cbcoWatcher); cbcoWatcher = null; }
  const excelPath = path.join(cfg.folder, cfg.filename);
  if (!fs.existsSync(excelPath)) {
    console.log(`[CBCO-Watch] Fichier introuvable, surveillance impossible : ${excelPath}`);
    return;
  }

  let lastMtime = fs.statSync(excelPath).mtimeMs;
  cbcoWatcher = setInterval(() => {
    try {
      if (!fs.existsSync(excelPath)) return;
      const mtime = fs.statSync(excelPath).mtimeMs;
      if (mtime !== lastMtime) {
        lastMtime = mtime;
        console.log(`[CBCO-Watch] Modification détectée dans ${cfg.filename}, import automatique...`);
        try {
          const data = parseCBCOExcel(cfg);
          const result = applyExcelDataToCBCO(data);
          const cfg2 = dbGet('cbco_excel_config', {});
          dbSet('cbco_excel_config', { ...cfg2, lastSync: new Date().toISOString(), lastSyncResult: result });
          console.log(`[CBCO-Watch] Import OK — ${result.added} ajouté(s), ${result.updated} mis à jour`);
        } catch (e) {
          console.error(`[CBCO-Watch] Erreur lecture : ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`[CBCO-Watch] Erreur stat : ${e.message}`);
    }
  }, 30000);

  console.log(`[CBCO-Watch] Surveillance active (polling 30s) : ${excelPath}`);
}

(function resumeCBCOWatcherOnStartup() {
  const cfg = dbGet('cbco_excel_config', null);
  if (cfg && cfg.active) {
    console.log('[CBCO-Watch] Reprise de la surveillance au démarrage...');
    startCBCOWatcher(cfg);
  }
})();

app.get('/api/cbco-excel-config', (req, res) => {
  res.json(dbGet('cbco_excel_config', null));
});

app.put('/api/cbco-excel-config', (req, res) => {
  const { folder, filename, sheet } = req.body;
  if (!folder || !filename || !sheet) {
    return res.status(400).json({ success: false, error: 'Champs manquants : folder, filename, sheet' });
  }
  try {
    const data = parseCBCOExcel({ folder, filename, sheet });
    const result = applyExcelDataToCBCO(data);
    const cfg = { folder, filename, sheet, active: true, lastSync: new Date().toISOString(), lastSyncResult: result };
    dbSet('cbco_excel_config', cfg);
    startCBCOWatcher(cfg);
    res.json({ success: true, result, rowCount: data.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/cbco-excel-config', (req, res) => {
  if (cbcoWatcher) { clearInterval(cbcoWatcher); cbcoWatcher = null; }
  dbSet('cbco_excel_config', null);
  res.json({ success: true });
});

app.post('/api/cbco-import-excel', (req, res) => {
  const cfg = dbGet('cbco_excel_config', null);
  if (!cfg || !cfg.active) {
    return res.status(400).json({ success: false, error: 'Aucune synchronisation configurée.' });
  }
  try {
    const data = parseCBCOExcel(cfg);
    const result = applyExcelDataToCBCO(data);
    dbSet('cbco_excel_config', { ...cfg, lastSync: new Date().toISOString(), lastSyncResult: result });
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

  // Vérification des fichiers Excel configurés
  const gmCfg = dbGet('gm_excel_config', null);
  if (gmCfg && gmCfg.active) {
    const excelPath = path.join(gmCfg.folder, gmCfg.filename);
    if (fs.existsSync(excelPath)) {
      console.log(`✅ [Excel GM] Connecté : ${excelPath}`);
    } else {
      console.log(`❌ [Excel GM] Fichier introuvable : ${excelPath}`);
    }
  } else {
    console.log(`⚠️  [Excel GM] Aucun fichier Excel configuré`);
  }
  const cbcoCfg = dbGet('cbco_excel_config', null);
  if (cbcoCfg && cbcoCfg.active) {
    const excelPath = path.join(cbcoCfg.folder, cbcoCfg.filename);
    if (fs.existsSync(excelPath)) {
      console.log(`✅ [Excel CBCO] Connecté : ${excelPath}`);
    } else {
      console.log(`❌ [Excel CBCO] Fichier introuvable : ${excelPath}`);
    }
  } else {
    console.log(`⚠️  [Excel CBCO] Aucun fichier Excel configuré`);
  }
  console.log('');
});
