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
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const XlsxPopulate = require('xlsx-populate');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const COMMERCE_EXCEL_FOLDER = process.env.COMMERCE_EXCEL_FOLDER || 'Z:\\03-BE\\Projet en cours\\Mathieu';
const COMMERCE_EXCEL_SHEET = 'Indicateur commercial';
const COMMERCE_MIN_YEAR = 2021;
const COMMERCE_CACHE_TTL_MS = 60 * 1000;

const AO_MIN_DATE = '2025-10-01';
const AO_CACHE_TTL_MS = 60 * 1000;
const AO_MAX_FUTURE_YEARS = 1;

let commerceIndicatorsCache = {
  snapshot: null,
  sourceKey: null,
  cachedAt: 0
};

let aoCache = { snapshot: null, sourceKey: null, cachedAt: 0 };
const excelReadCaches = new Map();

// ─── TOKEN DE SÉCURITÉ SERVEUR ────────────────────────────────────────────────
// Généré aléatoirement à chaque démarrage du serveur.
// Requis dans le header "x-goudalle-token" pour toutes les opérations d'écriture
// et pour accéder au code admin. Empêche les requêtes externes non autorisées.
const SERVER_TOKEN = crypto.randomBytes(32).toString('hex');

// ─── RATE LIMITING (protection brute-force sur les écritures) ─────────────────
// Limite à 60 requêtes d'écriture par tranche de 60 secondes par IP.
const _writeCounters = new Map();
function checkWriteRateLimit(ip) {
  const now = Date.now();
  const entry = _writeCounters.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  _writeCounters.set(ip, entry);
  return entry.count <= 60;
}
// Nettoyage toutes les 5 minutes pour éviter les fuites mémoire
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _writeCounters) {
    if (now > entry.resetAt + 60000) _writeCounters.delete(ip);
  }
}, 300000);

// Fichier de stockage JSON
const DB_PATH = path.join(__dirname, 'data', 'goudalle.json');
const DB_BACKUP_PATH = path.join(__dirname, 'data', 'goudalle.json.bak');

// ─── EXCEL DES COMPTES UTILISATEURS ─────────────────────────────────────────────
const ACCOUNTS_EXCEL_PATH = 'W:\\BCHDF\\Site Intranet Groupe Goudalle\\Compte site intranet.xlsx';
const COMPANY_SHEETS = ['SYLVE', 'CHARPENTE', 'CBCO', 'SNGM'];

// Source unique de vérité : toutes les pages du site avec leur permission, libellé et groupe.
// Ajouter une entrée ici suffit pour qu'elle apparaisse dans la gestion des utilisateurs
// ET qu'une colonne soit créée automatiquement dans l'Excel.
const PAGES_CONFIG = [
  // ── Chantiers : 1 colonne Excel = 1 page (correspondance exacte) ────────────
  // p_chantiers-vue-globale    → page Vue globale (carte tous chantiers)
  // p_chantiers-vue-conducteurs → page Vue conducteurs (filtre par conducteur)
  // p_chantiers-suivi          → page Suivi chantier (filtré si pas vue-globale)
  { file:'chantiers-vue-globale.html',     perm:'chantiers_vue_globale',     label:'🌍 Vue globale',      group:'🚧 Chantiers' },
  { file:'chantiers-vue-conducteurs.html', perm:'chantiers_vue_conducteurs', label:'👷 Vue conducteurs',  group:'🚧 Chantiers' },
  { file:'chantiers-suivi.html',           perm:'chantiers_suivi',           label:'📁 Suivi chantier',   group:'🚧 Chantiers' },
  // Anciennes colonnes ignorées (données = non dans Excel, conservées pour compatibilité)
  { file:'chantiers.html',                 perm:'chantiers',                 label:'', group:'🚧 Chantiers', hidden:true },
  { file:'chantiers-responsable.html',     perm:'chantiers_responsable',     label:'', group:'🚧 Chantiers', hidden:true },
  { file:'chantiers-conducteur.html',      perm:'chantiers_conducteur',      label:'', group:'🚧 Chantiers', hidden:true },
  { file:'chantiers-charpente.html',       perm:'chantiers_charpente',       label:'', group:'🚧 Chantiers', hidden:true },
  { file:'chantiers-maconnerie.html',      perm:'chantiers_maconnerie',      label:'', group:'🚧 Chantiers', hidden:true },
  { file:'chantiers-conducteurne.html',    perm:'conducteur_charpente',      label:'', group:'🚧 Chantiers', hidden:true },
  { file:'commerce-indicateurs.html',                 perm:'commerce_indicateurs',             label:'💼 Indicateurs commerce',          group:'💼 Commerce' },
  { file:'commerce-liaison.html',                     perm:'commerce_liaison',                 label:'🔗 Liaison commerce',              group:'💼 Commerce' },
  { file:'compta-indicateurs.html',                   perm:'compta_indicateurs',               label:'📊 Indicateurs comptabilité',      group:'📒 Comptabilité' },
  { file:'compta-saisie.html',                        perm:'compta_saisie',                    label:'✏️ Saisie factures',               group:'📒 Comptabilité' },
  { file:'compta-paiements-charpente.html',           perm:'compta_paiements_charpente',       label:'💳 Paiements charpente',           group:'📒 Comptabilité' },
  { file:'compta-paiements-maconnerie.html',          perm:'compta_paiements_maconnerie',      label:'💳 Paiements maçonnerie',          group:'📒 Comptabilité' },
  { file:'compta-paiements-cbco.html',                perm:'compta_paiements_cbco',            label:'💳 Paiements CBCO',                group:'📒 Comptabilité' },
  { file:'production-indicateurs-generaux.html',      perm:'production_indicateurs_generaux',  label:'📈 Indicateurs généraux',          group:'🏭 Production' },
  { file:'production-indicateurs-maconnerie.html',    perm:'production_indicateurs_maconnerie',label:'📊 Indicateurs maçonnerie',        group:'🏭 Production' },
  { file:'production-indicateurs-usine-cbco.html',    perm:'production_indicateurs_usine',     label:'🏭 Indicateurs usine CBCO',        group:'🏭 Production' },
  { file:'production-saisie-maconnerie.html',         perm:'production_saisie_maconnerie',     label:'✏️ Saisie maçonnerie',             group:'🏭 Production' },
  { file:'production-saisie-productivite-usine.html', perm:'production_saisie_productivite',   label:'✏️ Saisie productivité usine',     group:'🏭 Production' },
  { file:'achat-indicateurs.html',                    perm:'achat_indicateurs',                label:'📊 Indicateurs achat',             group:'🛒 Achat' },
  { file:'achat-saisie.html',                         perm:'achat_saisie',                     label:'✏️ Saisie achats',                 group:'🛒 Achat' },
  { file:'achat-controle.html',                       perm:'achat_controle',                   label:'🔍 Contrôle imports',              group:'🛒 Achat' },
  { file:'achat-arc.html',                            perm:'achat_arc',                        label:'📋 Codes ARC',                     group:'🛒 Achat' },
  { file:'rh-indicateurs.html',                       perm:'rh_indicateurs',                   label:'🦺 Indicateurs RH',                group:'👷 RH' },
  { file:'rh-saisie.html',                            perm:'rh_saisie',                        label:'📝 Déclaration accident',          group:'👷 RH' },
  { file:'utilisateurs.html',                         perm:'users_admin',                      label:'👥 Gestion utilisateurs',          group:'⚙️ Administration' },
  { file:'utilisateurs-code-admin.html',              perm:'users_admin',                      label:'👥 Gestion utilisateurs',          group:'⚙️ Administration', hidden:true },
];

// Généré automatiquement depuis PAGES_CONFIG — ne pas modifier manuellement
const FILE_TO_PERM = Object.fromEntries(PAGES_CONFIG.map(p => [p.file, p.perm]));

let _accountsExcelCache = { users: null, mtimeMs: 0 };

// ─── INITIALISATION DU STOCKAGE ──────────────────────────────────────────────────

let store = {};
function tryParseDB(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}
if (fs.existsSync(DB_PATH)) {
  const parsed = tryParseDB(DB_PATH);
  if (parsed !== null) {
    store = parsed;
  } else if (fs.existsSync(DB_BACKUP_PATH)) {
    // Fichier principal corrompu → restauration depuis la sauvegarde
    const backup = tryParseDB(DB_BACKUP_PATH);
    if (backup !== null) {
      store = backup;
      console.warn('[DB] goudalle.json corrompu, restauré depuis goudalle.json.bak');
    }
  }
}

function saveStore() {
  const json = JSON.stringify(store, null, 2);
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, DB_PATH); // écriture atomique : évite la corruption si crash pendant l'écriture
  try { fs.writeFileSync(DB_BACKUP_PATH, json, 'utf8'); } catch (_) {}
}

// ─── GESTION DES COMPTES DEPUIS L'EXCEL (multi-feuilles par entreprise) ──────────

function normalizeId(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function generateUserId(prenom, nom, existing) {
  const p = normalizeId(prenom);
  const n = normalizeId(nom);
  let base = (p && n) ? `${p}.${n}` : (p || n || null);
  if (!base) return null;
  let id = base;
  let i = 2;
  while (existing.has(id)) { id = `${base}-${i++}`; }
  return id;
}

function readAccountsExcel() {
  try {
    if (!fs.existsSync(ACCOUNTS_EXCEL_PATH)) return {};
    const stat = fs.statSync(ACCOUNTS_EXCEL_PATH);
    if (_accountsExcelCache.users && _accountsExcelCache.mtimeMs === stat.mtimeMs) {
      return _accountsExcelCache.users;
    }

    const wb = XLSX.readFile(ACCOUNTS_EXCEL_PATH);
    const users = {};

    // Première passe : collecter les identifiants existants (pour éviter les doublons générés)
    const existingIds = new Set();
    COMPANY_SHEETS.forEach(company => {
      if (!wb.SheetNames.includes(company)) return;
      const ws = wb.Sheets[company];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length < 2) return;
      const headers = rows[0].map(h => String(h || '').trim());
      const idIdx = headers.indexOf('Identifiant');
      if (idIdx === -1) return;
      for (let i = 1; i < rows.length; i++) {
        const v = String(rows[i][idIdx] || '').trim();
        if (v) existingIds.add(v.toLowerCase());
      }
    });

    // Identifiants à réécrire dans l'Excel (colonne Identifiant vide → auto-générée)
    const toFillBack = []; // { company, rowIndex, id }

    COMPANY_SHEETS.forEach(company => {
      if (!wb.SheetNames.includes(company)) return;
      const ws = wb.Sheets[company];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length < 2) return;

      const headers = rows[0].map(h => String(h || '').trim());
      const col = n => headers.indexOf(n);

      // Colonnes p_xxx : chaque colonne = 1 page
      const permCols = headers
        .map((h, i) => h.startsWith('p_') ? { idx: i, file: h.slice(2) + '.html' } : null)
        .filter(Boolean);

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const prenom = String(r[col('Prénom')] || '').trim();
        const nom    = String(r[col('Nom')]    || '').trim();
        if (!prenom && !nom) continue; // ligne vide

        let id = String(r[col('Identifiant')] || '').trim();
        if (!id) {
          // Générer prenom.nom normalisé (sans accents)
          id = generateUserId(prenom, nom, existingIds);
          if (!id) continue;
          existingIds.add(id.toLowerCase());
          toFillBack.push({ company, rowIndex: i + 1, colIndex: col('Identifiant') + 1, id });
        }

        const permsSet = new Set();
        permCols.forEach(({ idx, file }) => {
          if (String(r[idx] || '').trim().toLowerCase() === 'oui') {
            const p = FILE_TO_PERM[file];
            if (p) permsSet.add(p);
          }
        });


        users[id] = {
          username: id,
          password: String(r[col('Mot_de_passe')] || '').trim(),
          displayName: [prenom, nom].filter(Boolean).join(' ') || id,
          prenom,
          nom,
          email:      String(r[col('Email')]  || '').trim(),
          role:       (String(r[col('Role')]   || 'lecture').trim() || 'lecture'),
          poste:      String(r[col('Poste')]   || '').trim(),
          entreprise: company,
          isActive:   String(r[col('Actif')]   || 'oui').trim().toLowerCase() !== 'non',
          customPermissions: [...permsSet],
          createdBy: 'EXCEL',
          createdAt: new Date().toISOString(),
        };
      }
    });

    // Remplir les identifiants manquants dans l'Excel (une seule fois au démarrage)
    if (toFillBack.length > 0) {
      console.log(`[Comptes] ${toFillBack.length} identifiant(s) auto-généré(s), écriture dans l'Excel…`);
      XlsxPopulate.fromFileAsync(ACCOUNTS_EXCEL_PATH).then(wbPop => {
        toFillBack.forEach(({ company, rowIndex, colIndex, id }) => {
          const sheet = wbPop.sheet(company);
          if (sheet) sheet.cell(rowIndex, colIndex).value(id);
        });
        return wbPop.toFileAsync(ACCOUNTS_EXCEL_PATH);
      }).then(() => {
        _accountsExcelCache = { users, mtimeMs: 0 }; // forcer re-lecture au prochain appel
        console.log(`[Comptes] Identifiants écrits dans l'Excel.`);
      }).catch(e => console.error('[Comptes] Erreur écriture identifiants:', e.message));
    }

    _accountsExcelCache = { users, mtimeMs: stat.mtimeMs };
    return users;
  } catch (e) {
    console.error('[Comptes] Erreur lecture Excel:', e.message);
    return _accountsExcelCache.users || {};
  }
}

// Écrit les mises à jour dans l'Excel : permissions, mot de passe, actif,
// ajoute les colonnes manquantes (nouvelles pages) et les nouvelles lignes utilisateurs.
async function writeAccountsExcel(users) {
  try {
    const wb = await XlsxPopulate.fromFileAsync(ACCOUNTS_EXCEL_PATH);

    for (const company of COMPANY_SHEETS) {
      const ws = wb.sheet(company);
      if (!ws) continue;

      const usedRange = ws.usedRange();
      if (!usedRange) continue;
      let lastCol = usedRange.endCell().columnNumber();
      let lastRow = usedRange.endCell().rowNumber();

      // Lire l'en-tête (ligne 1) → map nom → numéro de colonne (1-indexed)
      const headers = {};
      for (let c = 1; c <= lastCol; c++) {
        const h = String(ws.cell(1, c).value() || '').trim();
        if (h) headers[h] = c;
      }

      const idCol    = headers['Identifiant'];
      const mdpCol   = headers['Mot_de_passe'];
      const actifCol = headers['Actif'];
      if (!idCol || !mdpCol) continue;

      // ── Ajouter les colonnes p_xxx manquantes (nouvelles pages) ──
      for (const p of PAGES_CONFIG) {
        const colName = 'p_' + p.file.replace('.html', '');
        if (headers[colName]) continue;
        lastCol++;
        headers[colName] = lastCol;
        const hCell = ws.cell(1, lastCol);
        hCell.value(colName);
        try { hCell.style({ bold: true, fill: { type: 'solid', color: 'DEEBF7' }, wrapText: true }); } catch {}
        for (let r = 2; r <= lastRow; r++) ws.cell(r, lastCol).value('non');
        console.log(`[Comptes] ➕ Nouvelle colonne "${colName}" dans ${company}`);
      }

      // ── Mettre à jour les lignes existantes ──
      const seenIds = new Set();
      for (let row = 2; row <= lastRow; row++) {
        const id = String(ws.cell(row, idCol).value() || '').trim();
        if (!id) continue;
        seenIds.add(id.toLowerCase());
        const u = users[id] || users[Object.keys(users).find(k => k.toLowerCase() === id.toLowerCase())];
        if (!u) continue;

        ws.cell(row, mdpCol).value(String(u.password || ''));
        if (actifCol) ws.cell(row, actifCol).value(u.isActive !== false ? 'oui' : 'non');

        Object.entries(headers).forEach(([h, c]) => {
          if (!h.startsWith('p_')) return;
          const file = h.slice(2) + '.html';
          const perm = FILE_TO_PERM[file];
          if (!perm) return;
          const hasPerm = u.role === 'direction' ||
            (Array.isArray(u.customPermissions) && u.customPermissions.includes(perm));
          ws.cell(row, c).value(hasPerm ? 'oui' : 'non');
        });
      }

      // ── Ajouter les nouveaux utilisateurs créés depuis le site ──
      for (const [id, u] of Object.entries(users)) {
        if ((u.entreprise || '').toUpperCase() !== company) continue;
        if (seenIds.has(id.toLowerCase())) continue;
        if (u.createdBy === 'EXCEL') continue;

        lastRow++;
        if (headers['Identifiant']) ws.cell(lastRow, headers['Identifiant']).value(id);
        if (headers['Prénom'])      ws.cell(lastRow, headers['Prénom']).value(u.prenom || '');
        if (headers['Nom'])         ws.cell(lastRow, headers['Nom']).value(u.nom || '');
        if (headers['Email'])       ws.cell(lastRow, headers['Email']).value(u.email || '');
        if (headers['Poste'])       ws.cell(lastRow, headers['Poste']).value(u.poste || '');
        if (mdpCol)                 ws.cell(lastRow, mdpCol).value(String(u.password || ''));
        if (actifCol)               ws.cell(lastRow, actifCol).value(u.isActive !== false ? 'oui' : 'non');
        if (headers['Role'])        ws.cell(lastRow, headers['Role']).value(u.role || 'lecture');

        Object.entries(headers).forEach(([h, c]) => {
          if (!h.startsWith('p_')) return;
          const file = h.slice(2) + '.html';
          const perm = FILE_TO_PERM[file];
          if (!perm) { ws.cell(lastRow, c).value('non'); return; }
          const hasPerm = u.role === 'direction' ||
            (Array.isArray(u.customPermissions) && u.customPermissions.includes(perm));
          ws.cell(lastRow, c).value(hasPerm ? 'oui' : 'non');
        });

        seenIds.add(id.toLowerCase());
        console.log(`[Comptes] ➕ Nouvel utilisateur "${id}" ajouté dans ${company}`);
      }
    }

    await wb.toFileAsync(ACCOUNTS_EXCEL_PATH);
    _accountsExcelCache = { users: null, mtimeMs: 0 };
    return true;
  } catch (e) {
    console.error('[Comptes] Erreur écriture Excel:', e.message);
    return { ok: false, error: e.message };
  }
}

// ─── UTILITAIRES ────────────────────────────────────────────────────────────────

function dbGet(key, defaultValue) {
  return key in store ? store[key] : defaultValue;
}

function dbSet(key, value) {
  store[key] = value;
  saveStore();
}

