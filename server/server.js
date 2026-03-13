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

// ─── ROUTE : SANTÉ DU SERVEUR ───────────────────────────────────────────────────

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
