/**
 * Serveur API pour l'intranet Groupe Goudalle
 * 
 * Remplace le localStorage du navigateur par un stockage centralisé sur le serveur.
 * Toutes les données sont sauvegardées dans des fichiers JSON dans le dossier /data
 * 
 * Pour lancer : node server.js
 * Par défaut sur le port 3000
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Dossier contenant les fichiers JSON de données
const DATA_DIR = path.join(__dirname, 'data');

// ─── MIDDLEWARES ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Sert les fichiers statiques du site (HTML, CSS, JS, images)
// Le site est dans le dossier parent du serveur
app.use(express.static(path.join(__dirname, '..')));

// ─── UTILITAIRES FICHIERS JSON ──────────────────────────────────────────────────

function readData(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`Erreur lecture ${filename}:`, e.message);
    return null;
  }
}

function writeData(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`Erreur écriture ${filename}:`, e.message);
    return false;
  }
}

function getOrInit(filename, defaultValue) {
  const data = readData(filename);
  if (data === null) {
    writeData(filename, defaultValue);
    return defaultValue;
  }
  return data;
}

// ─── ROUTES : UTILISATEURS ──────────────────────────────────────────────────────

// Récupérer tous les utilisateurs
app.get('/api/users', (req, res) => {
  const users = getOrInit('users.json', {});
  // Ne jamais envoyer les mots de passe en clair au client (sauf pour l'auth locale)
  res.json(users);
});

// Sauvegarder tous les utilisateurs (remplace entièrement)
app.put('/api/users', (req, res) => {
  const ok = writeData('users.json', req.body);
  res.json({ success: ok });
});

// ─── ROUTES : CODE ADMIN ────────────────────────────────────────────────────────

app.get('/api/admin-code', (req, res) => {
  const code = getOrInit('admin-code.json', { code: '0000' });
  res.json(code);
});

app.put('/api/admin-code', (req, res) => {
  const ok = writeData('admin-code.json', req.body);
  res.json({ success: ok });
});

// ─── ROUTES : AUDIT ─────────────────────────────────────────────────────────────

app.get('/api/audit', (req, res) => {
  const audit = getOrInit('audit.json', []);
  res.json(audit);
});

app.put('/api/audit', (req, res) => {
  const ok = writeData('audit.json', req.body);
  res.json({ success: ok });
});

// ─── ROUTES : KPIs GOUDALLE MAÇONNERIE ─────────────────────────────────────────

app.get('/api/kpis', (req, res) => {
  const kpis = getOrInit('kpis.json', []);
  res.json(kpis);
});

app.put('/api/kpis', (req, res) => {
  const ok = writeData('kpis.json', req.body);
  res.json({ success: ok });
});

// ─── ROUTES : SEUILS KPI ────────────────────────────────────────────────────────

app.get('/api/thresholds', (req, res) => {
  const t = getOrInit('thresholds.json', { ratioThreshold: 5 });
  res.json(t);
});

app.put('/api/thresholds', (req, res) => {
  const ok = writeData('thresholds.json', req.body);
  res.json({ success: ok });
});

// ─── ROUTES : CBCO CHIFFRE D'AFFAIRES ──────────────────────────────────────────

app.get('/api/cbco', (req, res) => {
  const data = getOrInit('cbco.json', []);
  res.json(data);
});

app.put('/api/cbco', (req, res) => {
  const ok = writeData('cbco.json', req.body);
  res.json({ success: ok });
});

// ─── ROUTES : CBCO COMMERCIAL ───────────────────────────────────────────────────

app.get('/api/cbco-commercial', (req, res) => {
  const data = getOrInit('cbco-commercial.json', []);
  res.json(data);
});

app.put('/api/cbco-commercial', (req, res) => {
  const ok = writeData('cbco-commercial.json', req.body);
  res.json({ success: ok });
});

// ─── ROUTES : SYLVE BALANCE ─────────────────────────────────────────────────────

app.get('/api/sylve-balance', (req, res) => {
  const data = getOrInit('sylve-balance.json', { cbco: [], gc: [], gm: [] });
  res.json(data);
});

app.put('/api/sylve-balance', (req, res) => {
  const ok = writeData('sylve-balance.json', req.body);
  res.json({ success: ok });
});

// ─── ROUTES : SYLVE CA ──────────────────────────────────────────────────────────

app.get('/api/sylve-ca', (req, res) => {
  const data = getOrInit('sylve-ca.json', { cbco: 0, gc: 0, gm: 0, bilanDate: '' });
  res.json(data);
});

app.put('/api/sylve-ca', (req, res) => {
  const ok = writeData('sylve-ca.json', req.body);
  res.json({ success: ok });
});

// ─── ROUTES : SYLVE PAIEMENTS EN ATTENTE ────────────────────────────────────────

app.get('/api/sylve-paiements', (req, res) => {
  const data = getOrInit('sylve-paiements.json', {});
  res.json(data);
});

app.put('/api/sylve-paiements', (req, res) => {
  const ok = writeData('sylve-paiements.json', req.body);
  res.json({ success: ok });
});

// ─── ROUTES : RAPPELS EMAIL ─────────────────────────────────────────────────────

app.get('/api/reminders-config', (req, res) => {
  const data = getOrInit('reminders-config.json', {
    enabled: false,
    siteUrl: '',
    emailjsServiceId: '',
    emailjsTemplateId: '',
    emailjsPublicKey: '',
    indicators: {
      gm: { recurrence: 'hebdomadaire' },
      cbco: { recurrence: 'mensuel' }
    }
  });
  res.json(data);
});

app.put('/api/reminders-config', (req, res) => {
  const ok = writeData('reminders-config.json', req.body);
  res.json({ success: ok });
});

app.get('/api/reminders-sent', (req, res) => {
  const data = getOrInit('reminders-sent.json', []);
  res.json(data);
});

app.put('/api/reminders-sent', (req, res) => {
  const ok = writeData('reminders-sent.json', req.body);
  res.json({ success: ok });
});

// ─── ROUTE : SANTÉ DU SERVEUR ───────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── ROUTE FALLBACK : redirige vers index.html ──────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ─── DÉMARRAGE ───────────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log(`║   Intranet Groupe Goudalle - Serveur       ║`);
  console.log(`║   http://localhost:${PORT}                    ║`);
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
  console.log(`📁 Données stockées dans : ${DATA_DIR}`);
  console.log('✅ Serveur prêt - accessible depuis le réseau');
  console.log('');
});