function normalizeText(str) {
  return String(str || '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toNumberFr(raw) {
  if (raw == null) return null;
  const txt = String(raw).trim();
  if (!txt) return null;
  const cleaned = txt.replace(/\s/g, '').replace(/[^\d,\.-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function pickRobustInvoiceTotal(headerTotal, totalBon, sumLines) {
  const h = Number.isFinite(Number(headerTotal)) ? Number(headerTotal) : null;
  const t = Number.isFinite(Number(totalBon)) ? Number(totalBon) : null;
  const s = Number.isFinite(Number(sumLines)) ? Number(sumLines) : null;

  const ratio = (a, b) => {
    if (a == null || b == null || b === 0) return null;
    return Math.abs(a / b);
  };

  const hasLargeMismatch = (a, b) => {
    const r = ratio(a, b);
    if (r == null) return false;
    return r > 100 || r < 0.01 || Math.abs(a - b) > Math.max(5000, Math.abs(b) * 0.9);
  };

  // Priorité métier: Total Bon est généralement la valeur la plus fiable.
  if (t != null) {
    if (h == null) return t;
    if (hasLargeMismatch(h, t)) return t;
    return t;
  }

  // Sans Total Bon: on corrige un header aberrant avec la somme des lignes.
  if (s != null) {
    if (h == null) return s;
    if (hasLargeMismatch(h, s)) return s;
  }

  return h;
}

function buildExcelSourceSignature(sourceFiles = []) {
  return sourceFiles
    .filter(Boolean)
    .map((source) => {
      const fullPath = source.fullPath || source.path || source;
      const stat = source.stat || fs.statSync(fullPath);
      return [
        path.resolve(fullPath).toLowerCase(),
        stat.mtimeMs,
        stat.size
      ].join('|');
    })
    .sort()
    .join('||');
}

function getCachedExcelRead(cacheName, sourceFiles, reader, options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();
  const sourceKey = buildExcelSourceSignature(sourceFiles);
  const cached = excelReadCaches.get(cacheName);

  if (!forceRefresh && cached && cached.sourceKey === sourceKey) {
    cached.cachedAt = now;
    return cached.value;
  }

  const value = reader();
  excelReadCaches.set(cacheName, { sourceKey, value, cachedAt: now });
  return value;
}

function clearExcelReadCache(cacheName = null) {
  if (cacheName) excelReadCaches.delete(cacheName);
  else excelReadCaches.clear();
}

function dedupeRepeatedLine(line) {
  let out = String(line || '').replace(/\s+/g, ' ').trim();
  if (!out) return out;
  const doubled = out.match(/^(.+?)\s+\1$/i);
  if (doubled) out = doubled[1].trim();
  out = out.replace(/^(.+?total\s+(?:bon|chantier|fournisseur))\s+\1$/i, '$1').trim();
  return out;
}

function parsePdfHeaderLine(line) {
  const clean = dedupeRepeatedLine(line);
  const compact = String(clean || '').replace(/\s+/g, ' ').trim();

  // Format ONAYA export: DD/MM/YYYY  BC[num]  [chantier]  0[fournisseur_code]  [raison_sociale...]  [auteur]  [statut]
  // Le montant n'est PAS sur la ligne d'en-tête — il vient du "Total Bon"
  const m = compact.match(/^(\d{2}\/\d{2}\/\d{4})\s+(BC[\w-]+)\s+(\S+)\s+(\S+)\s+(.+)$/i);
  if (!m) return null;

  const [, dateFacture, numeroBon, chantierCode, fournisseurCode, rest] = m;
  // rest = "Raison Sociale  Auteur  Statut" — on prend juste auteur (avant-dernier) et statut (dernier)
  const restTokens = String(rest || '').trim().split(/\s+/).filter(Boolean);
  const auteur = restTokens.length >= 2 ? restTokens[restTokens.length - 2] : null;
  const raisonSociale = restTokens.length >= 3 ? restTokens.slice(0, -2).join(' ') : (restTokens[0] || null);

  return {
    date_facture: dateFacture,
    numero_facture: numeroBon,
    avoir: null,
    journal: null,
    fournisseur: raisonSociale || fournisseurCode,
    auteur: auteur || null,
    chantier: chantierCode || null,
    libelle_facture: numeroBon,
    montant_ht: null,
    header_raw: clean
  };
}

function parsePdfArticleLine(line) {
  const clean = dedupeRepeatedLine(line);
  const m = clean.match(/^(.*?)(?:\s+(U|ML|M2|M3|ENS|KG))?\s+(-?\d{1,3}(?:\s\d{3})*,\d{3})\s+(-?\d{1,3}(?:\s\d{3})*,\d{2})\s+(-?\d{1,3}(?:\s\d{3})*,\d{2})$/i);
  if (!m) return null;

  const prefix = String(m[1] || '').trim();
  const unite = m[2] || null;
  const qte = toNumberFr(m[3]);
  const pu = toNumberFr(m[4]);
  const montant = toNumberFr(m[5]);
  const tokens = prefix.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  const isChantierToken = (t) => /^\d{2}-\d{3,}$/.test(t) || /^[A-Z]{2}\d+[A-Z0-9]*-\d+$/i.test(t);
  const isArcToken = (t) => (
    /^\d{2,4}$/.test(t) ||
    (/^[A-Z]{2,}[A-Z0-9_-]*-\d+$/i.test(t) && !isChantierToken(t))
  );
  const idxBl = tokens.findIndex((t) => /^(BL|BC)[A-Z0-9-]+$/i.test(t));

  let bl = null;
  let arc = null;
  let chantierLigne = null;
  let ressourceName = null;
  let libelleFinal = null;

  if (idxBl >= 0) {
    // Format avec BL/BC explicite dans la ligne article
    bl = tokens[idxBl];
    const beforeBl = tokens.slice(0, idxBl);
    const tailBl = tokens.slice(idxBl + 1);
    ressourceName = beforeBl[0] || tokens[0] || null;
    const libelleBeforeBl = beforeBl.slice(1).join(' ').trim() || null;
    if (tailBl.length && isArcToken(tailBl[0])) arc = tailBl.shift();
    if (tailBl.length && isChantierToken(tailBl[0])) chantierLigne = tailBl.shift();
    const libelleAfterBl = tailBl.join(' ').trim() || null;
    libelleFinal = [libelleBeforeBl, libelleAfterBl].filter(Boolean).join(' ') || prefix || null;
  } else {
    // Format ONAYA : RESSOURCE  LIBELLÉ...  [CHANTIER]  ARC
    // Cas 1 normal  : ...LIBELLÉ  ARC                (dernier token = ARC)
    // Cas 2 CBCO    : ...LIBELLÉ  ARC  CHANTIER_TEXT  (avant-dernier = ARC, dernier = chantier textuel)
    ressourceName = tokens[0] || null;
    let endIdx = tokens.length;
    const lastTok = tokens[tokens.length - 1];
    const prevTok = tokens.length > 2 ? tokens[tokens.length - 2] : null;

    if (tokens.length > 1 && /^\d+$/.test(lastTok)) {
      // Cas 1 : dernier token = ARC numérique
      arc = lastTok;
      endIdx--;
      if (endIdx > 1 && isChantierToken(tokens[endIdx - 1])) {
        chantierLigne = tokens[endIdx - 1];
        endIdx--;
      }
    } else if (tokens.length > 2 && /^\d+$/.test(prevTok)) {
      // Cas 2 : avant-dernier = ARC, dernier = texte chantier (ex : MACHINESATELIER)
      chantierLigne = lastTok;
      endIdx--;
      arc = prevTok;
      endIdx--;
    }
    libelleFinal = tokens.slice(1, endIdx).join(' ').trim() || prefix || null;
  }

  return {
    ressource: ressourceName,
    bl_numero: bl,
    arc,
    chantier_ligne: chantierLigne,
    libelle_ligne: libelleFinal,
    unite,
    qte_fact: qte,
    pu,
    montant,
    raw_text: clean
  };
}

function parsePdfTotalLine(line) {
  const clean = dedupeRepeatedLine(line);
  if (!/total\s+(bon|chantier|fournisseur)/i.test(clean)) return null;
  const allAmounts = clean.match(/-?\d[\d ]*,\d{2}/g) || [];
  const amountRaw = allAmounts.length ? allAmounts[allAmounts.length - 1] : null;
  return {
    type_total: /total\s+fournisseur/i.test(clean) ? 'Total Fournisseur' : /total\s+chantier/i.test(clean) ? 'Total Chantier' : 'Total Bon',
    total_value: amountRaw ? toNumberFr(amountRaw) : null,
    raw_text: clean
  };
}

function isStockRelatedText(raw) {
  const txt = normalizeText(raw);
  if (!txt) return false;
  return txt.includes('goudalle charpente') ||
    txt.includes('sortie de stock au') ||
    txt.includes('sortie de stock gc') ||
    /\bgc\b/.test(txt);
}

/**
 * Parse le texte brut d'un PDF fournisseur en blocs "facture".
 *
 * Stratégie :
 * - détecter une ligne d'en-tête facture (date / numéro / fournisseur / montant),
 * - accumuler les lignes d'articles entre cet en-tête et un "Total Bon",
 * - finaliser la facture avec un montant robuste (montant en-tête, total bon ou somme des lignes).
 *
 * Ce parser est tolérant aux OCR imparfaits :
 * - ignore les séparateurs de page ("-- X of Y --"),
 * - ignore les lignes d'entête de colonnes,
 * - normalise les doublons de caractères via dedupeRepeatedLine().
 */
function parsePdfInvoiceBlocks(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => dedupeRepeatedLine(l)).filter(Boolean);
  const invoices = [];
  let current = null;
  let currentOrder = 0;
  let warnings = [];

  const isFactureCols = (raw) => {
    const txt = normalizeText(raw);
    return txt.includes('date') && txt.includes('fact') && txt.includes('fournisseur') && txt.includes('montant');
  };
  const isDetailCols = (raw) => {
    const txt = normalizeText(raw);
    return txt.includes('ressource') && txt.includes('arc') && txt.includes('libelle') && txt.includes('qte') && txt.includes('montant');
  };

  const finalizeInvoice = (inv) => {
    if (!inv) return null;
    const sumLines = (inv.lines || []).reduce((acc, l) => acc + (Number(l.montant) || 0), 0);
    const robustTotal = pickRobustInvoiceTotal(inv.montant_ht, inv.total_bon, sumLines);
    return {
      ...inv,
      montant_ht: robustTotal,
      total_bon: inv.total_bon != null ? inv.total_bon : null
    };
  };

  for (const raw of lines) {
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(raw)) continue;
    if (isFactureCols(raw) || isDetailCols(raw)) continue;

    const header = parsePdfHeaderLine(raw);
    if (header) {
      if (current) {
        warnings.push(`Facture ${current.numero_facture || '(inconnue)'} clôturée sans Total Bon explicite.`);
        invoices.push(finalizeInvoice(current));
      }
      currentOrder = 0;
      current = {
        ...header,
        total_bon: null,
        lines: [],
        warnings: []
      };
      continue;
    }

    if (!current) continue;

    const total = parsePdfTotalLine(raw);
    if (total) {
      if (total.type_total === 'Total Bon') {
        current.total_bon = total.total_value;
        invoices.push(finalizeInvoice(current));
        current = null;
      }
      continue;
    }

    const article = parsePdfArticleLine(raw);
    if (!article) continue;
    currentOrder += 1;
    current.lines.push({
      ...article,
      line_order: currentOrder
    });
  }

  if (current) {
    warnings.push(`Facture ${current.numero_facture || '(inconnue)'} en fin de document sans Total Bon.`);
    invoices.push(finalizeInvoice(current));
  }

  return { invoices, warnings };
}

function isAnnexeText(raw) {
  const txt = normalizeText(raw);
  return txt.includes('transport') ||
    txt.includes('eco') ||
    txt.includes('contribution verte') ||
    txt.includes('frais') ||
    txt.includes('recharge') ||
    txt.includes(' maj') ||
    txt.includes('remise commerciale') ||
    txt.includes('ecart arrondi') ||
    txt.includes('taxe') ||
    txt.includes('tva');
}

function isServiceText(raw) {
  const txt = normalizeText(raw);
  return txt.includes('prestation') ||
    txt.includes('reparation') ||
    txt.includes('implantation') ||
    txt.includes('reprofilage') ||
    txt.includes('coupe');
}

function isWoodLikeText(raw) {
  const txt = normalizeText(raw);
  return /\b(clt|klh|lc|lamelle|douglas|sapin|epicea|bois|lvl|massif|bardage|panneau)\b/.test(txt);
}

function extractThicknessMeters(raw) {
  const txt = normalizeText(raw);
  const m = txt.match(/(\d{2,3}(?:[.,]\d+)?)\s*mm\b/);
  if (!m) return null;
  const mm = parseFloat(String(m[1]).replace(',', '.'));
  return Number.isFinite(mm) && mm > 0 ? mm / 1000 : null;
}

function extractSectionLengthForUnitPieces(raw) {
  const txt = normalizeText(raw);
  const toN = (v) => parseFloat(String(v).replace(',', '.'));
  const ok = (v) => Number.isFinite(v) && v > 0;
  const matches = [];

  // Forme explicite section + longueur (cm + m): 8*20CM 13M
  const reCmM = /(\d+(?:[.,]\d+)?)\s*[x*]\s*(\d+(?:[.,]\d+)?)\s*cm\b.*?(\d+(?:[.,]\d+)?)\s*m\b/g;
  for (const m of txt.matchAll(reCmM)) {
    const a = toN(m[1]) / 100;
    const b = toN(m[2]) / 100;
    const l = toN(m[3]);
    if (ok(a) && ok(b) && ok(l)) matches.push({ sectionM2: a * b, lengthM: l, score: 120 });
  }

  // Triplet mm x mm x mm: 200x80x13000 (ou mm explicite)
  const reTripMm = /(\d{2,4}(?:[.,]\d+)?)\s*(?:mm)?\s*[x*]\s*(\d{2,4}(?:[.,]\d+)?)\s*(?:mm)?\s*[x*]\s*(\d{3,6}(?:[.,]\d+)?)\s*(?:mm)?\b/g;
  for (const m of txt.matchAll(reTripMm)) {
    const a = toN(m[1]) / 1000;
    const b = toN(m[2]) / 1000;
    const l = toN(m[3]) / 1000;
    if (ok(a) && ok(b) && ok(l)) matches.push({ sectionM2: a * b, lengthM: l, score: 110 });
  }

  // Triplet cm x cm x m: 8x20x13 (sans unités)
  const reTrip = /(\d+(?:[.,]\d+)?)\s*[x*]\s*(\d+(?:[.,]\d+)?)\s*[x*]\s*(\d+(?:[.,]\d+)?)/g;
  for (const m of txt.matchAll(reTrip)) {
    const v1 = toN(m[1]);
    const v2 = toN(m[2]);
    const v3 = toN(m[3]);
    if (!ok(v1) || !ok(v2) || !ok(v3)) continue;
    if (v1 > 40 && v2 > 40 && v3 > 200) {
      // Heuristique mm
      matches.push({ sectionM2: (v1 / 1000) * (v2 / 1000), lengthM: v3 / 1000, score: 90 });
    } else {
      // Heuristique cm,cm,m
      matches.push({ sectionM2: (v1 / 100) * (v2 / 100), lengthM: v3, score: 80 });
    }
  }

  if (!matches.length) return null;
  matches.sort((a, b) => b.score - a.score);
  return { sectionM2: matches[0].sectionM2, lengthM: matches[0].lengthM };
}

function isCltLineFromNorm(line) {
  const txt = normalizeText([line.ressource, line.libelle_ligne].filter(Boolean).join(' '));
  return /\b(clt|klh)\b/.test(txt);
}

function isLcLineFromNorm(line) {
  const txt = normalizeText([line.ressource, line.libelle_ligne].filter(Boolean).join(' '));
  if (/\b(clt|klh)\b/.test(txt)) return false;
  return /\b(lc|lamelle colle|lamelle-colle|lamelle)\b/.test(txt);
}

function isCbcoSupplier(raw) {
  return normalizeText(raw).includes('cbco');
}

function computeVolumeM3FromNorm(line) {
  const qte = Number(line.qte_fact);
  if (!Number.isFinite(qte) || qte <= 0) return null;
  const unite = String(line.unite || '').toUpperCase();
  const rawText = [line.ressource, line.libelle_ligne].filter(Boolean).join(' ');
  if (unite === 'M3') return qte;
  if (unite === 'M2' && isCltLineFromNorm(line)) {
    const ep = extractThicknessMeters(rawText);
    if (!ep) return null;
    return qte * ep;
  }
  if ((unite === 'U' || unite === 'ENS') && (isCltLineFromNorm(line) || isLcLineFromNorm(line))) {
    const dims = extractSectionLengthForUnitPieces(rawText);
    if (!dims) return null;
    return qte * dims.sectionM2 * dims.lengthM;
  }
  return null;
}

function allocateInvoiceLinesByBL(normalizedInvoiceLines, batchId, invoiceId) {
  const lines = [...(normalizedInvoiceLines || [])];
  const products = lines.filter((l) => l.type_technique === 'product');
  const annexes = lines.filter((l) => l.type_technique === 'annexe');
  const extrasByProductId = new Map(products.map((p) => [p.id, 0]));
  const blSet = new Set(products.map((p) => String(p.bl_numero || '').trim()).filter(Boolean));
  const hasMultiBL = blSet.size > 1;

  for (const annexe of annexes) {
    const amount = Number(annexe.montant) || 0;
    if (!products.length || amount === 0) continue;

    const annexeBL = String(annexe.bl_numero || '').trim();
    let targets = [];
    if (annexeBL) {
      targets = products.filter((p) => String(p.bl_numero || '').trim() === annexeBL);
    } else if (!hasMultiBL) {
      // Sans BL explicite sur facture mono-BL: on autorise une ventilation.
      targets = products;
    } else {
      // Règle métier: transport/annexe sans BL sur facture multi-BL = non ventilé.
      targets = [];
    }
    if (!targets.length) continue;

    const volWeights = targets.map((p) => ({ id: p.id, w: computeVolumeM3FromNorm(p) || 0 })).filter((x) => x.w > 0);
    const qtyWeights = targets.map((p) => ({ id: p.id, w: Number(p.qte_fact) || 0 })).filter((x) => x.w > 0);
    const weights = volWeights.length ? volWeights : (qtyWeights.length ? qtyWeights : targets.map((p) => ({ id: p.id, w: 1 })));
    const sumW = weights.reduce((a, b) => a + b.w, 0) || 1;

    for (const w of weights) {
      const part = amount * (w.w / sumW);
      extrasByProductId.set(w.id, (extrasByProductId.get(w.id) || 0) + part);
    }
  }

  return lines.map((l) => {
    const base = Number(l.montant) || 0;
    const isProduct = l.type_technique === 'product';
    const extra = isProduct ? (extrasByProductId.get(l.id) || 0) : 0;
    return {
      id: `alloc_${l.id}`,
      normalized_line_id: l.id,
      raw_invoice_id: invoiceId,
      batch_id: batchId,
      allocated_montant: isProduct ? (base + extra) : base,
      base_montant: base,
      allocated_extra: extra,
      allocation_key: annexes.length ? 'BL' : 'none',
      allocation_details: annexes.length ? `annexes=${annexes.length}; multi_bl=${hasMultiBL ? 1 : 0}` : null,
      volume_m3: computeVolumeM3FromNorm(l),
      active_for_indicators: Number(l.excluded_from_indicators || 0) ? 0 : (l.type_technique === 'annexe' ? 0 : 1)
    };
  });
}

// ─── MIDDLEWARES ────────────────────────────────────────────────────────────────

// CORS : accepte uniquement les requêtes provenant du réseau local ou de localhost.
// Bloque toute tentative d'accès depuis l'extérieur du réseau d'entreprise.
app.use(cors({
  origin(origin, callback) {
    // Pas d'origin = même origine (appels directs depuis le serveur, curl, etc.)
    if (!origin) return callback(null, true);
    // Pages file:// (dossiers chantier locaux) envoient origin "null" en string
    if (origin === 'null') return callback(null, true);
    // Autoriser localhost / 127.0.0.1 sur n'importe quel port
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    // Autoriser les plages d'IP réseau local (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    if (/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error('CORS : origine non autorisée'));
  },
  optionsSuccessStatus: 200
}));

app.use(express.json({ limit: '50mb' }));

// ── Middleware : validation du token serveur sur les routes d'écriture ──────────
// Le token est généré au démarrage et communiqué via /api/health.
// Toutes les requêtes PUT doivent inclure : header "x-goudalle-token: <token>"
function requireToken(req, res, next) {
  const token = req.headers['x-goudalle-token'];
  if (!token || token !== SERVER_TOKEN) {
    return res.status(403).json({ error: 'Token de sécurité invalide ou manquant.' });
  }
  next();
}

// ── Middleware : rate limiting sur les écritures ─────────────────────────────────
// Limite à 60 requêtes PUT/60s par IP pour bloquer les abus.
function requireWriteRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkWriteRateLimit(ip)) {
    return res.status(429).json({ error: 'Trop de requêtes. Réessayez dans un moment.' });
  }
  next();
}

// Sert les fichiers statiques du site (HTML, CSS, JS, images)
app.use(express.static(path.join(__dirname, '../client')));

// ─── ROUTES : UTILISATEURS (source de vérité = Excel W:\BCHDF\...) ─────────────

// ─── ROUTES : CHANTIERS MAÇONNERIE (stockés en DB) ──────────────────────────────
app.get('/api/chantiers', (req, res) => {
  res.json(dbGet('chantiers', []));
});

app.put('/api/chantiers', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('chantiers', req.body);
  res.json({ success: true });
});

app.get('/api/users', (req, res) => {
  res.json(readAccountsExcel());
});

// Retourne la liste des pages groupées pour la gestion des utilisateurs.
// Généré depuis PAGES_CONFIG — se met à jour automatiquement quand on ajoute une page.
app.get('/api/pages', (_req, res) => {
  const seen = new Set();
  const groups = {};
  for (const p of PAGES_CONFIG) {
    if (p.hidden) continue;
    if (seen.has(p.perm)) continue;
    seen.add(p.perm);
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push({ perm: p.perm, label: p.label });
  }
  res.json(Object.entries(groups).map(([group, pages]) => ({ group, pages })));
});

app.put('/api/users', requireToken, requireWriteRateLimit, async (req, res) => {
  const result = await writeAccountsExcel(req.body);
  if (result === true) res.json({ success: true });
  else {
    const errMsg = (result && result.error) ? result.error : 'Impossible d\'écrire dans le fichier Excel des comptes.';
    res.status(500).json({ success: false, error: errMsg });
  }
});

// ─── ROUTE : CONNEXION (validation serveur via Excel) ────────────────────────────

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '❌ Identifiants manquants.' });
  }
  const users = readAccountsExcel();
  const keys = Object.keys(users);
  const matchedKey = keys.find(k => k.toLowerCase() === String(username).toLowerCase());
  const user = matchedKey ? users[matchedKey] : null;
  if (!user || !user.isActive || user.password !== String(password)) {
    console.warn(`[Login] ÉCHEC — "${username}"`);
    return res.json({ success: false, message: '❌ Identifiants incorrects.' });
  }
  console.log(`[Login] ✅ "${username}"`);
  const { password: _pw, ...userPublic } = user;
  res.json({ success: true, message: '✅ Connexion réussie', user: userPublic });
});

// ─── ROUTES : CODE ADMIN ────────────────────────────────────────────────────────
// GET protégé : le code admin ne doit pas être lisible sans token valide.

app.get('/api/admin-code', requireToken, (_req, res) => {
  res.json(dbGet('admin_code', '0000'));
});

app.put('/api/admin-code', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('admin_code', req.body);
  res.json({ success: true });
});

// ─── ROUTES : AUDIT ─────────────────────────────────────────────────────────────

app.get('/api/audit', (req, res) => {
  res.json(dbGet('audit', []));
});

app.put('/api/audit', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('audit', req.body);
  res.json({ success: true });
});

// ─── ROUTES : SEUILS KPI ────────────────────────────────────────────────────────

app.get('/api/thresholds', (req, res) => {
  res.json(dbGet('thresholds', { ratioThreshold: 5 }));
});

app.put('/api/thresholds', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('thresholds', req.body);
  res.json({ success: true });
});

// ─── ROUTES : CBCO PRODUCTIVITÉ USINE ────────────────────────────────────────────

function getCBCOProdConfig() {
  let cfg = dbGet('cbco_productivite_excel_config', null);
  if (!cfg || !cfg.active) {
    try {
      const backup = readExcelPathsBackup().cbco_productivite;
      if (backup?.folder && backup?.filename) {
        cfg = { ...backup, active: true };
        dbSet('cbco_productivite_excel_config', cfg);
      }
    } catch (_) {}
  }
  return cfg;
}

app.get('/api/cbco-productivite', (req, res) => {
  const cfg = getCBCOProdConfig();
  if (!cfg || !cfg.active) return res.json({ entries: [], error: 'no_config' });
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.force === '1';
    const parsed = getCBCOProdExcelCached(cfg, { forceRefresh });
    res.json({ entries: parsed.entries, source: parsed.source || null });
  } catch(e) {
    res.json({ entries: [], error: 'excel_error', message: e.message });
  }
});

app.get('/api/cbco-securite', (req, res) => {
  res.json(dbGet('cbco_securite', {}));
});

app.put('/api/cbco-securite', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('cbco_securite', req.body);
  res.json({ success: true });
});

// ─── EXCEL CBCO PRODUCTIVITÉ : CONFIG + WATCHER + AUTO-IMPORT ────────────────

function parseCBCOProdExcel(cfg) {
  const resolved = resolveCBCOProdExcelPath(cfg);
  const excelPath = resolved.fullPath;
  const stat = fs.statSync(excelPath);

  const wb = XLSX.readFile(excelPath);
  const normName = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');

  const toNum = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const raw = String(v).trim();
    if (raw.startsWith('#')) return null;
    const isPct = raw.includes('%');
    const cleaned = raw.replace(/\s/g,'').replace('%','').replace(',','.');
    const m = cleaned.match(/-?\d+(\.\d+)?/);
    const p = m ? parseFloat(m[0]) : NaN;
    if (!Number.isFinite(p)) return null;
    return isPct ? p / 100 : p;
  };

  const toDur = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return null;
      if (v >= 0 && v <= 60) return v * 24;
      return v;
    }
    const raw = String(v).trim();
    const hms = raw.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (hms) return parseInt(hms[1]) + parseInt(hms[2]) / 60 + parseInt(hms[3] || '0') / 3600;
    return toNum(v);
  };

  const toRatio = (v) => {
    const n = toNum(v);
    if (n === null) return null;
    return n > 1 ? n / 100 : n;
  };

  const hasVal = (v) => v !== null && v !== undefined && String(v).trim() !== '';

  function parseMachine(sheetKey, colCfg) {
    const sheetName = wb.SheetNames.find(n => normName(n) === sheetKey);
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    const byWeek = {};
    let emptyStreak = 0;
    for (let r = 3; r < rows.length; r++) {
      const row = rows[r] || [];
      const cubageVal = toNum(row[colCfg.F]);
      if (cubageVal === null) { if (++emptyStreak >= 50) break; continue; }
      emptyStreak = 0;
      const semaineAnnuelle = toNum(row[colCfg.B]);    // col B = numéro de semaine (1-52)
      const anneeDirecte    = toNum(row[colCfg.ANNEE]); // colonne Année (variable selon la feuille)
      const heuresOnaya     = toDur(row[colCfg.D]);
      const heuresPerdues   = toDur(row[colCfg.E]);
      const cubage          = cubageVal;
      const productivite    = colCfg.productiviteDur ? toDur(row[colCfg.G]) : toNum(row[colCfg.G]);
      const remarques       = hasVal(row[colCfg.H]) ? String(row[colCfg.H]).trim() : null;
      const cible           = colCfg.cibleDur ? toDur(row[colCfg.J]) : toNum(row[colCfg.J]);
      const trs             = colCfg.TRS !== undefined ? toRatio(row[colCfg.TRS]) : null;
      const tempsUtil       = colCfg.TEMPS !== undefined ? toDur(row[colCfg.TEMPS]) : null;
      const prodHM          = colCfg.PRODHM !== undefined ? toNum(row[colCfg.PRODHM]) : null;
      const volume          = colCfg.VOLUME !== undefined ? toNum(row[colCfg.VOLUME]) : null;
      const presses         = colCfg.PRESSES !== undefined ? toNum(row[colCfg.PRESSES]) : null;
      const caissons        = colCfg.CAISSONS !== undefined ? toNum(row[colCfg.CAISSONS]) : null;
      const surface         = colCfg.SURFACE !== undefined ? toNum(row[colCfg.SURFACE]) : null;

      if (semaineAnnuelle === null || semaineAnnuelle <= 0) continue;
      if (anneeDirecte === null || anneeDirecte < 2000) continue;
      const req = colCfg.required || ['heuresOnaya', 'cubage'];
      const vals = { heuresOnaya, heuresPerdues, cubage, productivite };
      if (req.some(f => vals[f] === null)) continue;

      // col B = semaine, colonne ANNEE = année (index variable par feuille)
      const week = Math.round(semaineAnnuelle);
      const year = Math.round(anneeDirecte);
      if (!week || !year) continue;

      const heuresUtiles = (heuresOnaya !== null && heuresPerdues !== null) ? Math.max(0, heuresOnaya - heuresPerdues) : null;
      const prod = (cubage !== null && heuresUtiles !== null && heuresUtiles > 0) ? (cubage / heuresUtiles) : productivite;
      const key = `${year}-${String(week).padStart(2,'0')}`;
      byWeek[key] = { week, year, semaineAnnuelle, anneeDirecte, heuresOnaya, heuresPerdues, heuresUtiles, cubage, productivite: prod, remarques, cibleProductivite: cible, trs, tempsUtilisationMachine: tempsUtil, productiviteHeuresMachines: prodHM, volume, nombrePressees: presses, nombreCaissons: caissons, surfaceCollee: surface };
    }
    return Object.values(byWeek);
  }

  function parseQualite() {
    const sheetName = wb.SheetNames.find(n => normName(n) === 'qualite');
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    const byWeek = {};
    let emptyStreak = 0;
    for (let r = 3; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!hasVal(row[3]) && !hasVal(row[4]) && !hasVal(row[5]) && !hasVal(row[6])) {
        if (++emptyStreak >= 50) break; continue;
      }
      emptyStreak = 0;
      const semaineAnnuelle = toNum(row[1]); // col B = numéro de semaine
      const anneeDirecte    = toNum(row[7]); // col H = Année
      const tests           = toNum(row[3]); // col D
      const nonConformites  = toNum(row[4]); // col E
      const detail          = hasVal(row[5]) ? String(row[5]).trim() : null; // col F
      const reclamations    = toNum(row[6]); // col G
      if (semaineAnnuelle === null || semaineAnnuelle <= 0) continue;
      if (anneeDirecte === null || anneeDirecte < 2000) continue;
      const week = Math.round(semaineAnnuelle);
      const year = Math.round(anneeDirecte);
      if (!week || !year) continue;
      const key = `${year}-${String(week).padStart(2,'0')}`;
      byWeek[key] = { week, year, semaineAnnuelle, anneeDirecte, tests, nonConformites, detail, reclamationsClients: reclamations, annee: year };
    }
    return Object.values(byWeek);
  }

  const sc         = parseMachine('sc',         { B:1, ANNEE:14, D:3, E:4, F:5, G:6, H:7, J:9,  TRS:11, TEMPS:13 });
  const ultra      = parseMachine('ultra',       { B:1, ANNEE:13, D:3, E:4, F:5, G:6, H:7, J:9,  TRS:10, TEMPS:8  });
  const extra      = parseMachine('extra',       { B:1, ANNEE:15, D:3, E:4, F:5, G:6, H:7, J:9,  TRS:11, TEMPS:8, PRODHM:10, VOLUME:12 });
  const collage    = parseMachine('collage',     { B:1, ANNEE:11, D:3, E:4, F:5, G:6, H:7, J:9,  PRESSES:5, CAISSONS:8, SURFACE:10, productiviteDur:true, cibleDur:true, required:['heuresOnaya', 'cubage'] });
  const assemblage = parseMachine('assemblage',  { B:1, ANNEE:9,  D:3, E:4, F:5, G:6, H:7, TEMPS:8, VOLUME:8, required:['heuresOnaya','heuresPerdues','cubage'] });
  const qualite    = parseQualite();

  const merged = {};
  const ensureWeek = (week, year) => {
    const key = `${year}-${String(week).padStart(2,'0')}`;
    if (!merged[key]) merged[key] = { id: `prod-${key}`, week, year, semaineLabel: `S${week} ${year}`, importDate: new Date().toISOString() };
    return merged[key];
  };

  sc.forEach(e => { const r = ensureWeek(e.week, e.year); r.speedcutM3=e.cubage; r.speedcutHeuresOnaya=e.heuresOnaya; r.speedcutHeuresPerdues=e.heuresPerdues; r.speedcutHeuresUtiles=e.heuresUtiles; r.speedcutProductivite=e.productivite; r.speedcutCibleProductivite=e.cibleProductivite; r.speedcutTRS=e.trs; r.speedcutTempsUtilisation=e.tempsUtilisationMachine; r.speedcutRemarques=e.remarques; });
  ultra.forEach(e => { const r = ensureWeek(e.week, e.year); r.ultraM3=e.cubage; r.ultraHeuresOnaya=e.heuresOnaya; r.ultraHeuresPerdues=e.heuresPerdues; r.ultraHeuresUtiles=e.heuresUtiles; r.ultraProductivite=e.productivite; r.ultraCibleProductivite=e.cibleProductivite; r.ultraTRS=e.trs; r.ultraTempsUtilisation=e.tempsUtilisationMachine; r.ultraRemarques=e.remarques; });
  extra.forEach(e => { const r = ensureWeek(e.week, e.year); r.extraM2=e.cubage; r.extraHeuresOnaya=e.heuresOnaya; r.extraHeuresPerdues=e.heuresPerdues; r.extraHeuresUtiles=e.heuresUtiles; r.extraProductivite=e.productivite; r.extraCibleProductivite=e.cibleProductivite; r.extraTRS=e.trs; r.extraTempsUtilisation=e.tempsUtilisationMachine; r.extraRemarques=e.remarques; r.extraProductiviteHeuresMachines=e.productiviteHeuresMachines; r.extraVolume=e.volume; });
  collage.forEach(e => { const r = ensureWeek(e.week, e.year); r.collageHeures=e.heuresOnaya; r.collagePresses=e.nombrePressees; r.collageTempsPressee=e.productivite; r.collageCommentaire=e.remarques; r.collageNombreCaissons=e.nombreCaissons; r.collageCibleTempsPressee=e.cibleProductivite; r.collageSurface=e.surfaceCollee; });
  assemblage.forEach(e => { const r = ensureWeek(e.week, e.year); r.assemblageTempsRealise=e.heuresOnaya; r.assemblageTempsTheorique=e.heuresPerdues; r.assemblageNombreCaissons=e.nombreCaissons; r.assemblageVariation=(e.heuresOnaya!==null&&e.heuresPerdues!==null&&e.heuresPerdues>0)?((e.heuresOnaya-e.heuresPerdues)/e.heuresPerdues)*100:e.productivite; r.assemblageCommentaire=e.remarques; r.assemblageSurface=e.volume; });
  qualite.forEach(e => { const r = ensureWeek(e.week, e.year); r.qualiteTests=e.tests; r.qualiteNonConformites=e.nonConformites; r.qualiteDetail=e.detail; r.qualiteReclamationsClients=e.reclamationsClients; r.qualiteAnnee=e.annee; });

  const entries = Object.values(merged).sort((a,b) => a.year !== b.year ? a.year - b.year : a.week - b.week);
  return {
    entries,
    stats: { sc: sc.length, ultra: ultra.length, extra: extra.length, collage: collage.length, assemblage: assemblage.length, qualite: qualite.length },
    source: {
      fileName: path.basename(excelPath),
      fullPath: excelPath,
      lastModified: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      cachedAt: new Date().toISOString()
    }
  };
}

function resolveCBCOProdExcelPath(cfg) {
  let excelPath = path.join(cfg.folder, cfg.filename);
  if (!fs.existsSync(excelPath)) {
    const candidates = ['.xlsx', '.xlsm', '.xls'];
    const found = candidates.find(ext => fs.existsSync(excelPath + ext));
    if (found) excelPath = excelPath + found;
    else throw new Error(`Fichier introuvable : "${excelPath}"`);
  }
  return { fullPath: excelPath, stat: fs.statSync(excelPath) };
}

function getCBCOProdExcelCached(cfg, options = {}) {
  const resolved = resolveCBCOProdExcelPath(cfg);
  return getCachedExcelRead(
    'cbco_productivite',
    [resolved],
    () => parseCBCOProdExcel(cfg),
    options
  );
}

// ─── UTILITAIRE POUR RÉSOUDRE LES CHEMINS EXCEL ──────────────────────────────
function resolveExistingExcelPath(folder, filename) {
  const trimmedFolder = String(folder || '').trim().replace(/^["']|["']$/g, '');
  const trimmedFilename = String(filename || '').trim().replace(/^["']|["']$/g, '');
  const directPath = path.join(trimmedFolder, trimmedFilename);
  if (fs.existsSync(directPath)) {
    return { fullPath: directPath, resolvedFilename: trimmedFilename };
  }

  if (!fs.existsSync(trimmedFolder)) {
    throw new Error(`Dossier introuvable : "${trimmedFolder}"`);
  }

  const expectedBase = normalizeExcelName(trimmedFilename);
  const excelEntries = fs.readdirSync(trimmedFolder)
    .filter((entry) => /\.(xlsx|xlsm|xls)$/i.test(entry) && !/^~\$/.test(entry));

  let candidates = excelEntries
    .filter((entry) => normalizeExcelName(entry) === expectedBase);

  if (!candidates.length && expectedBase) {
    candidates = excelEntries.filter((entry) => {
      const normalizedEntry = normalizeExcelName(entry);
      return normalizedEntry.includes(expectedBase) || expectedBase.includes(normalizedEntry);
    });
  }

  if (candidates.length === 1) {
    return {
      fullPath: path.join(trimmedFolder, candidates[0]),
      resolvedFilename: candidates[0]
    };
  }

  if (candidates.length > 1) {
    throw new Error(`Plusieurs fichiers correspondent à "${trimmedFilename}" dans "${trimmedFolder}" : ${candidates.join(', ')}`);
  }

  const availableFiles = excelEntries.length ? ` Fichiers Excel trouvés : ${excelEntries.join(', ')}` : ' Aucun fichier Excel trouvé dans le dossier.';
  throw new Error(`Fichier introuvable : "${directPath}".${availableFiles}`);
}

app.get('/api/cbco-productivite-excel-config', (req, res) => {
  res.json(getCBCOProdConfig());
});

app.put('/api/cbco-productivite-excel-config', requireToken, requireWriteRateLimit, (req, res) => {
  const { folder, filename } = req.body;
  if (!folder || !filename) return res.status(400).json({ success: false, error: 'Champs manquants : folder, filename' });
  try {
    const parsed = parseCBCOProdExcel({ folder, filename });
    const cfg = { folder, filename, active: true, stats: parsed.stats };
    dbSet('cbco_productivite_excel_config', cfg);
    saveExcelPathBackup('cbco_productivite', { folder, filename });
    clearExcelReadCache('cbco_productivite');
    res.json({ success: true, stats: parsed.stats });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/cbco-productivite-excel-config', (req, res) => {
  dbSet('cbco_productivite_excel_config', null);
  deleteExcelPathBackup('cbco_productivite');
  clearExcelReadCache('cbco_productivite');
  res.json({ success: true });
});

// ─── ROUTES : SYLVE BALANCE ─────────────────────────────────────────────────────

app.get('/api/sylve-balance', (req, res) => {
  res.json(dbGet('sylve_balance', { cbco: [], gc: [], gm: [] }));
});

app.put('/api/sylve-balance', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('sylve_balance', req.body);
  res.json({ success: true });
});

// ─── ROUTES : SYLVE CA ──────────────────────────────────────────────────────────

app.get('/api/sylve-ca', (req, res) => {
  res.json(dbGet('sylve_ca', { cbco: 0, gc: 0, gm: 0, bilanDate: '' }));
});

app.put('/api/sylve-ca', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('sylve_ca', req.body);
  res.json({ success: true });
});

// ─── ROUTES : SYLVE PAIEMENTS EN ATTENTE ────────────────────────────────────────

app.get('/api/sylve-paiements', (req, res) => {
  res.json(dbGet('sylve_paiements', {}));
});

app.put('/api/sylve-paiements', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('sylve_paiements', req.body);
  res.json({ success: true });
});

// ─── ROUTES : ACHATS (IMPORTS ONAYA) ──────────────────────────────────────────────

app.get('/api/achats-imports', (req, res) => {
  res.json(dbGet('achats_imports', []));
});

app.put('/api/achats-imports', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('achats_imports', req.body);
  res.json({ success: true });
});

app.get('/api/achats-factures', (req, res) => {
  res.json(dbGet('achats_factures', []));
});

app.put('/api/achats-factures', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('achats_factures', req.body);
  res.json({ success: true });
});

app.get('/api/achats-lignes', (req, res) => {
  res.json(dbGet('achats_lignes', []));
});

app.put('/api/achats-lignes', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('achats_lignes', req.body);
  res.json({ success: true });
});

app.get('/api/achats-regles', (req, res) => {
  res.json(dbGet('achats_regles', []));
});

app.put('/api/achats-regles', requireToken, requireWriteRateLimit, (req, res) => {
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

// ─── ROUTES : ACHATS V2 (BLOCS FACTURES + BRUT/NORMALISÉ/RETRAITÉ) ─────────────────

app.get('/api/achats-v2/import-batches', (req, res) => {
  res.json(dbGet('achats_v2_import_batches', []));
});

app.get('/api/achats-v2/raw-invoices', (req, res) => {
  res.json(dbGet('achats_v2_raw_invoices', []));
});

app.get('/api/achats-v2/raw-lines', (req, res) => {
  res.json(dbGet('achats_v2_raw_invoice_lines', []));
});

app.get('/api/achats-v2/normalized-lines', (req, res) => {
  res.json(dbGet('achats_v2_normalized_invoice_lines', []));
});

app.get('/api/achats-v2/allocated-lines', (req, res) => {
  res.json(dbGet('achats_v2_allocated_invoice_lines', []));
});

app.get('/api/achats-v2/render-cache', (req, res) => {
  res.json(dbGet('achats_v2_invoice_render_cache', []));
});

app.get('/api/achats-v2/versions', (req, res) => {
  res.json(dbGet('achats_v2_invoice_versions', []));
});

app.get('/api/achats-v2/anomalies', (req, res) => {
  res.json(dbGet('achats_v2_anomaly_logs', []));
});

app.delete('/api/achats-v2/history', (req, res) => {
  dbSet('achats_v2_import_batches', []);
  dbSet('achats_v2_raw_invoices', []);
  dbSet('achats_v2_raw_invoice_lines', []);
  dbSet('achats_v2_normalized_invoice_lines', []);
  dbSet('achats_v2_allocated_invoice_lines', []);
  dbSet('achats_v2_invoice_render_cache', []);
  dbSet('achats_v2_invoice_versions', []);
  dbSet('achats_v2_anomaly_logs', []);
  res.json({ success: true, message: 'Historique achats v2 supprimé.' });
});

app.delete('/api/achats-v2/import-batches/:batchId', (req, res) => {
  const batchId = String(req.params.batchId || '');
  if (!batchId) {
    return res.status(400).json({ success: false, error: 'batchId manquant.' });
  }

  const importBatches = dbGet('achats_v2_import_batches', []);
  const batch = importBatches.find((b) => b.id === batchId);
  if (!batch) {
    return res.status(404).json({ success: false, error: 'Import introuvable.' });
  }

  const rawInvoices = dbGet('achats_v2_raw_invoices', []);
  const rawInvoiceIds = new Set(rawInvoices.filter((r) => r.batch_id === batchId).map((r) => r.id));

  // Purger aussi l'historique legacy correspondant à ce batch.
  // Compatibilité :
  // - priorité au champ sourceBatchId / batchIds si présent
  // - fallback sur nom de fichier + date d'import pour les anciennes données
  const legacyImports = dbGet('achats_imports', []);
  const legacyFactures = dbGet('achats_factures', []);
  const legacyLignes = dbGet('achats_lignes', []);

  const matchesBatchFallback = (entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (String(entry.sourceBatchId || '') === batchId) return true;

    const entryFile = String(entry.nomFichierImporte || entry.nomFichier || '').trim();
    const batchFile = String(batch.nom_fichier || '').trim();
    const entryDate = String(entry.dateImport || '').trim();
    const batchDate = String(batch.date_import || '').trim();
    return Boolean(batchFile && entryFile === batchFile && batchDate && entryDate === batchDate);
  };

  const keptLegacyFactures = legacyFactures.filter((f) => !matchesBatchFallback(f));
  const deletedLegacyFactureIds = new Set(
    legacyFactures
      .filter((f) => !keptLegacyFactures.includes(f))
      .map((f) => String(f.idFacture || ''))
      .filter(Boolean)
  );
  const keptLegacyLignes = legacyLignes.filter((l) => {
    if (String(l.sourceBatchId || '') === batchId) return false;
    if (deletedLegacyFactureIds.has(String(l.idFactureParente || ''))) return false;
    return true;
  });
  const keptLegacyImports = legacyImports.filter((imp) => {
    const batchIds = Array.isArray(imp.batchIds) ? imp.batchIds.map((id) => String(id)) : [];
    if (batchIds.includes(batchId)) return false;
    return !matchesBatchFallback(imp);
  });

  dbSet('achats_v2_import_batches', importBatches.filter((b) => b.id !== batchId));
  dbSet('achats_v2_raw_invoices', rawInvoices.filter((r) => r.batch_id !== batchId));
  dbSet('achats_v2_raw_invoice_lines', dbGet('achats_v2_raw_invoice_lines', []).filter((l) => !rawInvoiceIds.has(l.raw_invoice_id)));
  dbSet('achats_v2_normalized_invoice_lines', dbGet('achats_v2_normalized_invoice_lines', []).filter((l) => !rawInvoiceIds.has(l.raw_invoice_id)));
  dbSet('achats_v2_allocated_invoice_lines', dbGet('achats_v2_allocated_invoice_lines', []).filter((l) => !rawInvoiceIds.has(l.raw_invoice_id)));
  dbSet('achats_v2_invoice_render_cache', dbGet('achats_v2_invoice_render_cache', []).filter((r) => r.batch_id !== batchId));
  dbSet('achats_v2_invoice_versions', dbGet('achats_v2_invoice_versions', []).filter((v) => !rawInvoiceIds.has(v.raw_invoice_id)));
  dbSet('achats_v2_anomaly_logs', dbGet('achats_v2_anomaly_logs', []).filter((a) => a.batch_id !== batchId));
  dbSet('achats_imports', keptLegacyImports);
  dbSet('achats_factures', keptLegacyFactures);
  dbSet('achats_lignes', keptLegacyLignes);

  return res.json({ success: true, deleted_batch_id: batchId });
});

function extractYearMonthFromRawDate(rawDate) {
  const txt = String(rawDate || '').trim();
  let m = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return { year: m[3], month: m[2] };
  m = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { year: m[1], month: m[2] };
  return null;
}

function getBatchInvoices(batchId) {
  return dbGet('achats_v2_raw_invoices', []).filter((r) => r.batch_id === batchId);
}

function getBatchLines(batchId) {
  const invoiceIds = new Set(getBatchInvoices(batchId).map((inv) => inv.id));
  return dbGet('achats_v2_raw_invoice_lines', []).filter((line) => invoiceIds.has(line.raw_invoice_id));
}

function buildInvoiceSummary(invoice, lines = []) {
  const sumLines = (lines || []).reduce((acc, line) => acc + (Number(line.montant) || 0), 0);
  return {
    id: invoice.id,
    date: invoice.date || '',
    numero_facture: invoice.numero_facture || '',
    fournisseur: invoice.fournisseur || '',
    chantier: invoice.chantier || '',
    libelle_facture: invoice.libelle_facture || '',
    montant_ht: pickRobustInvoiceTotal(invoice.montant_ht, invoice.total_bon, sumLines),
    line_count: Array.isArray(lines) ? lines.length : 0,
    excluded_from_indicators: Number(invoice.excluded_from_indicators || 0),
  };
}

app.get('/api/achats-v2/control/:batchId/periods', (req, res) => {
  const batchId = String(req.params.batchId || '');
  const batch = dbGet('achats_v2_import_batches', []).find((b) => b.id === batchId);
  if (!batch) {
    return res.status(404).json({ success: false, error: 'Batch introuvable.' });
  }

  const invoices = getBatchInvoices(batchId);
  const byPeriod = new Map();
  for (const invoice of invoices) {
    const ym = extractYearMonthFromRawDate(invoice.date);
    if (!ym) continue;
    const key = `${ym.year}-${ym.month}`;
    if (!byPeriod.has(key)) {
      byPeriod.set(key, {
        year: ym.year,
        month: ym.month,
        invoice_count: 0,
      });
    }
    byPeriod.get(key).invoice_count += 1;
  }

  const periods = [...byPeriod.values()].sort((a, b) => `${b.year}${b.month}`.localeCompare(`${a.year}${a.month}`));
  return res.json({ success: true, batch, periods });
});

app.get('/api/achats-v2/control/:batchId/invoices', (req, res) => {
  const batchId = String(req.params.batchId || '');
  const year = String(req.query.year || '').trim();
  const month = String(req.query.month || '').trim().padStart(2, '0');
  const batch = dbGet('achats_v2_import_batches', []).find((b) => b.id === batchId);
  if (!batch) {
    return res.status(404).json({ success: false, error: 'Batch introuvable.' });
  }
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) {
    return res.status(400).json({ success: false, error: 'Paramètres year/month invalides.' });
  }

  const invoices = getBatchInvoices(batchId);
  const filteredInvoices = invoices.filter((invoice) => {
    const ym = extractYearMonthFromRawDate(invoice.date);
    return ym && ym.year === year && ym.month === month;
  });
  const invoiceIds = new Set(filteredInvoices.map((invoice) => invoice.id));
  const lines = dbGet('achats_v2_raw_invoice_lines', []).filter((line) => invoiceIds.has(line.raw_invoice_id));
  const linesByInvoiceId = new Map();
  for (const line of lines) {
    if (!linesByInvoiceId.has(line.raw_invoice_id)) linesByInvoiceId.set(line.raw_invoice_id, []);
    linesByInvoiceId.get(line.raw_invoice_id).push(line);
  }

  const summaries = filteredInvoices.map((invoice) => buildInvoiceSummary(invoice, linesByInvoiceId.get(invoice.id) || []));
  return res.json({
    success: true,
    batch,
    year,
    month,
    invoices: summaries,
  });
});

app.get('/api/achats-v2/control/:batchId/invoices/:invoiceId/lines', (req, res) => {
  const batchId = String(req.params.batchId || '');
  const invoiceId = String(req.params.invoiceId || '');
  const batch = dbGet('achats_v2_import_batches', []).find((b) => b.id === batchId);
  if (!batch) {
    return res.status(404).json({ success: false, error: 'Batch introuvable.' });
  }

  const invoice = getBatchInvoices(batchId).find((inv) => inv.id === invoiceId);
  if (!invoice) {
    return res.status(404).json({ success: false, error: 'Facture introuvable pour ce batch.' });
  }

  const lines = dbGet('achats_v2_raw_invoice_lines', [])
    .filter((line) => line.raw_invoice_id === invoiceId)
    .sort((a, b) => Number(a.line_order || 0) - Number(b.line_order || 0))
    .map((line) => ({
      raw_invoice_id: line.raw_invoice_id,
      line_order: line.line_order,
      ressource: line.ressource || '',
      bl_numero: line.bl_numero || '',
      arc: line.arc || '',
      chantier_ligne: line.chantier_ligne || invoice.chantier || '',
      libelle_ligne: line.libelle_ligne || '',
      unite: line.unite || '',
      qte_fact: line.qte_fact,
      pu: line.pu,
      montant: line.montant
    }));

  return res.json({
    success: true,
    batch,
    invoice: buildInvoiceSummary(invoice, lines),
    lines,
  });
});

app.get('/api/achats-v2/control/:batchId', (req, res) => {
  const batchId = String(req.params.batchId || '');
  const batch = dbGet('achats_v2_import_batches', []).find((b) => b.id === batchId);
  if (!batch) {
    return res.status(404).json({ success: false, error: 'Batch introuvable.' });
  }
  const invoices = dbGet('achats_v2_raw_invoices', []).filter((r) => r.batch_id === batchId);
  const lines = dbGet('achats_v2_raw_invoice_lines', []).filter((l) => {
    const inv = invoices.find((i) => i.id === l.raw_invoice_id);
    return Boolean(inv);
  });
  const normalized = dbGet('achats_v2_normalized_invoice_lines', []).filter((l) => {
    const inv = invoices.find((i) => i.id === l.raw_invoice_id);
    return Boolean(inv);
  });
  const allocated = dbGet('achats_v2_allocated_invoice_lines', []).filter((l) => {
    const inv = invoices.find((i) => i.id === l.raw_invoice_id);
    return Boolean(inv);
  });
  const versions = dbGet('achats_v2_invoice_versions', []).filter((v) => {
    const inv = invoices.find((i) => i.id === v.raw_invoice_id);
    return Boolean(inv);
  });
  const anomalies = dbGet('achats_v2_anomaly_logs', []).filter((a) => a.batch_id === batchId);
  return res.json({
    success: true,
    batch,
    invoices,
    lines,
    normalized,
    allocated,
    versions,
    anomalies
  });
});

app.post('/api/achats-v2/import-pdf', async (req, res) => {
  try {
    const fileName = String(req.body?.fileName || 'import.pdf');
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

    const blockParsed = parsePdfInvoiceBlocks(text);
    const now = new Date().toISOString();
    const batchId = `impv2_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const importBatches = dbGet('achats_v2_import_batches', []);
    const rawInvoices = dbGet('achats_v2_raw_invoices', []);
    const rawLines = dbGet('achats_v2_raw_invoice_lines', []);
    const normalizedLines = dbGet('achats_v2_normalized_invoice_lines', []);
    const allocatedLines = dbGet('achats_v2_allocated_invoice_lines', []);
    const renderCache = dbGet('achats_v2_invoice_render_cache', []);
    const versions = dbGet('achats_v2_invoice_versions', []);
    const anomalyLogs = dbGet('achats_v2_anomaly_logs', []);

    let totalLines = 0;
    let totalStockExcluded = 0;

    for (const inv of blockParsed.invoices) {
      const invoiceId = `rawinv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const invoiceRawText = [inv.header_raw || '', ...inv.lines.map((l) => l.raw_text || ''), inv.total_bon != null ? `Total Bon ${inv.total_bon}` : '']
        .filter(Boolean)
        .join('\n');
      const invNormText = normalizeText([inv.fournisseur, inv.libelle_facture, inv.chantier].filter(Boolean).join(' '));
      const isStockInvoice = isStockRelatedText(invNormText);

      rawInvoices.push({
        id: invoiceId,
        batch_id: batchId,
        date_import: now,
        source_file: fileName,
        date: inv.date_facture || null,
        numero_facture: inv.numero_facture || null,
        avoir: inv.avoir || null,
        journal: inv.journal || null,
        fournisseur: inv.fournisseur || null,
        chantier: inv.chantier || null,
        libelle_facture: inv.libelle_facture || null,
        montant_ht: inv.montant_ht != null ? inv.montant_ht : null,
        total_bon: inv.total_bon != null ? inv.total_bon : null,
        header_raw: inv.header_raw || null,
        raw_text: invoiceRawText,
        excluded_from_indicators: isStockInvoice ? 1 : 0,
        parse_warnings: inv.warnings || []
      });

      const normalizedForAllocation = [];

      const renderBlocks = [];
      for (const line of inv.lines) {
        const lineId = `rawline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const isStockLine = isStockInvoice || isStockRelatedText([
          inv.fournisseur,
          inv.libelle_facture,
          line.libelle_ligne,
          line.ressource,
          line.raw_text
        ].filter(Boolean).join(' '));
        if (isStockLine) totalStockExcluded += 1;

        const lineChantier = line.chantier_ligne || inv.chantier || null;
        rawLines.push({
          id: lineId,
          raw_invoice_id: invoiceId,
          line_order: line.line_order,
          raw_text: line.raw_text || null,
          ressource: line.ressource || null,
          bl_numero: line.bl_numero || null,
          arc: line.arc || null,
          chantier_ligne: lineChantier,
          libelle_ligne: line.libelle_ligne || null,
          unite: line.unite || null,
          qte_fact: line.qte_fact != null ? line.qte_fact : null,
          pu: line.pu != null ? line.pu : null,
          montant: line.montant != null ? line.montant : null,
          excluded_from_indicators: isStockLine ? 1 : 0
        });

        const normLine = {
          id: `norm_${lineId}`,
          raw_line_id: lineId,
          raw_invoice_id: invoiceId,
          line_order: line.line_order,
          ressource: line.ressource || null,
          bl_numero: line.bl_numero || null,
          arc: line.arc || null,
          chantier_ligne: lineChantier,
          libelle_ligne: line.libelle_ligne || null,
          unite: line.unite || null,
          qte_fact: line.qte_fact != null ? line.qte_fact : null,
          pu: line.pu != null ? line.pu : null,
          montant: line.montant != null ? line.montant : null,
          type_technique: 'product_or_service',
          categorie_technique: 'unclassified',
          excluded_from_indicators: isStockLine ? 1 : 0,
          is_transport: /transport/i.test(line.libelle_ligne || '') ? 1 : 0,
          is_eco: /(eco|contribution)/i.test(line.libelle_ligne || '') ? 1 : 0,
          is_taxe: /(taxe|tva|parafiscale|fiscale)/i.test(line.libelle_ligne || '') ? 1 : 0
        };
        const normText = normalizeText([normLine.ressource, normLine.libelle_ligne].filter(Boolean).join(' '));
        const upperUnite = String(normLine.unite || '').toUpperCase();
        const isAnnexe = isAnnexeText(normText);
        const serviceHint = isServiceText(normText);
        const woodHint = isWoodLikeText(normText);
        const isService = !isAnnexe && (serviceHint && !(woodHint && (upperUnite === 'M2' || upperUnite === 'M3')));
        normLine.type_technique = isAnnexe ? 'annexe' : (isService ? 'service' : 'product');
        normLine.categorie_technique = isAnnexe ? 'charge_annexe' : (isService ? 'service_non_ventilable' : 'matiere');
        normalizedLines.push(normLine);
        normalizedForAllocation.push(normLine);

        renderBlocks.push({
          type: 'line',
          line_order: line.line_order,
          columns: {
            ressource: line.ressource || '',
            bl_numero: line.bl_numero || '',
            arc: line.arc || '',
            chantier_ligne: line.chantier_ligne || '',
            libelle_ligne: line.libelle_ligne || '',
            unite: line.unite || '',
            qte_fact: line.qte_fact,
            pu: line.pu,
            montant: line.montant
          }
        });
      }

      totalLines += inv.lines.length;

      const invoiceAllocated = allocateInvoiceLinesByBL(normalizedForAllocation, batchId, invoiceId);
      allocatedLines.push(...invoiceAllocated);

      const allInvoices = rawInvoices.filter((x) => x.fournisseur === inv.fournisseur);
      const sameAmountInvoices = allInvoices.filter((x) => Number(x.montant_ht || 0).toFixed(2) === Number(inv.montant_ht || 0).toFixed(2));
      const isAvoir = Boolean(inv.avoir) || /(^|\s)avoir(\s|$)/i.test(String(inv.libelle_facture || ''));
      let versionStatus = 'active';
      let linkedInvoiceId = null;
      let linkedReason = null;
      if (isAvoir && sameAmountInvoices.length > 1) {
        const original = sameAmountInvoices.find((x) => x.id !== invoiceId);
        if (original) {
          versionStatus = 'avoir';
          linkedInvoiceId = original.id;
          linkedReason = 'avoir_annulation';
        }
      }
      versions.push({
        id: `ver_${invoiceId}`,
        raw_invoice_id: invoiceId,
        status: versionStatus,
        linked_invoice_id: linkedInvoiceId,
        linked_reason: linkedReason,
        created_at: now
      });

      renderCache.push({
        id: `render_${invoiceId}`,
        raw_invoice_id: invoiceId,
        batch_id: batchId,
        render_model: {
          header: {
            date: inv.date_facture || null,
            numero_facture: inv.numero_facture || null,
            avoir: inv.avoir || null,
            journal: inv.journal || null,
            fournisseur: inv.fournisseur || null,
            chantier: inv.chantier || null,
            libelle_facture: inv.libelle_facture || null,
            montant_ht: inv.montant_ht != null ? inv.montant_ht : null
          },
          blocks: renderBlocks,
          total_bon: inv.total_bon != null ? inv.total_bon : null
        }
      });
    }

    for (const w of blockParsed.warnings) {
      anomalyLogs.push({
        id: `an_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        batch_id: batchId,
        level: 'warning',
        message: w,
        created_at: now
      });
    }

    importBatches.push({
      id: batchId,
      date_import: now,
      nom_fichier: fileName,
      statut: 'parsed',
      total_lignes_extraites: totalLines,
      total_factures_detectees: blockParsed.invoices.length,
      total_lignes_exclues_stock: totalStockExcluded
    });

    dbSet('achats_v2_import_batches', importBatches);
    dbSet('achats_v2_raw_invoices', rawInvoices);
    dbSet('achats_v2_raw_invoice_lines', rawLines);
    dbSet('achats_v2_normalized_invoice_lines', normalizedLines);
    dbSet('achats_v2_allocated_invoice_lines', allocatedLines);
    dbSet('achats_v2_invoice_render_cache', renderCache);
    dbSet('achats_v2_invoice_versions', versions);
    dbSet('achats_v2_anomaly_logs', anomalyLogs);

    res.json({
      success: true,
      batch_id: batchId,
      invoices: blockParsed.invoices.length,
      lines: totalLines,
      excluded_stock_lines: totalStockExcluded,
      warnings: blockParsed.warnings
    });
  } catch (e) {
    res.status(500).json({ success: false, error: `Erreur import PDF v2: ${e.message}` });
  }
});

app.get('/api/achats-v2/indicators-monthly', (req, res) => {
  const rawInvoices = dbGet('achats_v2_raw_invoices', []);
  const versions = dbGet('achats_v2_invoice_versions', []);
  const norm = dbGet('achats_v2_normalized_invoice_lines', []);
  const alloc = dbGet('achats_v2_allocated_invoice_lines', []);

  const versionByInvoice = new Map(versions.map((v) => [v.raw_invoice_id, v]));
  const invoiceById = new Map(rawInvoices.map((i) => [i.id, i]));
  const normById = new Map(norm.map((n) => [n.id, n]));
  const excludedInvoiceIds = new Set();
  for (const v of versions) {
    if (v.status === 'avoir') {
      excludedInvoiceIds.add(v.raw_invoice_id);
      if (v.linked_invoice_id) excludedInvoiceIds.add(v.linked_invoice_id);
    }
    if (v.status === 'neutralized') excludedInvoiceIds.add(v.raw_invoice_id);
  }

  function toIsoMonth(frDate) {
    const m = String(frDate || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2]}`;
  }

  const byMonth = new Map();
  for (const a of alloc) {
    if (!Number(a.active_for_indicators || 0)) continue;
    const n = normById.get(a.normalized_line_id);
    if (!n) continue;
    if (n.type_technique !== 'product') continue;
    if (Number(n.excluded_from_indicators || 0)) continue;
    const inv = invoiceById.get(a.raw_invoice_id);
    if (!inv) continue;
    if (isCbcoSupplier(inv.fournisseur)) continue;
    if (excludedInvoiceIds.has(inv.id)) continue;
    const ver = versionByInvoice.get(inv.id);
    if (ver && (ver.status === 'neutralized' || ver.status === 'avoir')) continue;
    const month = toIsoMonth(inv.date);
    if (!month) continue;

    const isClt = isCltLineFromNorm(n);
    const isLc = isLcLineFromNorm(n);
    if (!isClt && !isLc) continue;

    if (!byMonth.has(month)) byMonth.set(month, { month, v_clt_m3: 0, v_lc_m3: 0, lc_amount: 0 });
    const row = byMonth.get(month);
    const vol = Number(a.volume_m3 != null ? a.volume_m3 : computeVolumeM3FromNorm(n));

    if (isClt && Number.isFinite(vol) && vol > 0) row.v_clt_m3 += vol;
    if (isLc && Number.isFinite(vol) && vol > 0) {
      row.v_lc_m3 += vol;
      row.lc_amount += Number(a.allocated_montant || 0);
    }
  }

  const rows = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((r) => ({
      month: r.month,
      v_clt_m3: r.v_clt_m3,
      v_lc_m3: r.v_lc_m3,
      prix_moyen_lc_eur_m3: r.v_lc_m3 > 0 ? (r.lc_amount / r.v_lc_m3) : null
    }));
  
  res.json({ success: true, rows });
});

// ─── ACHATS : NOUVEAU SYSTÈME (PDF sur disque + JSON cache) ──────────────────────

const ACHATS_NETWORK_PDF_DIR = process.env.ACHATS_PDF_DIR || 'W:\\BCHDF\\Site Intranet Groupe Goudalle\\Indicateurs achats';
const ACHATS_DATA_DIR = path.join(__dirname, 'achats', 'data');
if (!fs.existsSync(ACHATS_DATA_DIR)) fs.mkdirSync(ACHATS_DATA_DIR, { recursive: true });

const ACHATS_ARC_DIR = process.env.ACHATS_ARC_DIR || 'W:\\BCHDF\\Site Intranet Groupe Goudalle\\Indicateurs achats\\Codes ARC des Entreprises';
const ACHATS_ARC_LOCAL_DIR = path.join(__dirname, 'achats', 'arc-codes');
if (!fs.existsSync(ACHATS_ARC_LOCAL_DIR)) fs.mkdirSync(ACHATS_ARC_LOCAL_DIR, { recursive: true });

const ACHATS_ARC_FILES = {
  'Goudalle Charpente': 'Codes_ARC_Goudalle_Charpente.xlsx',
  'Nouvelle Goudalle Maçonnerie': 'Codes_ARC_Goudalle_Maconnerie.xlsx',
  'CBCO': 'Codes_ARC_CBCO.xlsx',
};

function getArcExcelPath(company) {
  const filename = ACHATS_ARC_FILES[company];
  if (!filename) return null;
  const networkPath = path.join(ACHATS_ARC_DIR, filename);
  if (fs.existsSync(networkPath)) return networkPath;
  return path.join(ACHATS_ARC_LOCAL_DIR, filename);
}

function readArcCodes(company) {
  const filePath = getArcExcelPath(company);
  if (!filePath || !fs.existsSync(filePath)) return [];
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return rows.slice(1)
    .filter((r) => r[0] !== '' && r[0] != null)
    .map((r) => ({ code: String(r[0]).trim(), designation: String(r[1] || '').trim() }))
    .filter((r) => r.code);
}

app.get('/api/achats/arc-codes', requireToken, (req, res) => {
  const company = String(req.query.company || '').trim();
  if (company) {
    if (!ACHATS_ARC_FILES[company]) return res.status(400).json({ success: false, error: `Société inconnue : ${company}` });
    try { return res.json({ success: true, company, codes: readArcCodes(company) }); }
    catch (e) { return res.status(500).json({ success: false, error: e.message }); }
  }
  const result = {};
  for (const c of Object.keys(ACHATS_ARC_FILES)) {
    try { result[c] = readArcCodes(c); } catch { result[c] = []; }
  }
  res.json({ success: true, companies: result });
});

app.post('/api/achats/arc-codes', requireToken, async (req, res) => {
  const company = String(req.body?.company || '').trim();
  const code = String(req.body?.code || '').trim();
  const designation = String(req.body?.designation || '').trim();
  if (!ACHATS_ARC_FILES[company]) return res.status(400).json({ success: false, error: 'Société inconnue.' });
  if (!code) return res.status(400).json({ success: false, error: 'Code requis.' });
  const filePath = getArcExcelPath(company);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Fichier Excel introuvable.' });
  if (readArcCodes(company).find((e) => e.code === code)) return res.status(409).json({ success: false, error: `Code ${code} existe déjà.` });
  try {
    const wb = await XlsxPopulate.fromFileAsync(filePath);
    const sheet = wb.sheet(0);
    const lastRow = sheet.usedRange().endCell().rowNumber();
    sheet.cell(lastRow + 1, 1).value(isNaN(code) ? code : Number(code));
    sheet.cell(lastRow + 1, 2).value(designation);
    await wb.toFileAsync(filePath);
    res.json({ success: true, code, designation });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/achats/arc-codes/:code', requireToken, async (req, res) => {
  const code = String(req.params.code || '').trim();
  const company = String(req.body?.company || '').trim();
  const designation = String(req.body?.designation || '').trim();
  if (!ACHATS_ARC_FILES[company]) return res.status(400).json({ success: false, error: 'Société inconnue.' });
  const filePath = getArcExcelPath(company);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Fichier Excel introuvable.' });
  try {
    const wb = await XlsxPopulate.fromFileAsync(filePath);
    const sheet = wb.sheet(0);
    const endRow = sheet.usedRange().endCell().rowNumber();
    let found = false;
    for (let r = 2; r <= endRow; r++) {
      if (String(sheet.cell(r, 1).value() ?? '').trim() === code) {
        sheet.cell(r, 2).value(designation); found = true; break;
      }
    }
    if (!found) return res.status(404).json({ success: false, error: `Code ${code} introuvable.` });
    await wb.toFileAsync(filePath);
    res.json({ success: true, code, designation });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/achats/arc-codes/:code', requireToken, async (req, res) => {
  const code = String(req.params.code || '').trim();
  const company = String(req.query.company || '').trim();
  if (!ACHATS_ARC_FILES[company]) return res.status(400).json({ success: false, error: 'Société inconnue.' });
  const filePath = getArcExcelPath(company);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Fichier Excel introuvable.' });
  try {
    const wb = await XlsxPopulate.fromFileAsync(filePath);
    const sheet = wb.sheet(0);
    const endRow = sheet.usedRange().endCell().rowNumber();
    let deleteRow = -1;
    for (let r = 2; r <= endRow; r++) {
      if (String(sheet.cell(r, 1).value() ?? '').trim() === code) { deleteRow = r; break; }
    }
    if (deleteRow === -1) return res.status(404).json({ success: false, error: `Code ${code} introuvable.` });
    for (let r = deleteRow; r < endRow; r++) {
      sheet.cell(r, 1).value(sheet.cell(r + 1, 1).value());
      sheet.cell(r, 2).value(sheet.cell(r + 1, 2).value());
    }
    sheet.cell(endRow, 1).value(undefined);
    sheet.cell(endRow, 2).value(undefined);
    await wb.toFileAsync(filePath);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

const ACHATS_COMPANIES = [
  'Goudalle Charpente',
  'Nouvelle Goudalle Maçonnerie',
  'CBCO',
  'Sylve Data'
];

function achatBuildPdfName(company, invoices) {
  const dates = (invoices || []).map((inv) => inv.date_facture || inv.date).filter(Boolean).map((d) => {
    const m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`) : null;
  }).filter(Boolean);
  if (!dates.length) return `Commandes ${company} - import.pdf`;
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  return `Commandes ${company} du ${fmt(minDate)} au ${fmt(maxDate)}.pdf`;
}

const _achatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) cb(null, true);
    else cb(new Error('Seuls les fichiers PDF sont acceptés.'));
  }
});

function readAchatImportMeta(batchId) {
  const dataFile = path.join(ACHATS_DATA_DIR, `${batchId}.json`);
  if (!fs.existsSync(dataFile)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return { id: raw.id, date_import: raw.date_import, company: raw.company || null, nom_fichier: raw.nom_fichier, total_factures: raw.total_factures, total_lignes: raw.total_lignes, total_stock_exclu: raw.total_stock_exclu };
  } catch { return null; }
}

function readAchatImportData(batchId) {
  const dataFile = path.join(ACHATS_DATA_DIR, `${batchId}.json`);
  if (!fs.existsSync(dataFile)) return null;
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return null; }
}

function achatToIsoMonth(frDate) {
  const m = String(frDate || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}`;
}

app.post('/api/achats/upload', requireToken, _achatUpload.single('pdf'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'Aucun fichier PDF reçu.' });
    const company = String(req.body?.company || '').trim();
    if (!company) return res.status(400).json({ success: false, error: 'Société non renseignée.' });
    if (!ACHATS_COMPANIES.includes(company)) return res.status(400).json({ success: false, error: `Société inconnue : ${company}` });

    const now = new Date().toISOString();
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Parse le PDF
    const parser = new PDFParse({ data: file.buffer });
    await parser.load();
    const parsed = await parser.getText();
    const text = String(parsed?.text || '').replace(/\r/g, '');
    await parser.destroy();

    const { invoices: rawInvoices, warnings } = parsePdfInvoiceBlocks(text);

    // Construire le nom de fichier depuis mois/année explicites ou dates parsées
    const reqMonth = String(req.body?.month || '').trim();
    const reqYear = String(req.body?.year || '').trim();
    let pdfName;
    if (reqMonth && reqYear) {
      const last = new Date(Number(reqYear), Number(reqMonth), 0).getDate();
      pdfName = `Commandes ${company} du 01.${reqMonth}.${reqYear} au ${last}.${reqMonth}.${reqYear}.pdf`;
    } else {
      pdfName = achatBuildPdfName(company, rawInvoices);
    }
    const pdfFullPath = path.join(ACHATS_NETWORK_PDF_DIR, pdfName);

    // Vérifier accès au dossier réseau, sinon fallback local
    let savedPdfPath = pdfName;
    let savedLocal = false;
    try {
      if (!fs.existsSync(ACHATS_NETWORK_PDF_DIR)) fs.mkdirSync(ACHATS_NETWORK_PDF_DIR, { recursive: true });
      fs.writeFileSync(pdfFullPath, file.buffer);
    } catch (e) {
      const localFallback = path.join(__dirname, 'achats', 'pdfs');
      if (!fs.existsSync(localFallback)) fs.mkdirSync(localFallback, { recursive: true });
      fs.writeFileSync(path.join(localFallback, pdfName), file.buffer);
      savedPdfPath = path.join('local', pdfName);
      savedLocal = true;
    }

    let totalLignes = 0;
    let totalStockExclu = 0;

    const invoices = rawInvoices.map((inv, invIdx) => {
      const invId = `inv_${batchId}_${invIdx + 1}`;
      const isStockInv = isStockRelatedText([inv.fournisseur, inv.libelle_facture, inv.chantier].filter(Boolean).join(' '));
      const lines = (inv.lines || []).map((l, lIdx) => {
        const isStockLine = isStockInv || isStockRelatedText([inv.fournisseur, inv.libelle_facture, l.libelle_ligne, l.ressource, l.raw_text].filter(Boolean).join(' '));
        if (isStockLine) totalStockExclu++;
        totalLignes++;
        return {
          id: `line_${invId}_${lIdx + 1}`,
          line_order: l.line_order,
          ressource: l.ressource || null,
          bl_numero: l.bl_numero || null,
          arc: l.arc || null,
          chantier_ligne: l.chantier_ligne || null,
          libelle_ligne: l.libelle_ligne || null,
          unite: l.unite || null,
          qte_fact: l.qte_fact != null ? Number(l.qte_fact) : null,
          pu: l.pu != null ? Number(l.pu) : null,
          montant: l.montant != null ? Number(l.montant) : null,
          excluded: isStockLine
        };
      });
      return {
        id: invId,
        date: inv.date_facture || null,
        numero_facture: inv.numero_facture || null,
        avoir: inv.avoir || null,
        journal: inv.journal || null,
        fournisseur: inv.fournisseur || null,
        chantier: inv.chantier || null,
        libelle_facture: inv.libelle_facture || null,
        montant_ht: inv.montant_ht != null ? Number(inv.montant_ht) : null,
        excluded: isStockInv,
        lines
      };
    });

    const importData = {
      id: batchId, date_import: now, company, nom_fichier: pdfName, pdf_path: savedPdfPath,
      total_factures: invoices.length, total_lignes: totalLignes, total_stock_exclu: totalStockExclu,
      warnings: warnings || [], invoices
    };
    fs.writeFileSync(path.join(ACHATS_DATA_DIR, `${batchId}.json`), JSON.stringify(importData));

    res.json({
      success: true, id: batchId, company, nom_fichier: pdfName,
      total_factures: invoices.length, total_lignes: totalLignes, total_stock_exclu: totalStockExclu,
      warnings, saved_local: savedLocal
    });
  } catch (e) {
    res.status(500).json({ success: false, error: `Erreur import: ${e.message}` });
  }
});

app.get('/api/achats/companies', (req, res) => {
  res.json({ success: true, companies: ACHATS_COMPANIES });
});

// Route de diagnostic : retourne le texte brut extrait + nb lignes parsées
app.post('/api/achats/debug-parse', requireToken, _achatUpload.single('pdf'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'Aucun fichier PDF reçu.' });
    const parser = new PDFParse({ data: file.buffer });
    await parser.load();
    const parsed = await parser.getText();
    const text = String(parsed?.text || '').replace(/\r/g, '');
    await parser.destroy();

    const rawLines = text.split(/\n/).filter((l) => l.trim());
    const headerMatches = rawLines.filter((l) => parsePdfHeaderLine(l) !== null);
    const articleMatches = rawLines.filter((l) => parsePdfArticleLine(l) !== null);
    const totalMatches = rawLines.filter((l) => parsePdfTotalLine(l) !== null);

    const { invoices, warnings } = parsePdfInvoiceBlocks(text);

    res.json({
      success: true,
      pages: parsed?.numpages || null,
      total_chars: text.length,
      total_lines: rawLines.length,
      header_lines_found: headerMatches.length,
      article_lines_found: articleMatches.length,
      total_bon_lines_found: totalMatches.length,
      invoices_parsed: invoices.length,
      warnings,
      sample_lines: rawLines.slice(0, 30),
      header_samples: headerMatches.slice(0, 3),
      article_samples: articleMatches.slice(0, 3)
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/achats/imports', (req, res) => {
  try {
    const files = fs.readdirSync(ACHATS_DATA_DIR).filter((f) => f.endsWith('.json'));
    const imports = files.map((f) => readAchatImportMeta(f.replace('.json', ''))).filter(Boolean)
      .sort((a, b) => String(b.date_import || '').localeCompare(String(a.date_import || '')));
    res.json({ success: true, imports });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/achats/indicators-monthly', (req, res) => {
  try {
    const files = fs.readdirSync(ACHATS_DATA_DIR).filter((f) => f.endsWith('.json'));
    const byMonth = new Map();
    for (const f of files) {
      const data = readAchatImportData(f.replace('.json', ''));
      if (!data || !data.invoices) continue;
      for (const inv of data.invoices) {
        if (inv.excluded || isCbcoSupplier(inv.fournisseur)) continue;
        const month = achatToIsoMonth(inv.date);
        if (!month) continue;
        for (const line of (inv.lines || [])) {
          if (line.excluded) continue;
          const txt = normalizeText([line.ressource, line.libelle_ligne].filter(Boolean).join(' '));
          const isClt = /\b(clt|klh)\b/.test(txt);
          const isLc = !isClt && /\b(lc|lamelle colle|lamelle-colle|lamelle)\b/.test(txt);
          if (!isClt && !isLc) continue;
          const vol = computeVolumeM3FromNorm({ ressource: line.ressource, libelle_ligne: line.libelle_ligne, unite: line.unite, qte_fact: line.qte_fact });
          if (!Number.isFinite(vol) || vol <= 0) continue;
          if (!byMonth.has(month)) byMonth.set(month, { month, v_clt_m3: 0, v_lc_m3: 0, lc_amount: 0 });
          const row = byMonth.get(month);
          if (isClt) row.v_clt_m3 += vol;
          if (isLc) { row.v_lc_m3 += vol; row.lc_amount += Number(line.montant || 0); }
        }
      }
    }
    const rows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
      .map((r) => ({ month: r.month, v_clt_m3: r.v_clt_m3, v_lc_m3: r.v_lc_m3, prix_moyen_lc_eur_m3: r.v_lc_m3 > 0 ? r.lc_amount / r.v_lc_m3 : null }));
    res.json({ success: true, rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/achats/imports/:batchId/invoices', (req, res) => {
  const { batchId } = req.params;
  const { year, month } = req.query;
  const data = readAchatImportData(batchId);
  if (!data) return res.status(404).json({ success: false, error: 'Import introuvable.' });

  let invoices = (data.invoices || []).map((inv) => ({
    id: inv.id, date: inv.date, numero_facture: inv.numero_facture, fournisseur: inv.fournisseur,
    chantier: inv.chantier, libelle_facture: inv.libelle_facture, montant_ht: inv.montant_ht,
    excluded: inv.excluded, line_count: (inv.lines || []).length
  }));

  if (year || month) {
    invoices = invoices.filter((inv) => {
      const m = achatToIsoMonth(inv.date);
      if (!m) return false;
      const [y, mo] = m.split('-');
      if (year && y !== String(year)) return false;
      if (month && mo !== String(month).padStart(2, '0')) return false;
      return true;
    });
  }

  const periodMap = new Map();
  for (const inv of (data.invoices || [])) {
    const m = achatToIsoMonth(inv.date);
    if (!m) continue;
    const [y, mo] = m.split('-');
    if (!periodMap.has(m)) periodMap.set(m, { year: y, month: mo, invoice_count: 0 });
    periodMap.get(m).invoice_count++;
  }
  const periods = [...periodMap.values()].sort((a, b) => `${a.year}-${a.month}`.localeCompare(`${b.year}-${b.month}`));

  res.json({ success: true, invoices, periods, batch: { id: data.id, nom_fichier: data.nom_fichier, total_factures: data.total_factures, total_lignes: data.total_lignes, total_stock_exclu: data.total_stock_exclu } });
});

app.get('/api/achats/imports/:batchId/invoices/:invId/lines', (req, res) => {
  const { batchId, invId } = req.params;
  const data = readAchatImportData(batchId);
  if (!data) return res.status(404).json({ success: false, error: 'Import introuvable.' });
  const inv = (data.invoices || []).find((i) => i.id === invId);
  if (!inv) return res.status(404).json({ success: false, error: 'Facture introuvable.' });
  res.json({ success: true, invoice: { id: inv.id, date: inv.date, numero_facture: inv.numero_facture, fournisseur: inv.fournisseur, chantier: inv.chantier, libelle_facture: inv.libelle_facture, montant_ht: inv.montant_ht, excluded: inv.excluded }, lines: inv.lines || [] });
});

app.post('/api/achats/imports/:batchId/reparse', requireToken, async (req, res) => {
  const { batchId } = req.params;
  const data = readAchatImportData(batchId);
  if (!data) return res.status(404).json({ success: false, error: 'Import introuvable.' });

  try {
    let pdfBuffer;
    if (data.pdf_path) {
      let pdfFile;
      if (String(data.pdf_path).startsWith('local' + path.sep) || String(data.pdf_path).startsWith('local/')) {
        pdfFile = path.join(__dirname, 'achats', 'pdfs', path.basename(data.pdf_path));
      } else {
        pdfFile = path.join(ACHATS_NETWORK_PDF_DIR, data.pdf_path);
      }
      if (!fs.existsSync(pdfFile)) return res.status(404).json({ success: false, error: 'Fichier PDF introuvable sur le serveur.' });
      pdfBuffer = fs.readFileSync(pdfFile);
    } else {
      return res.status(400).json({ success: false, error: 'Aucun chemin PDF enregistré pour cet import.' });
    }

    const parser = new PDFParse({ data: pdfBuffer });
    await parser.load();
    const parsed = await parser.getText();
    const text = String(parsed?.text || '').replace(/\r/g, '');
    await parser.destroy();

    const { invoices: rawInvoices, warnings } = parsePdfInvoiceBlocks(text);
    let totalLignes = 0;
    let totalStockExclu = 0;

    const invoices = rawInvoices.map((inv, invIdx) => {
      const invId = `inv_${batchId}_${invIdx + 1}`;
      const isStockInv = isStockRelatedText([inv.fournisseur, inv.libelle_facture, inv.chantier].filter(Boolean).join(' '));
      const lines = (inv.lines || []).map((l, lIdx) => {
        const isStockLine = isStockInv || isStockRelatedText([inv.fournisseur, inv.libelle_facture, l.libelle_ligne, l.ressource, l.raw_text].filter(Boolean).join(' '));
        if (isStockLine) totalStockExclu++;
        totalLignes++;
        return {
          id: `line_${invId}_${lIdx + 1}`,
          line_order: l.line_order,
          ressource: l.ressource || null,
          bl_numero: l.bl_numero || null,
          arc: l.arc || null,
          chantier_ligne: l.chantier_ligne || null,
          libelle_ligne: l.libelle_ligne || null,
          unite: l.unite || null,
          qte_fact: l.qte_fact != null ? Number(l.qte_fact) : null,
          pu: l.pu != null ? Number(l.pu) : null,
          montant: l.montant != null ? Number(l.montant) : null,
          excluded: isStockLine
        };
      });
      return {
        id: invId, date: inv.date_facture || null, numero_facture: inv.numero_facture || null,
        avoir: inv.avoir || null, journal: inv.journal || null,
        fournisseur: inv.fournisseur || null, chantier: inv.chantier || null,
        libelle_facture: inv.libelle_facture || null,
        montant_ht: inv.montant_ht != null ? Number(inv.montant_ht) : null,
        excluded: isStockInv, lines
      };
    });

    const updated = {
      ...data,
      total_factures: invoices.length, total_lignes: totalLignes,
      total_stock_exclu: totalStockExclu, warnings: warnings || [], invoices
    };
    fs.writeFileSync(path.join(ACHATS_DATA_DIR, `${batchId}.json`), JSON.stringify(updated));
    res.json({ success: true, total_factures: invoices.length, total_lignes: totalLignes, total_stock_exclu: totalStockExclu, warnings });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/achats/imports/:batchId', requireToken, (req, res) => {
  const { batchId } = req.params;
  const data = readAchatImportData(batchId);
  if (!data) return res.status(404).json({ success: false, error: 'Import introuvable.' });
  try {
    const dataFile = path.join(ACHATS_DATA_DIR, `${batchId}.json`);
    let pdfFile = null;
    if (data.pdf_path) {
      if (String(data.pdf_path).startsWith('local' + path.sep) || String(data.pdf_path).startsWith('local/')) {
        pdfFile = path.join(__dirname, 'achats', 'pdfs', path.basename(data.pdf_path));
      } else {
        pdfFile = path.join(ACHATS_NETWORK_PDF_DIR, data.pdf_path);
      }
    }
    if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);
    if (pdfFile && fs.existsSync(pdfFile)) fs.unlinkSync(pdfFile);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── EXCEL GOUDALLE MAÇONNERIE : CONFIG + WATCHER + AUTO-IMPORT ─────────────────

function resolveGMExcelPath(cfg) {
  let filename = cfg.filename;
  if (!/\.(xlsx|xlsm|xls)$/i.test(filename)) {
    filename += '.xlsx';
  }

  const excelPath = path.join(cfg.folder, filename);
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Fichier introuvable : "${excelPath}"`);
  }
  return { fullPath: excelPath, stat: fs.statSync(excelPath), filename };
}

// Fonction qui parse le fichier Excel et retourne les données
function parseGMExcel(cfg) {
  const resolved = resolveGMExcelPath(cfg);
  const excelPath = resolved.fullPath;
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
    // Ignorer les lignes sans m³ (semaines pré-remplies sans données de production)
    const m3Raw = row[2];
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
      objectifRatio:   toNum(row[4]),   // E : Objectif h/m³
      tempsBeton:      toNum(row[5]),   // F : Heures béton
      tempsAciers:     toNum(row[6]),   // G : Heures acier
      tempsChargement: toNum(row[7]),   // H : Heures Chargement
      tempsCentrale:   toNum(row[8]),   // I : Heures Centrale à béton
      tempsChantier:   toNum(row[9]),   // J : Heures Chantier
      qtAcierFaconne:  toNum(row[10]),  // K : Qté acier façonné (T)
      comment:         row[11] ? String(row[11]).trim() : ''  // L : Commentaire de la semaine
    });
  }
  return data;
}

function getGMExcelCached(cfg, options = {}) {
  const resolved = resolveGMExcelPath(cfg);
  return getCachedExcelRead(
    'gm_kpis',
    [resolved],
    () => parseGMExcel(cfg),
    options
  );
}

// ─── ÉCRITURE DANS L'EXCEL ───────────────────────────────────────────────────────

/**
 * Écrit ou met à jour un KPI dans l'Excel
 * @param {Object} kpi - Données du KPI (year, week, m3, hours, etc.)
 * @param {Object} cfg - Configuration Excel (folder, filename, sheet)
 */
function writeKpiToExcel(kpi, cfg) {
  const excelPath = resolveGMExcelPath(cfg).fullPath;

  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[cfg.sheet];
  if (!sheet) {
    throw new Error(`Feuille "${cfg.sheet}" introuvable. Feuilles disponibles : ${workbook.SheetNames.join(', ')}`);
  }

  // Lire toutes les lignes
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Trouver la ligne correspondante (même année et semaine)
  let targetRowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const rowYear = parseInt(rows[i][0]);
    const rowWeekRaw = String(rows[i][1] || '');
    const weekMatch = rowWeekRaw.match(/(\d+)/);
    if (weekMatch) {
      const rowWeek = parseInt(weekMatch[1]);
      if (rowYear === kpi.year && rowWeek === kpi.week) {
        targetRowIndex = i;
        break;
      }
    }
  }

  // Préparer la ligne de données (format Excel : A=Année, B=Semaine, C=m³, etc.)
  const newRow = [
    kpi.year,                                                            // A : Année
    `S${String(kpi.week).padStart(2, '0')}`,                            // B : Semaine
    kpi.m3 !== null ? kpi.m3 : null,                                    // C : m³ béton coulé
    kpi.hours !== null ? kpi.hours : null,                              // D : Heures MO
    kpi.objectifRatio !== null ? kpi.objectifRatio : null,              // E : Objectif h/m³
    kpi.tempsBeton !== null ? kpi.tempsBeton : null,                    // F : Heures béton
    kpi.tempsAciers !== null ? kpi.tempsAciers : null,                  // G : Heures acier
    kpi.tempsChargement !== null ? kpi.tempsChargement : null,          // H : Heures Chargement
    kpi.tempsCentrale !== null ? kpi.tempsCentrale : null,              // I : Heures Centrale à béton
    kpi.tempsChantier !== null ? kpi.tempsChantier : null,              // J : Heures Chantier
    kpi.qtAcierFaconne !== null ? kpi.qtAcierFaconne : null,            // K : Qté acier façonné (T)
    kpi.comment || ''                                                   // L : Commentaire de la semaine
  ];

  if (targetRowIndex >= 0) {
    // Mise à jour de la ligne existante
    rows[targetRowIndex] = newRow;
  } else {
    // Ajout d'une nouvelle ligne
    rows.push(newRow);
  }

  // Trier les lignes par ordre chronologique (ignorer la ligne d'en-tête)
  const header = rows[0];
  const dataRows = rows.slice(1).filter(row => row[0] && row[1]); // Filtrer les lignes vides
  dataRows.sort((a, b) => {
    const yearA = parseInt(a[0]) || 0;
    const yearB = parseInt(b[0]) || 0;
    if (yearA !== yearB) return yearA - yearB;
    
    const weekA = parseInt(String(a[1]).match(/(\d+)/)?.[1] || '0');
    const weekB = parseInt(String(b[1]).match(/(\d+)/)?.[1] || '0');
    return weekA - weekB;
  });

  // Reconstruire les lignes avec l'en-tête
  const sortedRows = [header, ...dataRows];

  // Recréer la feuille
  const newSheet = XLSX.utils.aoa_to_sheet(sortedRows);
  workbook.Sheets[cfg.sheet] = newSheet;

  // Sauvegarder le fichier
  XLSX.writeFile(workbook, excelPath);
  clearExcelReadCache('gm_kpis');
}

/**
 * Supprime un KPI de l'Excel
 * @param {number} year - Année
 * @param {number} week - Numéro de semaine
 * @param {Object} cfg - Configuration Excel (folder, filename, sheet)
 */
function deleteKpiFromExcel(year, week, cfg) {
  const excelPath = resolveGMExcelPath(cfg).fullPath;

  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[cfg.sheet];
  if (!sheet) {
    throw new Error(`Feuille "${cfg.sheet}" introuvable.`);
  }

  // Lire toutes les lignes
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Filtrer pour supprimer la ligne correspondante
  const header = rows[0];
  const filteredRows = [];
  
  for (let i = 1; i < rows.length; i++) {
    const rowYear = parseInt(rows[i][0]);
    const rowWeekRaw = String(rows[i][1] || '');
    const weekMatch = rowWeekRaw.match(/(\d+)/);
    
    if (weekMatch) {
      const rowWeek = parseInt(weekMatch[1]);
      // Garder toutes les lignes sauf celle à supprimer
      if (!(rowYear === year && rowWeek === week)) {
        filteredRows.push(rows[i]);
      }
    } else if (rows[i][0] || rows[i][2]) {
      // Garder les lignes non vides qui ne correspondent pas au critère
      filteredRows.push(rows[i]);
    }
  }

  // Reconstruire avec l'en-tête
  const newRows = [header, ...filteredRows];

  // Recréer la feuille
  const newSheet = XLSX.utils.aoa_to_sheet(newRows);
  workbook.Sheets[cfg.sheet] = newSheet;

  // Sauvegarder
  XLSX.writeFile(workbook, excelPath);
  clearExcelReadCache('gm_kpis');
}

// Helper : récupérer la config GM (retourne null si non configurée)
function getGMConfig() {
  let cfg = dbGet('gm_excel_config', null);
  if (!cfg || !cfg.active) {
    try {
      const backup = readExcelPathsBackup().gm;
      if (backup?.folder && backup?.filename) {
        cfg = { ...backup, active: true };
        dbSet('gm_excel_config', cfg);
      }
    } catch (_) {}
  }
  return cfg;
}

// Helper : message d'erreur lisible pour les erreurs fichier Excel
function excelErrorMessage(e) {
  if (e.code === 'EBUSY' || (e.message && e.message.includes('EBUSY'))) {
    return 'Le fichier Excel est ouvert dans Excel. Fermez Excel puis réessayez.';
  }
  if (e.code === 'ENOENT' || (e.message && e.message.includes('ENOENT'))) {
    return 'Fichier Excel introuvable. Vérifiez le chemin dans la configuration.';
  }
  return e.message;
}

// ──────────────────────────────────────────────────────────────────────────────
// NOTE : L'Excel est le seul stockage. Plus de watcher ni de JSON store pour
//        les KPIs GM. Toutes les lectures/écritures vont directement dans Excel.
// ──────────────────────────────────────────────────────────────────────────────

let gmWatcher = null; // conservé pour le DELETE /api/gm-excel-config qui le référence

// ─── ROUTES : CONFIG EXCEL GM ────────────────────────────────────────────────────

// Lire la config actuelle
app.get('/api/gm-excel-config', (req, res) => {
  res.json(dbGet('gm_excel_config', null));
});

// Sauvegarder la config Excel (l'Excel devient le stockage unique)
app.put('/api/gm-excel-config', requireToken, requireWriteRateLimit, (req, res) => {
  const { folder, filename, sheet } = req.body;
  if (!folder || !filename || !sheet) {
    return res.status(400).json({ success: false, error: 'Champs manquants : folder, filename, sheet' });
  }
  try {
    // Vérifier que le fichier est lisible et compter les lignes
    const data = parseGMExcel({ folder, filename, sheet });
    const cfg = { folder, filename, sheet, active: true, lastSync: new Date().toISOString() };
    dbSet('gm_excel_config', cfg);
    saveExcelPathBackup('gm', { folder, filename, sheet });
    clearExcelReadCache('gm_kpis');
    res.json({ success: true, result: { added: 0, updated: 0 }, rowCount: data.length });
  } catch (e) {
    res.status(500).json({ success: false, error: excelErrorMessage(e) });
  }
});

// Désynchroniser (arrêter la surveillance)
app.delete('/api/gm-excel-config', (req, res) => {
  if (gmWatcher) { clearInterval(gmWatcher); gmWatcher = null; }
  dbSet('gm_excel_config', null);
  deleteExcelPathBackup('gm');
  clearExcelReadCache('gm_kpis');
  res.json({ success: true });
});

// Vérifier la connexion à l'Excel (lecture directe)
app.post('/api/gm-import-excel', (req, res) => {
  const cfg = getGMConfig();
  if (!cfg || !cfg.active) {
    return res.status(400).json({ success: false, error: 'Aucune synchronisation configurée.' });
  }
  try {
    const data = getGMExcelCached(cfg, { forceRefresh: true });
    dbSet('gm_excel_config', { ...cfg, lastSync: new Date().toISOString() });
    res.json({ success: true, result: { added: 0, updated: 0 }, rowCount: data.length, source: cfg.filename });
  } catch (e) {
    res.status(500).json({ success: false, error: excelErrorMessage(e) });
  }
});

// ─── ROUTES : CRUD KPI MAÇONNERIE ────────────────────────────────────────────────

// Créer ou mettre à jour un KPI (écriture directe dans Excel)
app.post('/api/gm-kpi', requireToken, requireWriteRateLimit, (req, res) => {
  const { year, week, m3, hours, objectifRatio, tempsBeton, tempsAciers, tempsChargement, tempsCentrale, tempsChantier, qtAcierFaconne, comment } = req.body;

  if (!year || !week) {
    return res.status(400).json({ success: false, error: 'Année et semaine sont obligatoires.' });
  }
  if (!comment || comment.trim() === '') {
    return res.status(400).json({ success: false, error: 'Le commentaire est obligatoire.' });
  }

  const cfg = getGMConfig();
  if (!cfg || !cfg.active) {
    return res.status(400).json({ success: false, error: 'Aucun fichier Excel configuré. Veuillez connecter le fichier Excel en bas de page.' });
  }

  const kpi = {
    year: parseInt(year),
    week: parseInt(week),
    m3: m3 !== null && m3 !== '' ? parseFloat(m3) : null,
    hours: hours !== null && hours !== '' ? parseFloat(hours) : null,
    objectifRatio: objectifRatio !== null && objectifRatio !== '' ? parseFloat(objectifRatio) : null,
    tempsBeton: tempsBeton !== null && tempsBeton !== '' ? parseFloat(tempsBeton) : null,
    tempsAciers: tempsAciers !== null && tempsAciers !== '' ? parseFloat(tempsAciers) : null,
    tempsChargement: tempsChargement !== null && tempsChargement !== '' ? parseFloat(tempsChargement) : null,
    tempsCentrale: tempsCentrale !== null && tempsCentrale !== '' ? parseFloat(tempsCentrale) : null,
    tempsChantier: tempsChantier !== null && tempsChantier !== '' ? parseFloat(tempsChantier) : null,
    qtAcierFaconne: qtAcierFaconne !== null && qtAcierFaconne !== '' ? parseFloat(qtAcierFaconne) : null,
    comment: comment.trim()
  };

  try {
    // Vérifier si la semaine existe déjà dans l'Excel
    const existing = getGMExcelCached(cfg);
    const action = existing.find(k => k.year === kpi.year && k.week === kpi.week) ? 'updated' : 'created';

    // Écriture directe dans l'Excel
    writeKpiToExcel(kpi, cfg);

    res.json({ success: true, action, kpi });
  } catch (e) {
    res.status(500).json({ success: false, error: excelErrorMessage(e) });
  }
});

// Supprimer un KPI (suppression directe dans Excel)
app.delete('/api/gm-kpi/:year/:week', requireToken, requireWriteRateLimit, (req, res) => {
  const year = parseInt(req.params.year);
  const week = parseInt(req.params.week);

  if (isNaN(year) || isNaN(week)) {
    return res.status(400).json({ success: false, error: 'Année et semaine invalides.' });
  }

  const cfg = getGMConfig();
  if (!cfg || !cfg.active) {
    return res.status(400).json({ success: false, error: 'Aucun fichier Excel configuré.' });
  }

  try {
    deleteKpiFromExcel(year, week, cfg);
    res.json({ success: true, deleted: { year, week } });
  } catch (e) {
    res.status(500).json({ success: false, error: excelErrorMessage(e) });
  }
});

// Récupérer les KPIs filtrés par année et/ou mois
// Helper : calcule le mois (1-12) d'une semaine ISO
function weekToMonth(year, week) {
  const jan1 = new Date(year, 0, 1);
  const weekDate = new Date(jan1.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
  return weekDate.getMonth() + 1;
}

// Récupérer les KPIs filtrés par année et/ou mois (lecture directe Excel)
app.get('/api/gm-kpis-by-period', (req, res) => {
  const cfg = getGMConfig();
  if (!cfg || !cfg.active) {
    return res.json({ success: true, kpis: [], count: 0 });
  }

  try {
    const { year, month } = req.query;
    const forceRefresh = req.query.refresh === '1' || req.query.force === '1';
    let kpis = getGMExcelCached(cfg, { forceRefresh });

    if (year) {
      const yearNum = parseInt(year);
      if (!isNaN(yearNum)) kpis = kpis.filter(k => k.year === yearNum);
    }

    if (month) {
      const monthNum = parseInt(month);
      if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
        kpis = kpis.filter(k => weekToMonth(k.year, k.week) === monthNum);
      }
    }

    kpis.sort((a, b) => b.year !== a.year ? b.year - a.year : b.week - a.week);
    res.json({ success: true, kpis, count: kpis.length });
  } catch (e) {
    res.status(500).json({ success: false, error: excelErrorMessage(e) });
  }
});

// Récupérer les années et mois disponibles (lecture directe Excel)
app.get('/api/gm-available-periods', (req, res) => {
  const cfg = getGMConfig();
  if (!cfg || !cfg.active) {
    return res.json({ success: true, years: [], months: [] });
  }

  try {
    const { year } = req.query;
    const forceRefresh = req.query.refresh === '1' || req.query.force === '1';
    const allKpis = getGMExcelCached(cfg, { forceRefresh });

    const years = [...new Set(allKpis.map(k => k.year))].sort((a, b) => b - a);

    let filteredKpis = allKpis;
    if (year) {
      const yearNum = parseInt(year);
      if (!isNaN(yearNum)) filteredKpis = allKpis.filter(k => k.year === yearNum);
    }

    const months = [...new Set(filteredKpis.map(k => weekToMonth(k.year, k.week)))].sort((a, b) => a - b);

    res.json({ success: true, years, months });
  } catch (e) {
    res.status(500).json({ success: false, error: excelErrorMessage(e) });
  }
});

// ─── RH SÉCURITÉ : CONFIG + WATCHER + AUTO-IMPORT ───────────────────────────────

const RH_SECURITY_COMPANIES = [
  { id: 'cbco',      label: 'Concept Bois Côte d\'Opale', filename: 'CBCO_Suivi_Accidents.xlsx' },
  { id: 'charpente', label: 'Goudalle Charpente',          filename: 'GoudalleCharpente_Suivi_Accidents.xlsx' },
  { id: 'macons',    label: 'Goudalle Maçonnerie',          filename: 'GoudalleMacons_Suivi_Accidents.xlsx' },
  { id: 'sylve',     label: 'Sylve Data',                   filename: 'SylveData_Suivi_Accidents.xlsx' }
];

function parseFrDateFlexible(value, options = {}) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    }
  }
  const txt = String(value).trim();
  const m = txt.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{1,4}))?$/);
  if (!m) return null;
  let year = m[3] != null && m[3] !== ''
    ? Number(m[3])
    : Number(options.defaultYear || options.referenceDate?.getUTCFullYear?.() || 0);
  if (!year) return null;
  if (year < 100) year += 2000;
  const month = Number(m[2]) - 1;
  const day = Number(m[1]);
  const d = new Date(Date.UTC(year, month, day));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function diffDaysInclusive(startDate, endDate) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / msPerDay);
  return diff >= 0 ? diff + 1 : 0;
}

function normalizeStopText(value) {
  return String(value || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\bau(?=\d)/gi, 'au ')
    .replace(/(\d)\.(?=\s*au\b)/g, '$1')
    .trim();
}

function removeAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseStopPeriod(value, options = {}) {
  const txt = normalizeStopText(value);
  if (!txt) return { startDate: null, endDate: null, days: 0, raw: '' };

  const normalized = removeAccents(txt).toLowerCase();
  const noStopMention = /(pas\s*d?'?\s*arret|pas\s*arret|sans\s*arret)/i.test(normalized);

  const buildRange = (rawStart, rawEnd, forceExplicitStop = false) => {
    if (!rawStart || !rawEnd) return null;
    const endDate = parseFrDateFlexible(rawEnd, { defaultYear: options.sheetYear });
    if (!endDate) return null;

    let startDefaultYear = endDate.getUTCFullYear();
    const startParts = String(rawStart).trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{1,4}))?$/);
    if (startParts && !startParts[3]) {
      const startMonth = Number(startParts[2]);
      const endMonth = endDate.getUTCMonth() + 1;
      if (startMonth > endMonth) startDefaultYear -= 1;
    }

    const startDate = parseFrDateFlexible(rawStart, {
      defaultYear: startDefaultYear || options.sheetYear,
      referenceDate: endDate
    });
    if (!startDate) return null;

    return {
      startDate,
      endDate,
      days: diffDaysInclusive(startDate, endDate),
      explicitStop: forceExplicitStop
    };
  };

  const explicitRanges = [];
  const explicitRegex = /arret(?:\s+du)?[^0-9]{0,10}(\d{1,2}\/\d{1,2}(?:\/\d{1,4})?)\s*(?:au|a|jusqu'?au|jusquau)\s*(\d{1,2}\/\d{1,2}(?:\/\d{1,4})?)/gi;
  for (const match of txt.matchAll(explicitRegex)) {
    const range = buildRange(match[1], match[2], true);
    if (range) explicitRanges.push(range);
  }

  const genericRanges = [];
  const genericRegex = /(\d{1,2}\/\d{1,2}(?:\/\d{1,4})?)\s*(?:au|a|jusqu'?au|jusquau)\s*(\d{1,2}\/\d{1,2}(?:\/\d{1,4})?)/gi;
  for (const match of txt.matchAll(genericRegex)) {
    const range = buildRange(match[1], match[2], false);
    if (range) genericRanges.push(range);
  }

  let chosenRange = explicitRanges[explicitRanges.length - 1] || null;
  if (!chosenRange && !noStopMention) {
    chosenRange = genericRanges[genericRanges.length - 1] || null;
  }

  if (chosenRange) {
    const extensionMatch = txt.match(/jusqu'?au\s*(\d{1,2}\/\d{1,2}(?:\/\d{1,4})?)/i);
    if (extensionMatch) {
      const extendedEnd = parseFrDateFlexible(extensionMatch[1], {
        defaultYear: chosenRange.endDate?.getUTCFullYear?.() || options.sheetYear,
        referenceDate: chosenRange.endDate
      });
      if (extendedEnd && chosenRange.startDate && extendedEnd >= chosenRange.endDate) {
        chosenRange.endDate = extendedEnd;
        chosenRange.days = diffDaysInclusive(chosenRange.startDate, chosenRange.endDate);
      }
    }
  }

  const startDate = chosenRange?.startDate || null;
  const endDate = chosenRange?.endDate || null;
  return {
    startDate,
    endDate,
    days: chosenRange ? chosenRange.days : 0,
    raw: txt
  };
}

function normalizeExcelName(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\.(xlsx|xlsm|xls)$/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

function getFiscalYearFromMonth(year, month) {
  return month >= 10 ? year : year - 1;
}

function formatFiscalYearLabel(fiscalYear) {
  return `${fiscalYear}/${fiscalYear + 1}`;
}

function extractCommerceWeekYear(filename) {
  const basename = path.basename(String(filename || '')).replace(/\.(xlsx|xlsm|xls)$/i, '');
  const match = basename.match(/(?:^|[^a-z0-9])s\s*0?(\d{1,2})\s+(20\d{2})(?:[^a-z0-9]|$)/i)
    || basename.match(/^s\s*0?(\d{1,2})\s+(20\d{2})$/i);
  if (!match) return null;

  const week = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);
  if (!Number.isFinite(week) || week < 1 || week > 53 || !Number.isFinite(year)) {
    return null;
  }

  return {
    week,
    year,
    label: `S${String(week).padStart(2, '0')} ${year}`
  };
}

function detectLatestCommerceExcel(folderPath = COMMERCE_EXCEL_FOLDER) {
  const folder = String(folderPath || '').trim();
  if (!folder) {
    throw new Error('Dossier Commerce non configuré.');
  }
  if (!fs.existsSync(folder)) {
    throw new Error(`Dossier introuvable : "${folder}"`);
  }

  const excelFiles = fs.readdirSync(folder)
    .filter((entry) => /\.(xlsx|xlsm|xls)$/i.test(entry) && !/^~\$/.test(entry));

  const matches = excelFiles
    .map((filename) => {
      const parsed = extractCommerceWeekYear(filename);
      if (!parsed) return null;
      const fullPath = path.join(folder, filename);
      const stat = fs.statSync(fullPath);
      return { ...parsed, filename, fullPath, stat };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      if (b.week !== a.week) return b.week - a.week;
      return b.stat.mtimeMs - a.stat.mtimeMs;
    });

  if (!matches.length) {
    const available = excelFiles.length
      ? ` Fichiers Excel présents : ${excelFiles.join(', ')}`
      : ' Aucun fichier Excel présent dans le dossier.';
    throw new Error(`Aucun fichier Commerce au format "Sxx 20xx" trouvé dans "${folder}".${available}`);
  }

  return {
    folder,
    ...matches[0]
  };
}

function getCommerceMonthNumber(token) {
  const txt = normalizeText(token).replace(/\./g, '');
  if (!txt) return null;
  if (txt.startsWith('jan')) return 1;
  if (txt.startsWith('fev') || txt.startsWith('fvr') || txt.startsWith('feb')) return 2;
  if (txt.startsWith('mar')) return 3;
  if (txt.startsWith('avr') || txt.startsWith('apr')) return 4;
  if (txt.startsWith('mai') || txt.startsWith('may')) return 5;
  if (txt.startsWith('juil') || txt.startsWith('jul')) return 7;
  if (txt.startsWith('juin') || txt === 'jun') return 6;
  if (txt.startsWith('aou') || txt === 'ao' || txt.startsWith('aug')) return 8;
  if (txt.startsWith('sep')) return 9;
  if (txt.startsWith('oct')) return 10;
  if (txt.startsWith('nov')) return 11;
  if (txt.startsWith('dec')) return 12;
  return null;
}

function parseCommerceMonthCell(value) {
  if (value == null || value === '') return null;

  const asMonthInfo = (year, month, label) => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    if (year < COMMERCE_MIN_YEAR || month < 1 || month > 12) return null;
    return {
      year,
      month,
      label: label || String(value).trim()
    };
  };

  const fromDate = (date, label) => {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return asMonthInfo(d.getFullYear(), d.getMonth() + 1, label);
  };

  if (value instanceof Date) {
    return fromDate(value, value.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }));
  }

  if (typeof value === 'number' && value > 20000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m) {
      return asMonthInfo(parsed.y, parsed.m, `${String(parsed.m).padStart(2, '0')}/${String(parsed.y).slice(-2)}`);
    }
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (isoMatch) {
    return asMonthInfo(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10), raw);
  }

  const parts = normalizeText(raw).replace(/\./g, '').split(/[-/ ]+/).filter(Boolean);
  if (parts.length >= 2) {
    const yearToken = parts[parts.length - 1];
    const monthToken = parts.slice(0, -1).join('');
    const month = getCommerceMonthNumber(monthToken);
    let year = parseInt(yearToken, 10);
    if (month && Number.isFinite(year)) {
      if (year < 100) year += 2000;
      return asMonthInfo(year, month, raw);
    }
  }

  return null;
}

function findCommerceColumns(rows = []) {
  const normalizedRows = (rows || []).map((row) => (Array.isArray(row) ? row.map((cell) => normalizeText(cell)) : []));
  const headerIndex = normalizedRows.findIndex((row) => {
    return row.some((cell) => cell === 'mois')
      && row.some((cell) => cell.includes('en cours'))
      && row.some((cell) => cell.includes('termine'))
      && row.some((cell) => cell.includes('total montant estime'));
  });

  if (headerIndex < 0) {
    throw new Error('Format Commerce invalide : en-tête "Mois / Montant estimé chantiers en cours / terminés / Total Montant estimé" introuvable.');
  }

  const header = normalizedRows[headerIndex];
  const findCol = (predicate, fallback) => {
    const index = header.findIndex((cell) => predicate(String(cell || '')));
    return index >= 0 ? index : fallback;
  };

  const columns = {
    headerIndex,
    monthCol: findCol((cell) => cell === 'mois', 0),
    enCoursCol: findCol((cell) => cell.includes('en cours'), 1),
    terminesCol: findCol((cell) => cell.includes('termine'), 2),
    totalCol: findCol((cell) => cell.includes('total montant estime') && !cell.includes('cumul'), 3),
    cumulativeCol: findCol((cell) => cell.includes('cumul annuel'), 4)
  };

  return {
    ...columns,
    enCoursHeader: header[columns.enCoursCol] || '',
    terminesHeader: header[columns.terminesCol] || '',
    totalHeader: header[columns.totalCol] || '',
    cumulativeHeader: header[columns.cumulativeCol] || ''
  };
}

function parseCommerceNumeric(rawValue, displayValue) {
  const parseDisplayStyleNumber = (value) => {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    const txt = String(value).trim().replace(/\s/g, '').replace(/[^\d,.\-]/g, '');
    if (!txt) return null;

    // Le classeur affiche les kEUR avec des separateurs de milliers ("1,589 kEUR", "16.690 kEUR").
    // Quand un separateur unique ou repete decoupe l'entier par groupes de 3 chiffres, il faut
    // l'interpreter comme un separateur de milliers et non comme une decimale.
    if (/^-?\d{1,3}(?:[.,]\d{3})+$/.test(txt) || /^-?\d+[.,]\d{3}$/.test(txt)) {
      const normalized = txt.replace(/[.,]/g, '');
      const parsed = parseFloat(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (/^-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?$/.test(txt)) {
      const lastSeparator = Math.max(txt.lastIndexOf(','), txt.lastIndexOf('.'));
      const fractionalPart = lastSeparator >= 0 ? txt.slice(lastSeparator + 1) : '';
      if (fractionalPart.length === 3) {
        const normalized = txt.replace(/[.,]/g, '');
        const parsed = parseFloat(normalized);
        return Number.isFinite(parsed) ? parsed : null;
      }

      const decimalSeparator = txt.lastIndexOf(',') > txt.lastIndexOf('.') ? ',' : '.';
      const normalized = txt
        .replace(decimalSeparator === ',' ? /\./g : /,/g, '')
        .replace(decimalSeparator, '.');
      const parsed = parseFloat(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (/^-?\d+(?:,\d+)?$/.test(txt)) {
      const parsed = parseFloat(txt.replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : null;
    }

    const fallback = toNumberFr(txt);
    return fallback != null ? fallback : null;
  };

  const fromDisplay = parseDisplayStyleNumber(displayValue);
  if (fromDisplay != null) {
    return fromDisplay / 1000;
  }

  if (rawValue instanceof Date || displayValue instanceof Date) {
    return null;
  }

  const fromRaw = typeof rawValue === 'number' && Number.isFinite(rawValue)
    ? rawValue
    : parseDisplayStyleNumber(rawValue);
  return fromRaw != null ? fromRaw / 1000 : null;
}

function buildCommerceRow(rawRow, displayRow, columns) {
  const monthInfo = parseCommerceMonthCell(displayRow?.[columns.monthCol] ?? rawRow?.[columns.monthCol]);
  if (!monthInfo) return null;

  const enCours = parseCommerceNumeric(rawRow?.[columns.enCoursCol], displayRow?.[columns.enCoursCol]);
  const termines = parseCommerceNumeric(rawRow?.[columns.terminesCol], displayRow?.[columns.terminesCol]);
  const total = parseCommerceNumeric(rawRow?.[columns.totalCol], displayRow?.[columns.totalCol]);
  const cumulativeAnnual = parseCommerceNumeric(rawRow?.[columns.cumulativeCol], displayRow?.[columns.cumulativeCol]);
  const enCoursKeur = enCours ?? 0;
  const terminesKeur = termines ?? 0;
  const totalKeur = total ?? (enCoursKeur + terminesKeur);
  const fiscalYear = getFiscalYearFromMonth(monthInfo.year, monthInfo.month);
  const fiscalMonthIndex = monthInfo.month >= 10 ? monthInfo.month - 10 : monthInfo.month + 2;

  return {
    monthLabel: monthInfo.label,
    month: monthInfo.month,
    year: monthInfo.year,
    isoMonth: `${monthInfo.year}-${String(monthInfo.month).padStart(2, '0')}`,
    fiscalYear,
    fiscalYearLabel: formatFiscalYearLabel(fiscalYear),
    fiscalMonthIndex,
    enCoursKeur,
    terminesKeur,
    totalKeur,
    cumulativeAnnualKeur: cumulativeAnnual ?? null,
    hasActivity: [enCoursKeur, terminesKeur, totalKeur].some((value) => Math.abs(Number(value) || 0) > 0.0001)
  };
}

function sheetToFormattedRows(worksheet) {
  const ref = worksheet && worksheet['!ref'];
  if (!ref) return [];

  const range = XLSX.utils.decode_range(ref);
  const rows = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[address];
      if (!cell) {
        row.push(null);
        continue;
      }

      let formatted = null;
      if (cell.w != null && cell.w !== '') {
        formatted = String(cell.w);
      } else {
        try {
          const candidate = XLSX.utils.format_cell(cell);
          formatted = candidate != null && candidate !== '' ? String(candidate) : null;
        } catch {
          formatted = cell.v != null ? String(cell.v) : null;
        }
      }
      row.push(formatted);
    }
    rows.push(row);
  }

  return rows;
}

function readCommerceIndicatorsSnapshot(folderPath = COMMERCE_EXCEL_FOLDER, sourceFile = null) {
  const resolvedSourceFile = sourceFile || detectLatestCommerceExcel(folderPath);
  const workbook = XLSX.readFile(resolvedSourceFile.fullPath, { cellDates: true });
  const normalizedSheetNames = workbook.SheetNames.map((name) => normalizeText(name).replace(/\s+/g, ''));
  const requiredNewFormatSheets = ['rappels', 'encours', 'termines', 'indicateurcommercial'];
  const missingNewFormatSheets = requiredNewFormatSheets.filter((name) => !normalizedSheetNames.includes(name));
  if (missingNewFormatSheets.length) {
    const err = new Error(
      `Format Commerce non supporté pour "${resolvedSourceFile.filename}". ` +
      `Le nouveau format attendu doit contenir les feuilles : Rappels, En Cours, Terminés, Indicateur commercial.`
    );
    err.code = 'COMMERCE_UNSUPPORTED_FORMAT';
    err.sourceFile = resolvedSourceFile;
    err.availableSheets = workbook.SheetNames;
    throw err;
  }

  const targetSheetKey = normalizeText(COMMERCE_EXCEL_SHEET).replace(/\s+/g, '');
  const sheetName = workbook.SheetNames.find((name) => normalizeText(name).replace(/\s+/g, '') === targetSheetKey);
  const worksheet = workbook.Sheets[sheetName];

  if (!sheetName) {
    throw new Error(
      `Feuille "${COMMERCE_EXCEL_SHEET}" introuvable dans "${resolvedSourceFile.filename}". ` +
      `Feuilles disponibles : ${workbook.SheetNames.join(', ')}`
    );
  }

  const displayRows = sheetToFormattedRows(worksheet);
  const rawRows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: null,
    raw: true
  });
  const columns = findCommerceColumns(displayRows);
  const startIndex = columns.headerIndex >= 0 ? columns.headerIndex + 1 : 0;

  const parsedRows = displayRows
    .slice(startIndex)
    .map((row, index) => buildCommerceRow(rawRows[startIndex + index], row, columns))
    .filter(Boolean)
    .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));

  if (!parsedRows.length) {
    throw new Error(`Aucune donnée exploitable trouvée dans la feuille "${sheetName}".`);
  }

  const latestMeaningfulRow = [...parsedRows].reverse().find((row) => row.hasActivity) || parsedRows[parsedRows.length - 1];
  const activeRows = parsedRows.filter((row) => (
    row.year < latestMeaningfulRow.year ||
    (row.year === latestMeaningfulRow.year && row.month <= latestMeaningfulRow.month)
  ));
  const availableFiscalYears = [...new Set(activeRows.map((row) => row.fiscalYear))].sort((a, b) => b - a);
  const currentFiscalYear = getFiscalYearFromMonth(new Date().getFullYear(), new Date().getMonth() + 1);
  const anchorFiscalYear = availableFiscalYears.includes(currentFiscalYear)
    ? currentFiscalYear
    : (availableFiscalYears[0] ?? currentFiscalYear);
  const anchorIndex = Math.max(0, availableFiscalYears.indexOf(anchorFiscalYear));
  const defaultFiscalYears = availableFiscalYears.slice(anchorIndex, anchorIndex + 4);
  const rowsCurrentFiscalYear = activeRows.filter((row) => row.fiscalYear === currentFiscalYear);

  return {
    success: true,
    source: {
      folder: resolvedSourceFile.folder,
      fileName: resolvedSourceFile.filename,
      fullPath: resolvedSourceFile.fullPath,
      week: resolvedSourceFile.week,
      year: resolvedSourceFile.year,
      weekLabel: resolvedSourceFile.label,
      lastModified: resolvedSourceFile.stat.mtime.toISOString(),
      sizeBytes: resolvedSourceFile.stat.size,
      sheetName,
      sheetNames: workbook.SheetNames,
      detectedAt: new Date().toISOString()
    },
    summary: {
      rowCount: activeRows.length,
      totalRowCount: parsedRows.length,
      latestMonth: latestMeaningfulRow.isoMonth,
      latestMonthLabel: latestMeaningfulRow.monthLabel,
      availableFiscalYears,
      defaultFiscalYears,
      currentFiscalYear,
      currentFiscalYearLabel: formatFiscalYearLabel(currentFiscalYear),
      currentFiscalYearTotalKeur: rowsCurrentFiscalYear.reduce((sum, row) => sum + row.totalKeur, 0),
      currentFiscalYearEnCoursKeur: rowsCurrentFiscalYear.reduce((sum, row) => sum + row.enCoursKeur, 0),
      currentFiscalYearTerminesKeur: rowsCurrentFiscalYear.reduce((sum, row) => sum + row.terminesKeur, 0)
    },
    rows: activeRows,
    previewRows: activeRows.slice(-12).reverse()
  };
}

function getCommerceSourceCacheKey(sourceFile) {
  return [
    sourceFile.fullPath,
    sourceFile.stat?.mtimeMs ?? 0,
    sourceFile.stat?.size ?? 0
  ].join('|');
}

function getCommerceIndicatorsSnapshotCached({ folderPath = COMMERCE_EXCEL_FOLDER, forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && commerceIndicatorsCache.snapshot && (now - commerceIndicatorsCache.cachedAt) < COMMERCE_CACHE_TTL_MS) {
    return commerceIndicatorsCache.snapshot;
  }

  const sourceFile = detectLatestCommerceExcel(folderPath);
  const sourceKey = getCommerceSourceCacheKey(sourceFile);

  if (!forceRefresh && commerceIndicatorsCache.snapshot && commerceIndicatorsCache.sourceKey === sourceKey) {
    commerceIndicatorsCache.cachedAt = now;
    return commerceIndicatorsCache.snapshot;
  }

  const snapshot = readCommerceIndicatorsSnapshot(folderPath, sourceFile);
  commerceIndicatorsCache = {
    snapshot,
    sourceKey,
    cachedAt: now
  };
  return snapshot;
}

function commerceErrorPayload(error) {
  const payload = {
    success: false,
    error: error.message,
    sourceFolder: COMMERCE_EXCEL_FOLDER
  };

  const detected = error.sourceFile || (() => {
    try {
      return detectLatestCommerceExcel();
    } catch (_) {
      return null;
    }
  })();

  if (detected) {
    payload.detectedSource = {
      folder: detected.folder,
      fileName: detected.filename,
      fullPath: detected.fullPath,
      week: detected.week,
      year: detected.year,
      weekLabel: detected.label,
      lastModified: detected.stat?.mtime ? detected.stat.mtime.toISOString() : null,
      sizeBytes: detected.stat?.size ?? null,
      sheetNames: error.availableSheets || null
    };
  }

  if (error.code) payload.code = error.code;
  return payload;
}

// ─── APPELS D'OFFRE : FONCTIONS UTILITAIRES ──────────────────────────────────

function getAOConfig() {
  let cfg = dbGet('ao_excel_config', null);
  if (!cfg || !cfg.active) {
    try {
      const backup = readExcelPathsBackup().ao;
      if (backup?.folder && backup?.filename) {
        cfg = { ...backup, active: true };
        dbSet('ao_excel_config', cfg);
      }
    } catch (_) {}
  }
  return cfg;
}

function normalizeAOStatus(raw) {
  if (raw == null || raw === '') return 'Non renseigné';
  const txt = normalizeText(String(raw)).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!txt) return 'Non renseigné';

  if (txt === 'obtenu' || txt === 'retenu' || txt === 'r' || txt === 'o' || txt === 'oui') return 'Gagné';
  if (txt === 'rejete' || txt === 'nr' || txt === 'non retenu' || txt === 'perdu' || txt === 'annule' || txt === 'annulé' || txt === 'n') return 'Perdu';
  if (txt.startsWith('en attente') || txt === 'attente' || txt === 'ea') return 'En attente';

  return 'Non renseigné';
}

function formatAODate(date) {
  if (!date || isNaN(date.getTime())) return null;
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function parseAODate(value) {
  if (value == null || value === '') return null;

  const validYear = (d) => {
    if (!d || isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    return (y >= 2015 && y <= 2040) ? d : null;
  };

  if (value instanceof Date) {
    return validYear(value);
  }

  if (typeof value === 'number' && value > 20000 && value < 100000) {
    try {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed && parsed.y && parsed.m && parsed.d) {
        return validYear(new Date(parsed.y, parsed.m - 1, parsed.d));
      }
    } catch (_) {}
  }

  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;

    const dmyMatch = raw.match(/^(\d{1,2})[/\-.\\](\d{1,2})[/\-.\\](\d{2,4})$/);
    if (dmyMatch) {
      let year = parseInt(dmyMatch[3], 10);
      if (year < 100) year += 2000;
      return validYear(new Date(year, parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10)));
    }

    return validYear(new Date(raw));
  }

  return null;
}

function findAOColumns(rawRows) {
  const normalized = rawRows.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) =>
      normalizeText(String(cell || '')).toLowerCase().replace(/\s+/g, ' ').trim()
    )
  );

  let headerIndex = 0;
  for (let i = 0; i < Math.min(normalized.length, 10); i++) {
    const row = normalized[i];
    const hasNomOrDossier = row.some((c) => c.includes('nom') || c.includes('dossier') || c.includes('affaire'));
    const hasDateOrStatut = row.some((c) =>
      c.includes('reponse') || c.includes('obtenu') || c.includes('rejete') || c.includes('statut') || c.includes('attente')
    );
    if (hasNomOrDossier || hasDateOrStatut) {
      headerIndex = i;
      break;
    }
  }

  const header = normalized[headerIndex] || [];

  const findCol = (predicates, fallback) => {
    for (const pred of predicates) {
      const idx = header.findIndex((c) => pred(c));
      if (idx >= 0) return idx;
    }
    return fallback;
  };

  return {
    headerIndex,
    dateEntreeCol: findCol(
      [(c) => c.includes('date') && (c.includes('entree') || c.includes('entrée'))],
      0
    ),
    nomCol: findCol(
      [(c) => c.includes('dossier') || c.includes('affaire'), (c) => c === 'nom'],
      1
    ),
    clientCol: findCol([(c) => c === 'client' || c.startsWith('client')], 1),
    typeCol: findCol([(c) => c.includes('type') && c.includes('principal')], -1),
    dateButoirCol: findCol([(c) => c.includes('butoir') || (c.includes('date') && c.includes('v1'))], -1),
    dateReponseCol: findCol(
      [(c) => c.includes('resultat') || c.includes('résultat') || c.includes('reponse') || (c.includes('date') && c.includes('rep'))],
      -1
    ),
    responsableCol: findCol([(c) => c.includes('responsable') || c.includes('etude')], -1),
    actionCol: findCol([(c) => c === 'action' || c.includes('action requise')], -1),
    derniereActionCol: findCol([(c) => c.includes('derniere action') || c.includes('dernière action')], -1),
    remarquesCol: findCol([(c) => c.includes('remarque')], -1),
    statutCol: findCol(
      [(c) => c.includes('obtenu') || c.includes('rejete') || c.includes('statut'), (c) => c.includes('attente')],
      -1
    ),
    dateInfoCol: findCol(
      [(c) => (c.includes('date') && c.includes('info')) || c === "date d'info"],
      -1
    ),
    classementCol: findCol([(c) => c.includes('classement')], -1),
    montantCol: findCol(
      [(c) => c.includes('montant') || c.includes('estimatif') || c.includes('budget') || c === 'devis' || c.includes('devis')],
      -1
    ),
    versionCols: header
      .map((c, idx) => (/^v\d+$/i.test(c) ? idx : -1))
      .filter((idx) => idx >= 0),
    questionCols: header
      .map((c, idx) => (/^q\d+$/i.test(c) ? idx : -1))
      .filter((idx) => idx >= 0),
    negoCols: header
      .map((c, idx) => (/^rn\d+$/i.test(c) ? idx : -1))
      .filter((idx) => idx >= 0)
  };
}

function topAOBuckets(records, key, limit = 6) {
  const buckets = new Map();
  for (const record of records) {
    const label = String(record[key] || 'Non renseigné').trim() || 'Non renseigné';
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  return [...buckets.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'))
    .slice(0, limit);
}

function buildAOSummary(records, reliable, invalidDates) {
  const statusCounts = { 'Gagné': 0, 'Perdu': 0, 'En attente': 0, 'Non renseigné': 0 };
  let totalAmount = 0;
  let wonAmount = 0;
  let amountCount = 0;
  let actionRequiredCount = 0;
  let pendingCount = 0;

  for (const record of reliable) {
    statusCounts[record.status] = (statusCounts[record.status] || 0) + 1;
    if (record.montant != null) {
      totalAmount += record.montant;
      amountCount += 1;
      if (record.status === 'Gagné') wonAmount += record.montant;
    }
    if (normalizeText(record.action).toLowerCase().includes('action requise')) actionRequiredCount += 1;
    if (record.status === 'En attente') pendingCount += 1;
  }

  const decided = (statusCounts['Gagné'] || 0) + (statusCounts['Perdu'] || 0);
  const allYears = [...new Set(reliable.map((r) => r.year).filter(Boolean))].sort((a, b) => b - a);
  const allFiscalYears = [...new Set(reliable.map((r) => r.fiscalYear).filter(Boolean))].sort((a, b) => b - a);
  const allMonths = [...new Set(reliable.map((r) => r.isoMonth).filter(Boolean))].sort().reverse();

  return {
    totalRows: records.length,
    reliableRows: reliable.length,
    minReliableDate: AO_MIN_DATE,
    dateField: 'Date d\'entrée',
    periodStart: allMonths.length ? allMonths[allMonths.length - 1] : null,
    periodEnd: allMonths.length ? allMonths[0] : null,
    availableYears: allYears,
    availableFiscalYears: allFiscalYears,
    availableMonths: allMonths,
    invalidDateCount: invalidDates.length,
    statusCounts,
    wonRate: decided > 0 ? ((statusCounts['Gagné'] || 0) / decided) * 100 : null,
    decidedCount: decided,
    pendingCount,
    actionRequiredCount,
    amountCount,
    totalAmount,
    wonAmount,
    topResponsables: topAOBuckets(reliable, 'responsable'),
    topTypes: topAOBuckets(reliable, 'typePrincipal')
  };
}

function readAOSnapshot(cfg) {
  const resolved = resolveExistingExcelPath(cfg.folder, cfg.filename);
  const stat = fs.statSync(resolved.fullPath);
  const workbook = XLSX.readFile(resolved.fullPath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null, raw: true });
  const cols = findAOColumns(rawRows);
  const minDate = new Date(AO_MIN_DATE);
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + AO_MAX_FUTURE_YEARS);

  const dataRows = rawRows.slice(cols.headerIndex + 1);
  const records = [];
  const invalidDates = [];

  for (const row of dataRows) {
    if (!row || row.every((c) => c == null || c === '')) continue;
    const nom = row[cols.nomCol];
    if (!nom || String(nom).trim() === '') continue;

    const statusRaw = cols.statutCol >= 0 ? row[cols.statutCol] : null;
    const status = normalizeAOStatus(statusRaw);

    // Le nouveau tableau pilote les périodes avec la date d'entrée. La date
    // résultat reste disponible pour analyser les affaires tranchées.
    const rawEntreeCell = cols.dateEntreeCol >= 0 ? row[cols.dateEntreeCol] : null;
    const rawButoirCell = cols.dateButoirCol >= 0 ? row[cols.dateButoirCol] : null;
    const rawReponseCell = cols.dateReponseCol >= 0 ? row[cols.dateReponseCol] : null;
    const dateEntree = parseAODate(rawEntreeCell);
    const dateButoirV1 = parseAODate(rawButoirCell);
    const dateResultat = parseAODate(rawReponseCell);

    if (rawEntreeCell != null && rawEntreeCell !== '' && !dateEntree) {
      invalidDates.push({ nom: String(nom).trim(), colonne: 'Date d\'entrée', valeurBrute: String(rawEntreeCell) });
    }

    const effectiveDate = dateEntree || dateButoirV1 || dateResultat || null;
    if (effectiveDate && effectiveDate > maxDate) {
      invalidDates.push({
        nom: String(nom).trim(),
        colonne: 'Date d\'entrée',
        valeurBrute: formatAODate(effectiveDate),
        raison: 'Date trop future'
      });
    }

    const montantRaw = cols.montantCol >= 0 ? row[cols.montantCol] : null;
    let montant = null;
    if (typeof montantRaw === 'number' && isFinite(montantRaw)) {
      montant = montantRaw;
    } else if (montantRaw != null && montantRaw !== '') {
      const parsed = parseFloat(String(montantRaw).replace(/[^\d.,\-]/g, '').replace(',', '.'));
      if (isFinite(parsed)) montant = parsed;
    }

    const isReliable = effectiveDate != null && effectiveDate >= minDate && effectiveDate <= maxDate;
    const fiscalYear = effectiveDate
      ? ((effectiveDate.getMonth() + 1) >= 10 ? effectiveDate.getFullYear() : effectiveDate.getFullYear() - 1)
      : null;

    records.push({
      nom: String(nom).trim(),
      client: cols.clientCol >= 0 ? String(row[cols.clientCol] || '').trim() : '',
      typePrincipal: cols.typeCol >= 0 ? String(row[cols.typeCol] || '').trim() : '',
      responsable: cols.responsableCol >= 0 ? String(row[cols.responsableCol] || '').trim() : '',
      action: cols.actionCol >= 0 ? String(row[cols.actionCol] || '').trim() : '',
      derniereAction: cols.derniereActionCol >= 0 ? formatAODate(parseAODate(row[cols.derniereActionCol])) : null,
      remarques: cols.remarquesCol >= 0 ? String(row[cols.remarquesCol] || '').trim() : '',
      statusRaw: statusRaw != null ? String(statusRaw).trim() : '',
      status,
      dateEntree: formatAODate(dateEntree),
      dateButoirV1: formatAODate(dateButoirV1),
      dateResultat: formatAODate(dateResultat),
      dateReponse: formatAODate(dateResultat),
      effectiveDate: formatAODate(effectiveDate),
      year: effectiveDate ? effectiveDate.getFullYear() : null,
      month: effectiveDate ? effectiveDate.getMonth() + 1 : null,
      isoMonth: effectiveDate ? formatAODate(effectiveDate).slice(0, 7) : null,
      fiscalYear,
      montant,
      versionCount: cols.versionCols.filter((idx) => row[idx] != null && row[idx] !== '').length,
      questionCount: cols.questionCols.filter((idx) => row[idx] != null && row[idx] !== '').length,
      negotiationCount: cols.negoCols.filter((idx) => row[idx] != null && row[idx] !== '').length,
      isReliable
    });
  }

  const reliable = records.filter((r) => r.isReliable);

  return {
    success: true,
    source: {
      folder: cfg.folder,
      fileName: resolved.resolvedFilename,
      fullPath: resolved.fullPath,
      lastModified: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      sheetName,
      sheetNames: workbook.SheetNames,
      detectedAt: new Date().toISOString()
    },
    summary: buildAOSummary(records, reliable, invalidDates),
    records: reliable,
    invalidDates
  };
}

function getAOSnapshotCached({ forceRefresh = false } = {}) {
  const cfg = getAOConfig();
  if (!cfg || !cfg.active) {
    throw new Error('Aucun fichier Appels d\'offre configuré. Veuillez configurer la liaison depuis la page Liaison Excel.');
  }

  const now = Date.now();
  if (!forceRefresh && aoCache.snapshot && (now - aoCache.cachedAt) < AO_CACHE_TTL_MS) {
    return aoCache.snapshot;
  }

  const resolved = resolveExistingExcelPath(cfg.folder, cfg.filename);
  const stat = fs.statSync(resolved.fullPath);
  const sourceKey = [resolved.fullPath, stat.mtimeMs, stat.size].join('|');

  if (!forceRefresh && aoCache.snapshot && aoCache.sourceKey === sourceKey) {
    aoCache.cachedAt = now;
    return aoCache.snapshot;
  }

  const snapshot = readAOSnapshot(cfg);
  aoCache = { snapshot, sourceKey, cachedAt: now };
  return snapshot;
}

function parseRHSaisieWorkbook(company, folderPath) {
  const resolved = resolveExistingExcelPath(folderPath, company.filename);
  const excelPath = resolved.fullPath;

  const workbook = XLSX.readFile(excelPath, { cellDates: true });
  const ws = workbook.Sheets['Saisie'];
  if (!ws) return [];

  // Lignes 4-503 (index 3-502), 18 colonnes A-R
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    range: 3,
    defval: null
  });

  const incidents = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const nom = row[1] != null ? String(row[1]).trim() : '';
    if (!nom) break; // col B vide = fin des données

    const accidentDate = parseFrDateFlexible(row[4]);
    const debutArret = parseFrDateFlexible(row[9]);
    const finArret = parseFrDateFlexible(row[10]);
    const prolongation = parseFrDateFlexible(row[11]);

    // Jours d'arrêt : lire la valeur calculée (col M), sinon recalculer
    let stopDays = (typeof row[12] === 'number' && row[12] >= 0) ? row[12] : 0;
    let stopStartDate = null;
    let stopEndDate = null;
    if (debutArret) {
      stopStartDate = debutArret;
      const effectiveEnd = prolongation || finArret;
      if (effectiveEnd) {
        if (!stopDays) stopDays = diffDaysInclusive(debutArret, effectiveEnd);
        stopEndDate = effectiveEnd;
      }
    }

    const prenom = row[2] != null ? String(row[2]).trim() : '';
    incidents.push({
      id: `rhsec_${company.id}_${4 + i}`,
      companyId: company.id,
      companyLabel: company.label,
      employeeName: `${nom}${prenom ? ' ' + prenom : ''}`,
      nom,
      prenom,
      statut: row[3] != null ? String(row[3]).trim() : null,
      accidentDate: formatIsoDate(accidentDate),
      accidentYear: accidentDate ? accidentDate.getUTCFullYear() : null,
      type: row[5] != null ? String(row[5]).trim() : null,
      gravite: row[6] != null ? String(row[6]).trim() : null,
      cause: row[7] != null ? String(row[7]).trim() : null,
      description: row[8] != null ? String(row[8]).trim() : null,
      stopStartDate: formatIsoDate(stopStartDate),
      stopEndDate: formatIsoDate(stopEndDate),
      stopDays: Number(stopDays) || 0,
      debutArret: formatIsoDate(debutArret),
      finArret: formatIsoDate(finArret),
      prolongation: formatIsoDate(prolongation),
      soins: row[13] != null ? String(row[13]).trim() : null,
      debutSoins: formatIsoDate(parseFrDateFlexible(row[14])),
      finSoins: formatIsoDate(parseFrDateFlexible(row[15])),
      siege: row[16] != null ? String(row[16]).trim() : null,
      nature: row[17] != null ? String(row[17]).trim() : null,
      sourceFile: resolved.resolvedFilename,
      sourceRow: 4 + i
    });
  }

  return incidents;
}

function parseRHSecurityExcels(cfg) {
  const allIncidents = [];
  for (const company of RH_SECURITY_COMPANIES) {
    const fileInfo = cfg?.files?.[company.id];
    const folder = fileInfo?.folder || '';
    const filename = fileInfo?.filename || '';
    if (!folder || !filename) continue;
    try {
      allIncidents.push(...parseRHSaisieWorkbook({ ...company, filename }, folder));
    } catch (e) {
      console.warn(`[RH-Securite] Erreur lecture ${company.id} (${filename}) : ${e.message}`);
    }
  }
  allIncidents.sort((a, b) => String(b.accidentDate || '').localeCompare(String(a.accidentDate || '')));
  return allIncidents;
}

function getRHSecuritySourceFiles(cfg) {
  const sources = [];
  for (const company of RH_SECURITY_COMPANIES) {
    const fileInfo = cfg?.files?.[company.id];
    const folder = fileInfo?.folder || '';
    const filename = fileInfo?.filename || '';
    if (!folder || !filename) continue;
    try {
      const resolved = resolveExistingExcelPath(folder, filename);
      sources.push({ fullPath: resolved.fullPath, stat: fs.statSync(resolved.fullPath) });
    } catch (_) {}
  }
  return sources;
}

function getRHSecurityIncidentsCached(cfg, options = {}) {
  const sources = getRHSecuritySourceFiles(cfg);
  if (!sources.length) return parseRHSecurityExcels(cfg);
  return getCachedExcelRead(
    'rh_security_incidents',
    sources,
    () => parseRHSecurityExcels(cfg),
    options
  );
}

const EXCEL_PATHS_BACKUP_PATH = path.join(__dirname, 'data', 'excel-paths.json');

function readExcelPathsBackup() {
  try {
    if (fs.existsSync(EXCEL_PATHS_BACKUP_PATH)) {
      return JSON.parse(fs.readFileSync(EXCEL_PATHS_BACKUP_PATH, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveExcelPathBackup(key, pathData) {
  try {
    const all = readExcelPathsBackup();
    all[key] = pathData;
    fs.writeFileSync(EXCEL_PATHS_BACKUP_PATH, JSON.stringify(all, null, 2), 'utf8');
  } catch (_) {}
}

function deleteExcelPathBackup(key) {
  try {
    const all = readExcelPathsBackup();
    delete all[key];
    fs.writeFileSync(EXCEL_PATHS_BACKUP_PATH, JSON.stringify(all, null, 2), 'utf8');
  } catch (_) {}
}

const RH_FOLDER_BACKUP_PATH = path.join(__dirname, 'data', 'rh-folder.txt');

function saveRHFilesBackup(files) {
  saveExcelPathBackup('rh_security', files);
}

function deleteRHFilesBackup() {
  deleteExcelPathBackup('rh_security');
}

function getRHSecurityConfig() {
  let cfg = dbGet('rh_security_excel_config', null);
  // Migrate old format (dossier unique → par fichier)
  if (cfg && cfg.active && cfg.folder && !cfg.files) {
    const files = {};
    for (const company of RH_SECURITY_COMPANIES) {
      files[company.id] = { folder: cfg.folder, filename: company.filename };
    }
    cfg = { active: true, files };
    dbSet('rh_security_excel_config', cfg);
    saveRHFilesBackup(files);
  }
  if (!cfg || !cfg.active) {
    try {
      const backup = readExcelPathsBackup()['rh_security'] || null;
      if (backup) {
        cfg = { active: true, files: backup };
        dbSet('rh_security_excel_config', cfg);
        console.log(`[RH Sécurité] Config restaurée depuis excel-paths.json`);
      }
    } catch (_) {}
  }
  if (!cfg || !cfg.active) {
    // Compatibilité legacy rh-folder.txt
    try {
      if (fs.existsSync(RH_FOLDER_BACKUP_PATH)) {
        const folder = fs.readFileSync(RH_FOLDER_BACKUP_PATH, 'utf8').trim();
        if (folder) {
          const files = {};
          for (const company of RH_SECURITY_COMPANIES) {
            files[company.id] = { folder, filename: company.filename };
          }
          cfg = { active: true, files };
          dbSet('rh_security_excel_config', cfg);
          saveRHFilesBackup(files);
        }
      }
    } catch (_) {}
  }
  return cfg;
}

function readRHSecurityIncidentsFromExcel() {
  const cfg = getRHSecurityConfig();
  if (!cfg || !cfg.active) return [];
  return getRHSecurityIncidentsCached(cfg);
}

function buildRHSecurityReadResult(incidents) {
  return { read: incidents.length, companies: RH_SECURITY_COMPANIES.length };
}

const RH_SECURITY_START_DATE = '2019-10-01';

function computeRHSecuritySummary(incidents = []) {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const summarize = (list, label, id = 'group') => {
    const filtered = list.filter((item) => item.accidentDate && item.accidentDate >= RH_SECURITY_START_DATE);
    const sorted = [...filtered].sort((a, b) => String(b.accidentDate || '').localeCompare(String(a.accidentDate || '')));
    const latest = sorted[0] || null;
    const latestDate = latest?.accidentDate ? new Date(`${latest.accidentDate}T00:00:00Z`) : null;
    const rawDaysSince = latestDate ? Math.floor((todayUtc.getTime() - latestDate.getTime()) / (24 * 60 * 60 * 1000)) : null;
    const daysSince = rawDaysSince == null ? null : Math.max(0, rawDaysSince);
    const ongoing = sorted.filter((item) => {
      if (!item.stopStartDate || !item.stopEndDate) return false;
      const start = new Date(`${item.stopStartDate}T00:00:00Z`);
      const end = new Date(`${item.stopEndDate}T00:00:00Z`);
      return start <= todayUtc && end >= todayUtc;
    }).length;
    const currentYear = todayUtc.getUTCFullYear();
    const accidentsCurrentYear = sorted.filter((item) => {
      if (!item.accidentDate) return false;
      return Number(String(item.accidentDate).slice(0, 4)) === currentYear;
    }).length;
    const accidentDatesAsc = sorted
      .map((item) => item.accidentDate)
      .filter(Boolean)
      .sort();
    let recordJoursSansAccident = 0;
    let recordFrom = null;
    let recordTo = null;
    for (let i = 1; i < accidentDatesAsc.length; i++) {
      const t1 = new Date(`${accidentDatesAsc[i - 1]}T00:00:00Z`).getTime();
      const t2 = new Date(`${accidentDatesAsc[i]}T00:00:00Z`).getTime();
      const gap = Math.floor((t2 - t1) / (24 * 60 * 60 * 1000));
      if (gap > recordJoursSansAccident) {
        recordJoursSansAccident = gap;
        recordFrom = accidentDatesAsc[i - 1];
        recordTo = accidentDatesAsc[i];
      }
    }
    const parCause = {};
    const parGravite = {};
    const parType = {};
    sorted.forEach((item) => {
      if (item.cause) parCause[item.cause] = (parCause[item.cause] || 0) + 1;
      if (item.gravite) parGravite[item.gravite] = (parGravite[item.gravite] || 0) + 1;
      if (item.type) parType[item.type] = (parType[item.type] || 0) + 1;
    });
    return {
      id,
      label,
      totalAccidents: sorted.length,
      accidentsCurrentYear,
      recordJoursSansAccident,
      recordFrom,
      recordTo,
      accidentsAvecArret: sorted.filter((item) => item.gravite === 'Avec arrêt' || Number(item.stopDays || 0) > 0).length,
      joursArret: sorted.reduce((sum, item) => sum + Number(item.stopDays || 0), 0),
      joursSansAccident: daysSince,
      hasFutureAccidentDate: rawDaysSince != null && rawDaysSince < 0,
      dernierAccidentDate: latest?.accidentDate || null,
      dernierAccidentNom: latest?.employeeName || null,
      accidentsEnCours: ongoing,
      incidentsRecents: sorted.slice(0, 5),
      parCause,
      parGravite,
      parType
    };
  };

  return {
    group: summarize(incidents, 'Groupe Goudalle'),
    companies: RH_SECURITY_COMPANIES.map((company) => summarize(
      incidents.filter((incident) => incident.companyId === company.id),
      company.label,
      company.id
    ))
  };
}

let rhSecurityWatcher = null; // Conservé pour compatibilité avec les anciennes routes.

async function writeAccidentToExcel(cfg, companyId, data) {
  const company = RH_SECURITY_COMPANIES.find((c) => c.id === companyId);
  if (!company) throw new Error(`Entreprise inconnue : ${companyId}`);

  const fileInfo = cfg?.files?.[companyId];
  if (!fileInfo?.folder || !fileInfo?.filename) throw new Error(`Fichier non configuré pour ${companyId}.`);
  const resolved = resolveExistingExcelPath(fileInfo.folder, fileInfo.filename);
  const excelPath = resolved.fullPath;

  // xlsx-populate préserve la mise en forme, les couleurs et les tableaux Excel
  const workbook = await XlsxPopulate.fromFileAsync(excelPath);
  const sheet = workbook.sheet('Saisie');
  if (!sheet) throw new Error('Feuille "Saisie" introuvable dans ' + fileInfo.filename);

  // Trouver la prochaine ligne vide (col B = colonne 2) à partir de la ligne 4
  let nextRow = 4;
  for (let r = 4; r <= 503; r++) {
    const val = sheet.cell(r, 2).value();
    if (val == null || String(val).trim() === '') { nextRow = r; break; }
  }

  // N° auto
  let nextNum = 1;
  if (nextRow > 4) {
    const prevNum = sheet.cell(nextRow - 1, 1).value();
    if (typeof prevNum === 'number') nextNum = prevNum + 1;
  }

  // Calcul jours d'arrêt
  let joursArret = 0;
  if (data.debutArret) {
    const start = new Date(data.debutArret + 'T00:00:00Z');
    const endStr = data.prolongation || data.finArret;
    if (endStr) {
      const end = new Date(endStr + 'T00:00:00Z');
      joursArret = Math.max(0, Math.floor((end - start) / 86400000) + 1);
    }
  }

  const setV = (col, val) => { if (val != null && val !== '') sheet.cell(nextRow, col).value(val); };
  const setD = (col, isoStr) => {
    if (!isoStr) return;
    const d = new Date(isoStr + 'T00:00:00Z');
    if (!isNaN(d.getTime())) sheet.cell(nextRow, col).value(d);
  };

  setV(1,  nextNum);
  setV(2,  String(data.nom || '').toUpperCase());
  setV(3,  data.prenom);
  setV(4,  data.statut);
  setD(5,  data.dateAccident);
  setV(6,  data.type);
  setV(7,  data.gravite);
  setV(8,  data.cause);
  setV(9,  data.description);
  setD(10, data.debutArret);
  setD(11, data.finArret);
  setD(12, data.prolongation);
  setV(13, joursArret);
  setV(14, data.soins);
  setD(15, data.debutSoins);
  setD(16, data.finSoins);
  setV(17, data.siege);
  setV(18, data.nature);

  await workbook.toFileAsync(excelPath);
  return { row: nextRow, num: nextNum };
}

async function updateAccidentInExcel(cfg, companyId, rowIndex, data) {
  const company = RH_SECURITY_COMPANIES.find((c) => c.id === companyId);
  if (!company) throw new Error(`Entreprise inconnue : ${companyId}`);

  const fileInfo = cfg?.files?.[companyId];
  if (!fileInfo?.folder || !fileInfo?.filename) throw new Error(`Fichier non configuré pour ${companyId}.`);
  const resolved = resolveExistingExcelPath(fileInfo.folder, fileInfo.filename);
  const excelPath = resolved.fullPath;

  const workbook = await XlsxPopulate.fromFileAsync(excelPath);
  const sheet = workbook.sheet('Saisie');
  if (!sheet) throw new Error('Feuille "Saisie" introuvable dans ' + fileInfo.filename);

  // Vérifier que la ligne cible n'est pas vide (sécurité)
  const nomCell = sheet.cell(rowIndex, 2).value();
  if (nomCell == null || String(nomCell).trim() === '') {
    throw new Error(`Ligne ${rowIndex} introuvable ou vide dans ${company.filename}`);
  }

  let joursArret = 0;
  if (data.debutArret) {
    const start = new Date(data.debutArret + 'T00:00:00Z');
    const endStr = data.prolongation || data.finArret;
    if (endStr) {
      const end = new Date(endStr + 'T00:00:00Z');
      joursArret = Math.max(0, Math.floor((end - start) / 86400000) + 1);
    }
  }

  const setV = (col, val) => { sheet.cell(rowIndex, col).value(val != null && val !== '' ? val : null); };
  const setD = (col, isoStr) => {
    if (!isoStr) { sheet.cell(rowIndex, col).value(null); return; }
    const d = new Date(isoStr + 'T00:00:00Z');
    if (!isNaN(d.getTime())) sheet.cell(rowIndex, col).value(d);
    else sheet.cell(rowIndex, col).value(null);
  };

  // Col 1 (N°) non modifié
  setV(2,  String(data.nom || '').toUpperCase());
  setV(3,  data.prenom || null);
  setV(4,  data.statut || null);
  setD(5,  data.dateAccident);
  setV(6,  data.type || null);
  setV(7,  data.gravite || null);
  setV(8,  data.cause || null);
  setV(9,  data.description || null);
  setD(10, data.debutArret || null);
  setD(11, data.finArret || null);
  setD(12, data.prolongation || null);
  setV(13, joursArret || 0);
  setV(14, data.soins || null);
  setD(15, data.debutSoins || null);
  setD(16, data.finSoins || null);
  setV(17, data.siege || null);
  setV(18, data.nature || null);

  await workbook.toFileAsync(excelPath);
}

// ─── RECHERCHE ACCIDENT (fuzzy, léger, depuis les fichiers Excel) ────────────

app.get('/api/rh-security-search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) return res.json([]);

    const normalize = (s) =>
      String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    const terms = normalize(q).split(/\s+/).filter(Boolean);
    const incidents = readRHSecurityIncidentsFromExcel();

    const matches = incidents.filter((inc) => {
      const nom = normalize(inc.nom);
      const prenom = normalize(inc.prenom);
      const full1 = `${nom} ${prenom}`;
      const full2 = `${prenom} ${nom}`;
      return terms.every((t) => full1.includes(t) || full2.includes(t) || nom.includes(t) || prenom.includes(t));
    });

    res.json(matches.slice(0, 30).map((inc) => ({
      id: inc.id,
      employeeName: inc.employeeName,
      accidentDate: inc.accidentDate,
      companyLabel: inc.companyLabel,
      companyId: inc.companyId,
      gravite: inc.gravite,
      cause: inc.cause,
    })));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── DÉTAIL D'UN ACCIDENT (chargement lazy au clic) ─────────────────────────

app.get('/api/rh-security-incident/:id', (req, res) => {
  try {
    const incidents = readRHSecurityIncidentsFromExcel();
    const inc = incidents.find((i) => i.id === req.params.id);
    if (!inc) return res.status(404).json({ success: false, error: 'Accident introuvable.' });
    res.json(inc);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── MODIFICATION D'UN ACCIDENT ───────────────────────────────────────────────

app.put('/api/rh-security-update-accident', requireToken, requireWriteRateLimit, async (req, res) => {
  const cfg = getRHSecurityConfig();
  if (!cfg || !cfg.active) {
    return res.status(400).json({ success: false, error: "Aucun dossier Excel configuré." });
  }
  const { id, ...data } = req.body || {};
  if (!id) return res.status(400).json({ success: false, error: 'Champ id manquant.' });

  // id format : rhsec_<companyId>_<rowIndex>
  const match = id.match(/^rhsec_(.+)_(\d+)$/);
  if (!match) return res.status(400).json({ success: false, error: 'ID invalide.' });
  const companyId = match[1];
  const rowIndex = parseInt(match[2], 10);

  try {
    await updateAccidentInExcel(cfg, companyId, rowIndex, data);
    clearExcelReadCache('rh_security_incidents');
    const incidents = getRHSecurityIncidentsCached(cfg, { forceRefresh: true });
    res.json({ success: true, incidentCount: incidents.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/rh-security-excel-config', (req, res) => {
  res.json(getRHSecurityConfig());
});

app.put('/api/rh-security-excel-config', requireToken, requireWriteRateLimit, (req, res) => {
  const filesInput = req.body?.files || {};
  const files = {};
  for (const company of RH_SECURITY_COMPANIES) {
    const folder = String(filesInput[company.id]?.folder || '').trim();
    const filename = String(filesInput[company.id]?.filename || '').trim();
    if (folder && filename) files[company.id] = { folder, filename };
  }
  if (!Object.keys(files).length) {
    return res.status(400).json({ success: false, error: 'Aucun fichier configuré. Veuillez renseigner au moins un chemin et un nom de fichier.' });
  }
  try {
    const cfg = { active: true, files };
    const incidents = parseRHSecurityExcels(cfg);
    const result = buildRHSecurityReadResult(incidents);
    dbSet('rh_security_excel_config', cfg);
    saveRHFilesBackup(files);
    clearExcelReadCache('rh_security_incidents');
    res.json({ success: true, result, incidentCount: incidents.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/rh-security-add-accident', requireToken, requireWriteRateLimit, async (req, res) => {
  const cfg = getRHSecurityConfig();
  if (!cfg || !cfg.active) {
    return res.status(400).json({ success: false, error: "Aucun dossier Excel configure. Connecter d'abord le dossier depuis la page RH admin." });
  }
  const { companyId, nom, dateAccident, gravite } = req.body || {};
  if (!companyId || !nom || !dateAccident || !gravite) {
    return res.status(400).json({ success: false, error: 'Champs obligatoires manquants : companyId, nom, dateAccident, gravite.' });
  }
  try {
    const writeResult = await writeAccidentToExcel(cfg, companyId, req.body);
    clearExcelReadCache('rh_security_incidents');
    const incidents = getRHSecurityIncidentsCached(cfg, { forceRefresh: true });
    res.json({ success: true, ...writeResult, incidentCount: incidents.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/rh-security-excel-config', requireToken, (req, res) => {
  if (rhSecurityWatcher) {
    clearInterval(rhSecurityWatcher);
    rhSecurityWatcher = null;
  }
  dbSet('rh_security_excel_config', null);
  deleteRHFilesBackup();
  clearExcelReadCache('rh_security_incidents');
  res.json({ success: true });
});

app.post('/api/rh-security-import-excel', (req, res) => {
  const cfg = getRHSecurityConfig();
  if (!cfg || !cfg.active) {
    return res.status(400).json({ success: false, error: 'Aucun dossier Excel configuré.' });
  }
  try {
    const incidents = getRHSecurityIncidentsCached(cfg, { forceRefresh: true });
    const result = buildRHSecurityReadResult(incidents);
    res.json({ success: true, result, incidentCount: incidents.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/rh-security-incidents', (req, res) => {
  try {
    res.json(readRHSecurityIncidentsFromExcel());
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/rh-security-summary', (req, res) => {
  try {
    const incidents = readRHSecurityIncidentsFromExcel();
    res.json({ success: true, ...computeRHSecuritySummary(incidents) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── COMMERCE : LECTURE DYNAMIQUE DU DERNIER EXCEL ───────────────────────────

app.get('/api/commerce-indicators', (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.force === '1';
    const snapshot = getCommerceIndicatorsSnapshotCached({ forceRefresh });
    res.json(snapshot);
  } catch (e) {
    res.status(e.code === 'COMMERCE_UNSUPPORTED_FORMAT' ? 422 : 500).json(commerceErrorPayload(e));
  }
});

app.get('/api/commerce-link-status', (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.force === '1';
    const snapshot = getCommerceIndicatorsSnapshotCached({ forceRefresh });
    res.json({
      success: true,
      source: snapshot.source,
      summary: snapshot.summary,
      previewRows: snapshot.previewRows
    });
  } catch (e) {
    res.status(e.code === 'COMMERCE_UNSUPPORTED_FORMAT' ? 422 : 500).json(commerceErrorPayload(e));
  }
});


// ─── APPELS D'OFFRE : CONFIG + LECTURE DYNAMIQUE EXCEL ───────────────────────

app.get('/api/ao-excel-config', (req, res) => {
  res.json(getAOConfig());
});

app.put('/api/ao-excel-config', requireToken, requireWriteRateLimit, (req, res) => {
  const { folder, filename } = req.body;
  if (!folder || !filename) {
    return res.status(400).json({ success: false, error: 'Champs manquants : folder, filename' });
  }
  try {
    const snapshot = readAOSnapshot({ folder, filename });
    const cfg = { folder, filename, active: true, lastSync: new Date().toISOString() };
    dbSet('ao_excel_config', cfg);
    saveExcelPathBackup('ao', { folder, filename });
    aoCache = { snapshot: null, sourceKey: null, cachedAt: 0 };
    res.json({ success: true, rowCount: snapshot.summary.totalRows, reliableRows: snapshot.summary.reliableRows });
  } catch (e) {
    res.status(500).json({ success: false, error: excelErrorMessage(e) });
  }
});

app.delete('/api/ao-excel-config', (req, res) => {
  dbSet('ao_excel_config', null);
  deleteExcelPathBackup('ao');
  aoCache = { snapshot: null, sourceKey: null, cachedAt: 0 };
  res.json({ success: true });
});

app.get('/api/ao-indicateurs', (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.force === '1';
    const snapshot = getAOSnapshotCached({ forceRefresh });
    res.json(snapshot);
  } catch (e) {
    const cfg = getAOConfig();
    res.status(cfg ? 500 : 404).json({
      success: false,
      error: e.message,
      notConfigured: !cfg
    });
  }
});

// Servir les fichiers PDF du planning
app.use('/server/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ─── ROUTES : DOSSIERS CHANTIERS RÉSEAU ────────────────────────────────────────
// Explorateur de fichiers pour les dossiers chantiers sur le partage réseau.
// Chemin de base : Y:\03-Affaires\02-Affaires en cours

const DOSSIERS_BASE = process.env.DOSSIERS_BASE || path.join('Y:', '03-Affaires', '02-Affaires en cours');
const EXCEL_INFO_FILENAME = '00_ Infos général chantier.xlsx';

// Mapping label Excel → clé DB
const EXCEL_LABEL_TO_KEY = {
  'Nom du chantier':         'Chantier',
  'Numéro et rue':           'Numéro et rue',
  'Ville':                   'Ville',
  'Code postal':             'Code postal',
  'Conducteur de travaux':   'Conducteur de travaux',
  'Dessinateur BE':          'Dessinateur BE',
  "Date d'OS":               'Date OS',
  'Date fin contractuelle':  'Date fin contractuelle',
  'Montant marché HT':       'Montant marché HT',
};

// Cache liste des chantiers (TTL 30 min — la liste ne change qu'à la synchro ou à l'upload)
let _dossiersListCache = { data: null, cachedAt: 0 };
const DOSSIERS_CACHE_TTL = 30 * 60 * 1000;

// Cache carte des chantiers (TTL 30 min — lit tous les Excel Y:\ à chaque appel)
let _dossiersCarteCache = { data: null, cachedAt: 0 };
const CARTE_CACHE_TTL = 30 * 60 * 1000;

// Cache contenu d'un dossier (TTL 15 sec par chemin — lecture répertoire Y:\)
const _folderContentCache = new Map(); // path → { items, cachedAt }
const FOLDER_CACHE_TTL = 15 * 1000;

// Cache infos Excel par dossier (TTL 10 min — évite de re-parser le fichier à chaque sélection)
const _excelInfoCache = new Map(); // xlsxPath → { info, cachedAt }
const EXCEL_INFO_CACHE_TTL = 10 * 60 * 1000;

// Upload en mémoire → écriture à la destination
const _dossiersUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function normalizeNameForMatch(str) {
  return String(str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function safeResolveDossier(rel) {
  const resolved = path.resolve(DOSSIERS_BASE, rel || '');
  if (!resolved.startsWith(path.resolve(DOSSIERS_BASE))) return null;
  return resolved;
}

// Stockage des infos chantier dans goudalle.json (clé: dossiers_info).
// Le partage réseau Y: est en lecture seule → on ne peut pas écrire dessus.
function getDbInfoChantier(nomDossier) {
  const all = dbGet('dossiers_info', {});
  return all[nomDossier] || null;
}

function setDbInfoChantier(nomDossier, fields) {
  const all = dbGet('dossiers_info', {});
  all[nomDossier] = fields;
  dbSet('dossiers_info', all);
  // Invalider les caches qui dépendent de ces infos
  const xlsxPath = path.join(DOSSIERS_BASE, nomDossier, EXCEL_INFO_FILENAME);
  _excelInfoCache.delete(xlsxPath);
  _dossiersCarteCache.cachedAt = 0;
}

function hasAnyInfo(info) {
  return !!info && Object.values(info).some(v => v !== undefined && v !== null && String(v).trim());
}

function mergeInfo(...sources) {
  const out = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined && value !== null && String(value).trim()) out[key] = value;
    }
  }
  return out;
}

function readExcelInfoChantier(nomDossier) {
  const xlsxPath = path.join(DOSSIERS_BASE, nomDossier, EXCEL_INFO_FILENAME);
  if (!fs.existsSync(xlsxPath)) return null;

  // Vérifier le cache avant de lire l'Excel
  const cached = _excelInfoCache.get(xlsxPath);
  if (cached && (Date.now() - cached.cachedAt) < EXCEL_INFO_CACHE_TTL) return cached.info;

  try {
    const wb = XLSX.readFile(xlsxPath, { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const info = {};
    rows.forEach(([label, value]) => {
      const key = EXCEL_LABEL_TO_KEY[String(label || '').trim()];
      if (key && value !== undefined && String(value).trim()) {
        info[key] = value instanceof Date ? value.toLocaleDateString('fr-FR') : String(value).trim();
      }
    });
    const result = hasAnyInfo(info) ? info : null;
    _excelInfoCache.set(xlsxPath, { info: result, cachedAt: Date.now() });
    return result;
  } catch { return null; }
}

function readInfoChantier(nomDossier) {
  // DB site < Excel manuel (l'Excel prend le dessus sur la DB pour les champs remplis manuellement)
  const excelInfo = readExcelInfoChantier(nomDossier);
  const dbInfo = getDbInfoChantier(nomDossier);
  const merged = mergeInfo(dbInfo, excelInfo);
  return hasAnyInfo(merged) ? merged : null;
}

function parseCoordinate(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeAddress(address) {
  if (!address || typeof fetch !== 'function') return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = 'https://nominatim.openstreetmap.org/search'
      + `?format=json&limit=1&countrycodes=fr&q=${encodeURIComponent(address + ', France')}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GroupeGoudalle-Intranet/1.0' },
    });
    if (!response.ok) return null;
    const results = await response.json();
    const first = Array.isArray(results) ? results[0] : null;
    if (!first) return null;
    return { lat: Number(first.lat), lng: Number(first.lon) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function geocodeAndStoreChantier(nomDossier, info) {
  const lat = parseCoordinate(info?.Latitude);
  const lng = parseCoordinate(info?.Longitude);
  if (lat !== null && lng !== null) return { lat, lng };

  const rue   = info?.['Numéro et rue'] || '';
  const ville = info?.Ville || '';
  const cp    = info?.['Code postal'] || '';
  const adresseFull  = [rue, cp && ville ? `${cp} ${ville}` : ville || cp].filter(Boolean).join(', ');
  const adresseVille = [cp && ville ? `${cp} ${ville}` : ville || cp].filter(Boolean).join(', ');
  if (!adresseFull) return null;

  // Essai 1 : adresse complète
  let found = await geocodeAddress(adresseFull);
  // Fallback : juste code postal + ville si la rue n'est pas reconnue
  if (!found && adresseVille && adresseVille !== adresseFull) {
    found = await geocodeAddress(adresseVille);
  }
  if (!found) return null;

  const dbInfo = getDbInfoChantier(nomDossier) || {};
  setDbInfoChantier(nomDossier, {
    ...dbInfo,
    Latitude: String(found.lat),
    Longitude: String(found.lng),
  });
  _dossiersListCache.cachedAt = 0; _dossiersCarteCache.cachedAt = 0;
  return found;
}

function formatDateFR(value) {
  if (!value) return '';
  const s = String(value).trim();
  // Déjà dd/mm/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // ISO yyyy-mm-dd (format input[type=date])
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  // Objet Date ou chaîne parseable
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
  }
  return s;
}

async function writeInfoToExcel(nomDossier, fields) {
  const xlsxPath = path.join(DOSSIERS_BASE, nomDossier, EXCEL_INFO_FILENAME);
  if (!fs.existsSync(xlsxPath)) return;
  try {
    const wb = await XlsxPopulate.fromFileAsync(xlsxPath);
    const ws = wb.sheet(0);
    for (let r = 1; r <= 15; r++) {
      const label = ws.cell(r, 1).value();
      if (!label) continue;
      const key = EXCEL_LABEL_TO_KEY[String(label).trim()];
      if (key === undefined) continue;
      const isDate = key === 'Date OS' || key === 'Date fin contractuelle';
      ws.cell(r, 2).value(isDate ? formatDateFR(fields[key]) : (fields[key] || ''));
    }
    await wb.toFileAsync(xlsxPath);
  } catch (e) {
    console.warn(`[Info Excel] Écriture impossible (${nomDossier}): ${e.message}`);
  }
}

function getExtIcon(ext) {
  const e = String(ext).toLowerCase().replace('.', '');
  if (['pdf'].includes(e)) return 'pdf';
  if (['jpg','jpeg','png','gif','bmp','webp','svg'].includes(e)) return 'image';
  if (['docx','doc'].includes(e)) return 'word';
  if (['xlsx','xlsm','xls'].includes(e)) return 'excel';
  if (['pptx','ppt'].includes(e)) return 'powerpoint';
  if (['dwg','dxf'].includes(e)) return 'cad';
  if (['mp4','avi','mov','mkv'].includes(e)) return 'video';
  if (['zip','rar','7z'].includes(e)) return 'archive';
  if (['msg','eml'].includes(e)) return 'email';
  return 'file';
}

// GET /api/dossiers/liste — liste tous les dossiers chantier avec leurs infos de base
// Query: ?conducteur=Tony+Morant (facultatif, filtre par conducteur)
app.get('/api/dossiers/liste', async (req, res) => {
  const now = Date.now();
  const forceRefresh = req.query.refresh === '1';
  const conducteurFilter = req.query.conducteur ? normalizeNameForMatch(req.query.conducteur) : null;

  if (!forceRefresh && _dossiersListCache.data && (now - _dossiersListCache.cachedAt) < DOSSIERS_CACHE_TTL) {
    const data = conducteurFilter
      ? _dossiersListCache.data.filter(c => normalizeNameForMatch(c.conducteur) === conducteurFilter)
      : _dossiersListCache.data;
    return res.json({ success: true, chantiers: data, cached: true });
  }

  try {
    // fs.promises.readdir est async → ne bloque pas l'event loop Node.js
    const entries = await fs.promises.readdir(DOSSIERS_BASE, { withFileTypes: true });
    const chantiers = [];

    const allDbInfo = dbGet('dossiers_info', {});
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('0 ') || entry.name.startsWith('1 ')) continue;
      const info = allDbInfo[entry.name] || {};
      // Payload minimal pour la liste — les détails sont chargés à la sélection via /api/dossiers/info
      chantiers.push({
        nom: entry.name,
        chantier: info['Chantier'] || entry.name,
        conducteur: info['Conducteur de travaux'] || '',
        hasInfo: !!(info['Conducteur de travaux'] && info['Date OS'] && info['Date fin contractuelle'] && (info['Numéro et rue'] || info['Ville'])),
      });
    }

    chantiers.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    _dossiersListCache = { data: chantiers, cachedAt: now };

    const filtered = conducteurFilter
      ? chantiers.filter(c => normalizeNameForMatch(c.conducteur) === conducteurFilter)
      : chantiers;

    res.json({ success: true, chantiers: filtered });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/dossiers/carte — chantiers avec adresse et coordonnées pour la vue globale
app.get('/api/dossiers/carte', async (req, res) => {
  const forceRefresh = req.query.refresh === '1';
  const now = Date.now();
  if (!forceRefresh && _dossiersCarteCache.data && (now - _dossiersCarteCache.cachedAt) < CARTE_CACHE_TTL) {
    return res.json({ ...(_dossiersCarteCache.data), cached: true });
  }
  try {
    const entries = await fs.promises.readdir(DOSSIERS_BASE, { withFileTypes: true });
    const chantiers = [];
    let totalWithAddress = 0;
    let geocodedThisRequest = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('0 ') || entry.name.startsWith('1 ')) continue;

      let info = readInfoChantier(entry.name) || {};
      const rue = info['Numéro et rue'] || '';
      const ville = info['Ville'] || '';
      const cp = info['Code postal'] || '';
      const adresseComplete = [rue, [cp, ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      if (!adresseComplete) continue;
      totalWithAddress++;

      let lat = parseCoordinate(info.Latitude);
      let lng = parseCoordinate(info.Longitude);

      // Géocoder progressivement pour éviter de marteler OpenStreetMap.
      if ((lat === null || lng === null) && geocodedThisRequest < 8) {
        const found = await geocodeAndStoreChantier(entry.name, info);
        if (found) {
          lat = found.lat;
          lng = found.lng;
          geocodedThisRequest++;
          info = readInfoChantier(entry.name) || info;
          await sleep(1100);
        }
      }

      if (lat === null || lng === null) continue;

      chantiers.push({
        id: encodeURIComponent(entry.name),
        dossier: entry.name,
        nom: info['Chantier'] || entry.name,
        adresse: adresseComplete,
        conducteur: info['Conducteur de travaux'] || '',
        dessinateur: info['Dessinateur BE'] || '',
        dateOS: info['Date OS'] || '',
        dateFin: info['Date fin contractuelle'] || '',
        montantHT: info['Montant marché HT'] || '',
        lat,
        lng,
      });
    }

    chantiers.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const payload = { success: true, chantiers, totalWithAddress, geocodedThisRequest };
    _dossiersCarteCache = { data: payload, cachedAt: now };
    res.json(payload);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/dossiers/contenu?rel=BOURBOURG%2F03_Travaux... — liste le contenu d'un dossier
app.get('/api/dossiers/contenu', async (req, res) => {
  const rel = req.query.rel || '';
  const target = safeResolveDossier(rel);
  if (!target) return res.status(400).json({ success: false, error: 'Chemin invalide' });

  // Cache court (15 s) pour éviter les re-lectures répétées lors de la navigation
  const cached = _folderContentCache.get(target);
  if (cached && (Date.now() - cached.cachedAt) < FOLDER_CACHE_TTL) {
    return res.json({ success: true, items: cached.items, cached: true });
  }

  try {
    const entries = await fs.promises.readdir(target, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter(e => !e.name.startsWith('~$') && e.name !== 'Thumbs.db' && e.name !== 'desktop.ini' && e.name !== '.DS_Store')
        .map(async e => {
          const fullPath = path.join(target, e.name);
          const isDir = e.isDirectory();
          let size = 0, modified = '';
          try {
            const stat = await fs.promises.stat(fullPath);
            size = stat.size;
            modified = stat.mtime.toISOString();
          } catch {}
          const ext = isDir ? '' : path.extname(e.name);
          return { name: e.name, isDir, size, modified, ext, type: isDir ? 'folder' : getExtIcon(ext) };
        })
    );
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'fr');
    });

    _folderContentCache.set(target, { items, cachedAt: Date.now() });
    res.json({ success: true, items });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ success: false, error: 'Dossier introuvable' });
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/dossiers/search?rel=ZUYDCOOTE&q=OS — recherche récursive dans un dossier chantier
app.get('/api/dossiers/search', async (req, res) => {
  const rel = req.query.rel || '';
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q || q.length < 2) return res.json({ success: true, results: [] });

  const base = safeResolveDossier(rel);
  if (!base) return res.status(400).json({ success: false, error: 'Chemin invalide' });

  const results = [];
  const IGNORE = new Set(['~$', 'Thumbs.db', 'desktop.ini', '.DS_Store']);
  const MAX = 100;

  async function walk(dir, relDir) {
    if (results.length >= MAX) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= MAX) return;
      if (IGNORE.has(e.name) || e.name.startsWith('~$')) continue;
      const fullPath = path.join(dir, e.name);
      const relPath = relDir ? relDir + '/' + e.name : e.name;
      if (e.name.toLowerCase().includes(q)) {
        const ext = e.isDirectory() ? '' : path.extname(e.name);
        results.push({ name: e.name, isDir: e.isDirectory(), relPath, ext, type: e.isDirectory() ? 'folder' : getExtIcon(ext) });
      }
      if (e.isDirectory()) await walk(fullPath, relPath);
    }
  }

  try {
    await walk(base, '');
    res.json({ success: true, results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/dossiers/fichier?rel=... — sert un fichier (pour visualisation ou téléchargement)
app.get('/api/dossiers/fichier', async (req, res) => {
  const rel = req.query.rel || '';
  const target = safeResolveDossier(rel);
  if (!target) return res.status(400).json({ error: 'Chemin invalide' });
  try {
    const st = await fs.promises.stat(target);
    if (st.isDirectory()) return res.status(404).json({ error: 'Fichier introuvable' });
  } catch { return res.status(404).json({ error: 'Fichier introuvable' }); }

  const ext = path.extname(target).toLowerCase();
  const inline = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(ext);

  const mimeMap = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';
  const filename = encodeURIComponent(path.basename(target));

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`);
  res.setHeader('Cache-Control', 'private, max-age=60');

  const stream = fs.createReadStream(target);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

// GET /api/dossiers/preview?rel=... — rendu HTML inline pour Word et Excel
app.get('/api/dossiers/preview', async (req, res) => {
  const rel = req.query.rel || '';
  const target = safeResolveDossier(rel);
  if (!target) return res.status(400).send('Chemin invalide');
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return res.status(404).send('Fichier introuvable');

  const ext = path.extname(target).toLowerCase();
  const base = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;font-size:13px;margin:0;padding:16px;color:#222;background:#fff;}
  table{border-collapse:collapse;width:100%;font-size:12px;}
  td,th{border:1px solid #d0d0d0;padding:4px 8px;white-space:pre-wrap;vertical-align:top;}
  th{background:#f0f0f0;font-weight:600;}
  tr:nth-child(even) td{background:#f9f9f9;}
  .sheet-title{font-weight:700;font-size:13px;margin:18px 0 6px;color:#555;border-bottom:2px solid #ddd;padding-bottom:4px;}
  img{max-width:100%;}
  h1{font-size:1.4em;}h2{font-size:1.2em;}h3{font-size:1.05em;}
</style></head><body>`;

  try {
    if (['.xlsx', '.xls', '.xlsm'].includes(ext)) {
      const wb = XLSX.readFile(target);
      let html = '';
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const table = XLSX.utils.sheet_to_html(ws, { editable: false });
        html += `<div class="sheet-title">${sheetName}</div>${table}`;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(base + html + '</body></html>');
    }

    if (['.docx', '.doc'].includes(ext)) {
      const result = await mammoth.convertToHtml({ path: target });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(base + result.value + '</body></html>');
    }

    res.status(400).send('Type de fichier non supporté pour la prévisualisation');
  } catch (e) {
    res.status(500).send(`Erreur lors de la lecture du fichier : ${e.message}`);
  }
});

// POST /api/dossiers/upload?rel=... — upload un ou plusieurs fichiers dans un dossier
app.post('/api/dossiers/upload', requireToken, requireWriteRateLimit, _dossiersUpload.array('fichiers', 20), (req, res) => {
  const rel = req.query.rel || '';
  const target = safeResolveDossier(rel);
  if (!target) return res.status(400).json({ success: false, error: 'Chemin invalide' });
  if (!fs.existsSync(target)) return res.status(404).json({ success: false, error: 'Dossier cible introuvable' });

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, error: 'Aucun fichier reçu' });
  }

  const saved = [];
  const errors = [];

  for (const file of req.files) {
    const safeName = path.basename(file.originalname);
    const dest = path.join(target, safeName);
    try {
      fs.writeFileSync(dest, file.buffer);
      saved.push(safeName);
    } catch (e) {
      const isPermError = e.code === 'EPERM' || e.code === 'EACCES';
      errors.push({
        name: safeName,
        error: isPermError
          ? 'Accès refusé — le partage réseau Y: est en lecture seule depuis le serveur. Déposez le fichier directement dans le dossier Windows.'
          : e.message,
        readonly: isPermError,
      });
    }
  }

  _dossiersListCache.cachedAt = 0; _dossiersCarteCache.cachedAt = 0;

  const allReadonly = errors.length > 0 && errors.every(e => e.readonly) && saved.length === 0;
  if (allReadonly) {
    return res.status(403).json({
      success: false,
      error: 'Le partage réseau Y: est en lecture seule depuis le serveur. Pour importer des fichiers, déposez-les directement dans le dossier Windows via l\'Explorateur.',
      readonly: true,
      errors,
    });
  }

  res.json({ success: saved.length > 0, saved, errors });
});

// PUT /api/dossiers/info?rel=BOURBOURG — enregistre les infos dans goudalle.json
app.put('/api/dossiers/info', requireToken, requireWriteRateLimit, (req, res) => {
  const rel = (req.query.rel || '').split('/')[0]; // Nom du dossier racine uniquement
  if (!rel) return res.status(400).json({ success: false, error: 'Nom de chantier manquant' });

  const fields = req.body;
  if (!fields || typeof fields !== 'object') {
    return res.status(400).json({ success: false, error: 'Données manquantes' });
  }

  try {
    setDbInfoChantier(rel, fields);
    _dossiersListCache.cachedAt = 0; _dossiersCarteCache.cachedAt = 0;
    res.json({ success: true });
    // Écriture dans l'Excel du dossier en arrière-plan (non bloquant)
    writeInfoToExcel(rel, fields).catch(() => {});
    geocodeAndStoreChantier(rel, fields).catch(() => {});
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/dossiers/info?rel=BOURBOURG — lit les infos du chantier (db puis xlsx)
app.get('/api/dossiers/info', (req, res) => {
  const rel = (req.query.rel || '').split('/')[0];
  if (!rel) return res.status(400).json({ success: false, error: 'Nom de chantier manquant' });

  const info = readInfoChantier(rel);
  res.json({ success: true, info: info || null });
});

// ─── SUIVI D'OPÉRATION ──────────────────────────────────────────────────────

// Résolution des dossiers de destination par préfixe
const SUIVI_FOLDER_RESOLVERS = {
  '00_marche_1':  (dir) => findSuiviFolder(dir, '00_', '1'),
  '02_be':        (dir) => findSuiviFolder(dir, '02_'),
  '03_travaux':   (dir) => findSuiviFolder(dir, '03_'),
  '09_prorata':   (dir) => findSuiviFolder(dir, '09_'),
  '10_doe':       (dir) => findSuiviFolder(dir, '10_'),
  '11_financier': (dir) => findSuiviFolder(dir, '11_'),
  '13_rex':       (dir) => findSuiviFolder(dir, '13_'),
};

async function findSuiviFolder(chantierDir, prefix, subPrefix) {
  try {
    const entries = await fs.promises.readdir(chantierDir, { withFileTypes: true });
    const main = entries.find(e => e.isDirectory() && e.name.startsWith(prefix));
    if (!main) return null;
    if (!subPrefix) return path.join(chantierDir, main.name);
    const mainPath = path.join(chantierDir, main.name);
    const subs = await fs.promises.readdir(mainPath, { withFileTypes: true });
    const sub = subs.find(e => e.isDirectory() && e.name.startsWith(subPrefix));
    return sub ? path.join(mainPath, sub.name) : mainPath;
  } catch { return null; }
}

// GET /api/dossiers/suivi?rel=BOURBOURG
// POST /api/dossiers/acte-engagement — upload de l'acte d'engagement, renommé automatiquement
app.post('/api/dossiers/acte-engagement', requireToken, _dossiersUpload.single('fichier'), async (req, res) => {
  const rel  = (req.query.rel  || '').split('/')[0];
  const date = String(req.query.date || '').replace(/\//g, '-').trim(); // JJ-MM-AAAA
  if (!rel || !date || !req.file) return res.status(400).json({ success: false, error: 'Paramètres manquants' });

  const chantierDir = path.join(DOSSIERS_BASE, rel);
  // Chercher 00_DCE.../1 - Marché, sinon 01_Commercial, sinon racine
  let destDir = chantierDir;
  try {
    const entries = await fs.promises.readdir(chantierDir);
    const dce = entries.find(e => /^00_dce/i.test(e) || /^00_.*march/i.test(e));
    if (dce) {
      const dceDir = path.join(chantierDir, dce);
      const dceEntries = await fs.promises.readdir(dceDir).catch(() => []);
      const marche = dceEntries.find(e => /1\s*[-–]\s*march/i.test(e) || /^1\s*-\s*march/i.test(e) || /^march/i.test(e));
      if (marche) destDir = path.join(dceDir, marche);
      else destDir = dceDir;
    } else {
      const commercial = entries.find(e => /^01_/i.test(e));
      if (commercial) destDir = path.join(chantierDir, commercial);
    }
  } catch {}

  const ext = path.extname(req.file.originalname) || '.pdf';
  const safeName = `Acte d'engagement_${rel}_${date}${ext}`;

  try {
    await fs.promises.writeFile(path.join(destDir, safeName), req.file.buffer);
    _folderContentCache.delete(destDir);
    res.json({ success: true, filename: safeName, folder: path.relative(chantierDir, destDir) || '.' });
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') return res.status(403).json({ success: false, error: 'Dossier réseau en lecture seule.' });
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/dossiers/suivi', (req, res) => {
  const rel = (req.query.rel || '').split('/')[0];
  if (!rel) return res.status(400).json({ success: false, error: 'Nom manquant' });
  const all = dbGet('dossiers_suivi', {});
  res.json({ success: true, suivi: all[rel] || {} });
});

// PUT /api/dossiers/suivi?rel=BOURBOURG — sauvegarde l'état de la checklist
app.put('/api/dossiers/suivi', requireToken, (req, res) => {
  const rel = (req.query.rel || '').split('/')[0];
  if (!rel) return res.status(400).json({ success: false, error: 'Nom manquant' });
  const all = dbGet('dossiers_suivi', {});
  all[rel] = req.body || {};
  dbSet('dossiers_suivi', all);
  res.json({ success: true });
});


// /api/health expose le token de sécurité uniquement aux clients du réseau local.
// Ce token doit être inclus dans toutes les requêtes d'écriture.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', token: SERVER_TOKEN, timestamp: new Date().toISOString() });
});

// Servir les fichiers uploadés en statique (lecture seule)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── ROUTE FALLBACK ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client', 'index.html'));
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

  // Initialisation / vérification du fichier Excel des comptes
  try {
    const users = readAccountsExcel();
    const count = Object.keys(users).length;
    if (fs.existsSync(ACCOUNTS_EXCEL_PATH)) {
      console.log(`✅ [Comptes] Excel chargé : ${ACCOUNTS_EXCEL_PATH} (${count} compte(s))`);
    } else {
      console.log(`✅ [Comptes] Excel créé avec compte par défaut : ${ACCOUNTS_EXCEL_PATH}`);
    }
  } catch (e) {
    console.error(`❌ [Comptes] Erreur accès Excel : ${e.message}`);
  }

  console.log('✅ Serveur prêt - accessible depuis le réseau');
  console.log('');

  // Vérification des fichiers Excel configurés
  const gmCfg = dbGet('gm_excel_config', null);
  if (gmCfg && gmCfg.active) {
    let excelPath = path.join(gmCfg.folder, gmCfg.filename);
    if (!fs.existsSync(excelPath)) {
      const candidates = ['.xlsx', '.xlsm', '.xls'];
      const found = candidates.find(ext => fs.existsSync(excelPath + ext));
      if (found) excelPath = excelPath + found;
    }
    if (fs.existsSync(excelPath)) {
      console.log(`✅ [Excel GM] Connecté : ${excelPath}`);
    } else {
      console.log(`❌ [Excel GM] Fichier introuvable : ${excelPath}`);
    }
  } else {
    console.log(`⚠️  [Excel GM] Aucun fichier Excel configuré`);
  }
  const cbcoProdCfg = dbGet('cbco_productivite_excel_config', null);
  if (cbcoProdCfg && cbcoProdCfg.active) {
    let excelPath = path.join(cbcoProdCfg.folder, cbcoProdCfg.filename);
    if (!fs.existsSync(excelPath)) {
      const candidates = ['.xlsx', '.xlsm', '.xls'];
      const found = candidates.find(ext => fs.existsSync(excelPath + ext));
      if (found) excelPath = excelPath + found;
    }
    if (fs.existsSync(excelPath)) {
      console.log(`✅ [Excel CBCO Prod] Connecté : ${excelPath}`);
    } else {
      console.log(`❌ [Excel CBCO Prod] Fichier introuvable : ${excelPath}`);
    }
  } else {
    console.log(`⚠️  [Excel CBCO Prod] Aucun fichier Excel configuré`);
  }
  const rhCfg = dbGet('rh_security_excel_config', null);
  if (rhCfg && rhCfg.active && rhCfg.files) {
    console.log(`✅ [Excel RH Sécurité] Configuration par fichier :`);
    for (const company of RH_SECURITY_COMPANIES) {
      const fi = rhCfg.files[company.id];
      if (!fi) { console.log(`   ⚠️  ${company.label} : non configuré`); continue; }
      const fp = path.join(fi.folder, fi.filename);
      console.log(fs.existsSync(fp) ? `   ✅ ${fi.filename}` : `   ❌ ${fi.filename} (introuvable)`);
    }
  } else {
    console.log(`⚠️  [Excel RH Sécurité] Aucun fichier configuré`);
  }
  try {
    const commerceSource = detectLatestCommerceExcel();
    console.log(`✅ [Excel Commerce] Dernier fichier détecté : ${commerceSource.filename}`);
  } catch (e) {
    console.log(`⚠️  [Excel Commerce] ${e.message}`);
  }
  const aoCfg = getAOConfig();
  if (aoCfg && aoCfg.active) {
    try {
      const resolved = resolveExistingExcelPath(aoCfg.folder, aoCfg.filename);
      console.log(`✅ [Excel AO] Connecté : ${resolved.fullPath}`);
    } catch (e) {
      console.log(`❌ [Excel AO] Fichier introuvable : ${e.message}`);
    }
  } else {
    console.log(`⚠️  [Excel AO] Aucun fichier configuré`);
  }
  console.log('');
});
