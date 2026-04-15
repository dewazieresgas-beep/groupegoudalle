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
const { PDFParse } = require('pdf-parse');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

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
const DB_PATH = path.join(__dirname, 'goudalle.json');

// ─── INITIALISATION DU STOCKAGE ──────────────────────────────────────────────────

let store = {};
if (fs.existsSync(DB_PATH)) {
  try { store = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch { store = {}; }
}

function saveStore() {
  // Sauvegarde de sécurité avant chaque écriture (garde les 3 dernières)
  if (fs.existsSync(DB_PATH)) {
    const backupBase = DB_PATH.replace('.json', '');
    // Rotation : backup.2 → backup.3 (supprimé), backup.1 → backup.2, courant → backup.1
    if (fs.existsSync(backupBase + '.backup.2.json')) {
      fs.renameSync(backupBase + '.backup.2.json', backupBase + '.backup.3.json');
    }
    if (fs.existsSync(backupBase + '.backup.1.json')) {
      fs.renameSync(backupBase + '.backup.1.json', backupBase + '.backup.2.json');
    }
    fs.copyFileSync(DB_PATH, backupBase + '.backup.1.json');
  }
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
  const m = compact.match(/^(\d{2}\/\d{2}\/\d{4})\s+(FR[\w-]+)\s+(.*?)\s+(-?\d[\d ]*,\d{2})$/i);
  if (!m) return null;

  const [, dateFacture, numeroFacture, middleRaw, montantRaw] = m;
  const tokens = String(middleRaw || '').trim().split(' ').filter(Boolean);
  if (!tokens.length) return null;

  const idxSupplier = tokens.findIndex((t) => /^0\S+$/i.test(t));
  let journal = null;
  let fournisseur = null;
  let chantier = null;
  let libelleFacture = null;
  let avoir = null;

  if (idxSupplier >= 0) {
    fournisseur = tokens[idxSupplier];
    const beforeSupplier = tokens.slice(0, idxSupplier);
    const rest = tokens.slice(idxSupplier + 1);
    if (beforeSupplier.some((t) => /^(avoir|av)$/i.test(t))) avoir = 'AVOIR';
    for (let i = beforeSupplier.length - 1; i >= 0; i--) {
      const t = beforeSupplier[i];
      if (/^(avoir|av)$/i.test(t)) continue;
      if (/^[A-Z]{1,3}$/.test(t)) {
        journal = t;
        break;
      }
    }
    const idxFact = rest.findIndex((t) => /^fact$/i.test(t) || /^avoir$/i.test(t));
    chantier = idxFact > 0 ? rest.slice(0, idxFact).join(' ').trim() : null;
    libelleFacture = idxFact >= 0 ? rest.slice(idxFact).join(' ').trim() : rest.join(' ').trim();
  } else {
    return null;
  }

  if (!libelleFacture || !/(^fact\b|^avoir\b)/i.test(libelleFacture)) return null;

  return {
    date_facture: dateFacture,
    numero_facture: numeroFacture,
    avoir,
    journal,
    fournisseur,
    chantier,
    libelle_facture: libelleFacture,
    montant_ht: toNumberFr(montantRaw),
    header_raw: clean
  };
}

function parsePdfArticleLine(line) {
  const clean = dedupeRepeatedLine(line);
  const m = clean.match(/^(.*?)(?:\s+(U|ML|M2|M3|ENS|KG))?\s+(-?\d[\d ]*,\d{3})\s+(-?\d[\d ]*,\d{2})\s+(-?\d[\d ]*,\d{2})$/i);
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
  let resourceTokens = [];
  let tail = [];
  if (idxBl >= 0) {
    bl = tokens[idxBl];
    resourceTokens = tokens.slice(0, idxBl);
    tail = tokens.slice(idxBl + 1);
  } else {
    const splitIdx = tokens.findIndex((t, i) => i > 0 && (isArcToken(t) || isChantierToken(t)));
    if (splitIdx > 0) {
      resourceTokens = tokens.slice(0, splitIdx);
      tail = tokens.slice(splitIdx);
    } else {
      resourceTokens = [tokens[0]];
      tail = tokens.slice(1);
    }
  }

  let arc = null;
  let chantierLigne = null;
  if (tail.length && isArcToken(tail[0])) arc = tail.shift();
  if (tail.length && isChantierToken(tail[0])) chantierLigne = tail.shift();
  const libelle = tail.join(' ').trim() || prefix || null;

  return {
    ressource: resourceTokens.join(' ').trim() || null,
    bl_numero: bl,
    arc,
    chantier_ligne: chantierLigne,
    libelle_ligne: libelle,
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
app.use(express.static(path.join(__dirname, '..')));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadsDir = path.join(__dirname, 'uploads');
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Garder le nom original avec timestamp
    const timestamp = Date.now();
    const filename = `planning-${timestamp}.pdf`;
    console.log('[Multer] Filename:', filename);
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    console.log('[Multer] File received:', file.originalname, 'Type:', file.mimetype);
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont acceptés'), false);
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// Middleware de gestion des erreurs multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('[Multer Error]', err.code, err.message);
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(400).json({ success: false, error: 'Fichier trop volumineux (max 100MB)' });
    }
    return res.status(400).json({ success: false, error: 'Erreur upload: ' + err.message });
  } else if (err) {
    console.error('[Upload Error]', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
  next();
});

// ─── ROUTES : UTILISATEURS ──────────────────────────────────────────────────────

app.get('/api/users', (req, res) => {
  res.json(dbGet('users', {}));
});

app.put('/api/users', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('users', req.body);
  res.json({ success: true });
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

// ─── ROUTES : KPIs GOUDALLE MAÇONNERIE ─────────────────────────────────────────

app.get('/api/kpis', (req, res) => {
  res.json(dbGet('kpis', []));
});

app.put('/api/kpis', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('kpis', req.body);
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

// ─── ROUTES : CBCO CHIFFRE D'AFFAIRES ──────────────────────────────────────────

app.get('/api/cbco', (req, res) => {
  res.json(dbGet('cbco', []));
});

app.put('/api/cbco', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('cbco', req.body);
  res.json({ success: true });
});

// ─── ROUTES : CBCO PRODUCTIVITÉ USINE ────────────────────────────────────────────

app.get('/api/cbco-productivite', (req, res) => {
  res.json(dbGet('cbco_productivite', []));
});

app.put('/api/cbco-productivite', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('cbco_productivite', req.body);
  res.json({ success: true });
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
  let excelPath = path.join(cfg.folder, cfg.filename);
  if (!fs.existsSync(excelPath)) {
    const candidates = ['.xlsx', '.xlsm', '.xls'];
    const found = candidates.find(ext => fs.existsSync(excelPath + ext));
    if (found) excelPath = excelPath + found;
    else throw new Error(`Fichier introuvable : "${excelPath}"`);
  }

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
      const semaineAnnuelle = toNum(row[colCfg.B]);
      const semaineCumulee  = toNum(row[colCfg.C]);
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

      if (semaineCumulee === null && semaineAnnuelle === null) continue;
      const req = colCfg.required || ['heuresOnaya', 'cubage'];
      const vals = { heuresOnaya, heuresPerdues, cubage, productivite };
      if (req.some(f => vals[f] === null)) continue;

      let week = null, year = null;
      if (semaineCumulee !== null && semaineCumulee > 0) {
        const c = Math.round(semaineCumulee);
        year = 2023 + Math.floor((c - 1) / 52);
        week = ((c - 1) % 52) + 1;
      } else if (semaineAnnuelle !== null && semaineAnnuelle > 0) {
        week = Math.round(semaineAnnuelle); year = 2023;
      }
      if (!week || !year) continue;

      const heuresUtiles = (heuresOnaya !== null && heuresPerdues !== null) ? Math.max(0, heuresOnaya - heuresPerdues) : null;
      const prod = (cubage !== null && heuresUtiles !== null && heuresUtiles > 0) ? (cubage / heuresUtiles) : productivite;
      const key = `${year}-${String(week).padStart(2,'0')}`;
      byWeek[key] = { week, year, semaineAnnuelle, semaineCumulee, heuresOnaya, heuresPerdues, heuresUtiles, cubage, productivite: prod, remarques, cibleProductivite: cible, trs, tempsUtilisationMachine: tempsUtil, productiviteHeuresMachines: prodHM, volume, nombrePressees: presses, nombreCaissons: caissons, surfaceCollee: surface };
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
      if (!hasVal(row[3]) && !hasVal(row[4]) && !hasVal(row[5]) && !hasVal(row[6]) && !hasVal(row[7])) {
        if (++emptyStreak >= 50) break; continue;
      }
      emptyStreak = 0;
      const semaineAnnuelle = toNum(row[1]);
      const semaineCumulee  = toNum(row[2]);
      const tests           = toNum(row[3]);
      const nonConformites  = toNum(row[4]);
      const detail          = hasVal(row[5]) ? String(row[5]).trim() : null;
      const reclamations    = toNum(row[6]);
      const anneeCol        = toNum(row[7]);
      if (semaineCumulee === null && semaineAnnuelle === null) continue;
      let week = null, year = null;
      if (anneeCol !== null && semaineAnnuelle !== null && semaineAnnuelle > 0) {
        week = Math.round(semaineAnnuelle); year = Math.round(anneeCol);
      } else if (semaineCumulee !== null && semaineCumulee > 0) {
        const c = Math.round(semaineCumulee);
        year = 2023 + Math.floor((c - 1) / 52);
        week = ((c - 1) % 52) + 1;
      }
      if (!week || !year) continue;
      const key = `${year}-${String(week).padStart(2,'0')}`;
      byWeek[key] = { week, year, semaineAnnuelle, semaineCumulee, tests, nonConformites, detail, reclamationsClients: reclamations, annee: anneeCol !== null ? Math.round(anneeCol) : year };
    }
    return Object.values(byWeek);
  }

  const sc         = parseMachine('sc',         { B:1, C:2, D:3, E:4, F:5, G:6, H:7, J:9,  TRS:11, TEMPS:13 });
  const ultra      = parseMachine('ultra',       { B:1, C:2, D:3, E:4, F:5, G:6, H:7, J:9,  TRS:10, TEMPS:8  });
  const extra      = parseMachine('extra',       { B:1, C:2, D:3, E:4, F:5, G:6, H:7, J:9,  TRS:11, TEMPS:8, PRODHM:10, VOLUME:12 });
  const collage    = parseMachine('collage',     { B:1, C:2, D:3, E:3, F:4, G:5, H:7, J:9,  TEMPS:5, PRESSES:4, CAISSONS:8, SURFACE:10, productiviteDur:true, cibleDur:true });
  const assemblage = parseMachine('assemblage',  { B:1, C:2, D:3, E:4, F:5, G:6, H:7, TEMPS:8, VOLUME:8, required:['heuresOnaya','heuresPerdues','cubage'] });
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
  return { entries, stats: { sc: sc.length, ultra: ultra.length, extra: extra.length, collage: collage.length, assemblage: assemblage.length, qualite: qualite.length } };
}

function applyCBCOProdData(entries) {
  const existing = dbGet('cbco_productivite', []);
  const now = new Date().toISOString();
  let added = 0, updated = 0;
  const excelKeys = new Set(entries.map(e => `${e.year}_${e.week}`));
  const kept = existing.filter(k => {
    if (k.createdBy === 'excel-auto' && !excelKeys.has(`${k.year}_${k.week}`)) return false;
    return true;
  });
  for (const entry of entries) {
    const idx = kept.findIndex(k => k.year === entry.year && k.week === entry.week);
    if (idx >= 0) { kept[idx] = { ...kept[idx], ...entry, updatedAt: now, updatedBy: 'excel-auto' }; updated++; }
    else { kept.push({ ...entry, status: 'published', createdAt: now, createdBy: 'excel-auto', updatedAt: now, updatedBy: 'excel-auto' }); added++; }
  }
  dbSet('cbco_productivite', kept);
  return { added, updated };
}

let cbcoProdWatcher = null;

function startCBCOProdWatcher(cfg) {
  if (cbcoProdWatcher) { clearInterval(cbcoProdWatcher); cbcoProdWatcher = null; }
  const excelPath = path.join(cfg.folder, cfg.filename);
  if (!fs.existsSync(excelPath)) { console.log(`[CBCO-Prod-Watch] Fichier introuvable : ${excelPath}`); return; }
  let lastMtime = fs.statSync(excelPath).mtimeMs;
  cbcoProdWatcher = setInterval(() => {
    try {
      if (!fs.existsSync(excelPath)) return;
      const mtime = fs.statSync(excelPath).mtimeMs;
      if (mtime !== lastMtime) {
        lastMtime = mtime;
        console.log(`[CBCO-Prod-Watch] Modification détectée : ${cfg.filename}`);
        try {
          const parsed = parseCBCOProdExcel(cfg);
          const result = applyCBCOProdData(parsed.entries);
          const cfg2 = dbGet('cbco_productivite_excel_config', {});
          dbSet('cbco_productivite_excel_config', { ...cfg2, lastSync: new Date().toISOString(), lastSyncResult: result });
          console.log(`[CBCO-Prod-Watch] Import OK — ${result.added} ajouté(s), ${result.updated} mis à jour`);
        } catch(e) { console.error(`[CBCO-Prod-Watch] Erreur : ${e.message}`); }
      }
    } catch(e) { console.error(`[CBCO-Prod-Watch] Erreur stat : ${e.message}`); }
  }, 30000);
  console.log(`[CBCO-Prod-Watch] Surveillance active (polling 30s) : ${excelPath}`);
}

(function resumeCBCOProdWatcher() {
  const cfg = dbGet('cbco_productivite_excel_config', null);
  if (cfg && cfg.active) { console.log('[CBCO-Prod-Watch] Reprise surveillance au démarrage...'); startCBCOProdWatcher(cfg); }
})();

app.get('/api/cbco-productivite-excel-config', (req, res) => {
  res.json(dbGet('cbco_productivite_excel_config', null));
});

app.put('/api/cbco-productivite-excel-config', requireToken, requireWriteRateLimit, (req, res) => {
  const { folder, filename } = req.body;
  if (!folder || !filename) return res.status(400).json({ success: false, error: 'Champs manquants : folder, filename' });
  try {
    const parsed = parseCBCOProdExcel({ folder, filename });
    const result = applyCBCOProdData(parsed.entries);
    const cfg = { folder, filename, active: true, lastSync: new Date().toISOString(), lastSyncResult: result };
    dbSet('cbco_productivite_excel_config', cfg);
    startCBCOProdWatcher(cfg);
    res.json({ success: true, result, stats: parsed.stats });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/cbco-productivite-excel-config', (req, res) => {
  if (cbcoProdWatcher) { clearInterval(cbcoProdWatcher); cbcoProdWatcher = null; }
  dbSet('cbco_productivite_excel_config', null);
  // Supprimer toutes les entrées importées depuis l'Excel lors de la désynchronisation
  const remaining = (dbGet('cbco_productivite', []) || []).filter(e => e.createdBy !== 'excel-auto');
  dbSet('cbco_productivite', remaining);
  res.json({ success: true });
});

app.post('/api/cbco-productivite-import-excel', (req, res) => {
  const cfg = dbGet('cbco_productivite_excel_config', null);
  if (!cfg || !cfg.active) return res.status(400).json({ success: false, error: 'Aucune synchronisation configurée.' });
  try {
    const parsed = parseCBCOProdExcel(cfg);
    const result = applyCBCOProdData(parsed.entries);
    dbSet('cbco_productivite_excel_config', { ...cfg, lastSync: new Date().toISOString(), lastSyncResult: result });
    res.json({ success: true, result, stats: parsed.stats, source: cfg.filename });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── ROUTES : CBCO COMMERCIAL ───────────────────────────────────────────────────

app.get('/api/cbco-commercial', (req, res) => {
  res.json(dbGet('cbco_commercial', []));
});

app.put('/api/cbco-commercial', requireToken, requireWriteRateLimit, (req, res) => {
  dbSet('cbco_commercial', req.body);
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

// ─── EXCEL GOUDALLE MAÇONNERIE : CONFIG + WATCHER + AUTO-IMPORT ─────────────────

// Fonction qui parse le fichier Excel et retourne les données
function parseGMExcel(cfg) {
  // Ajouter automatiquement l'extension .xlsx si elle n'est pas présente
  let filename = cfg.filename;
  if (!filename.toLowerCase().endsWith('.xlsx') && !filename.toLowerCase().endsWith('.xls')) {
    filename += '.xlsx';
  }
  
  const excelPath = path.join(cfg.folder, filename);
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
      objectifRatio:   toNum(row[4]),   // E : Objectif h/m³
      tempsBeton:      toNum(row[5]),   // F : Heures béton
      tempsAciers:     toNum(row[6]),   // G : Heures acier
      tempsChargement: toNum(row[7]),   // H : Heures Chargement
      tempsCentrale:   toNum(row[8]),   // I : Heures Centrale à béton
      qtAcierFaconne:  toNum(row[9]),   // J : Qté acier façonné (T)
      comment:         row[10] ? String(row[10]).trim() : ''  // K : Commentaire de la semaine
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

// ─── ÉCRITURE DANS L'EXCEL ───────────────────────────────────────────────────────

/**
 * Écrit ou met à jour un KPI dans l'Excel
 * @param {Object} kpi - Données du KPI (year, week, m3, hours, etc.)
 * @param {Object} cfg - Configuration Excel (folder, filename, sheet)
 */
function writeKpiToExcel(kpi, cfg) {
  // Ajouter automatiquement l'extension .xlsx si elle n'est pas présente
  let filename = cfg.filename;
  if (!filename.toLowerCase().endsWith('.xlsx') && !filename.toLowerCase().endsWith('.xls')) {
    filename += '.xlsx';
  }
  
  const excelPath = path.join(cfg.folder, filename);
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Fichier Excel introuvable : "${excelPath}"`);
  }

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
    kpi.qtAcierFaconne !== null ? kpi.qtAcierFaconne : null,            // J : Qté acier façonné (T)
    kpi.comment || ''                                                   // K : Commentaire de la semaine
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
}

/**
 * Supprime un KPI de l'Excel
 * @param {number} year - Année
 * @param {number} week - Numéro de semaine
 * @param {Object} cfg - Configuration Excel (folder, filename, sheet)
 */
function deleteKpiFromExcel(year, week, cfg) {
  // Ajouter automatiquement l'extension .xlsx si elle n'est pas présente
  let filename = cfg.filename;
  if (!filename.toLowerCase().endsWith('.xlsx') && !filename.toLowerCase().endsWith('.xls')) {
    filename += '.xlsx';
  }
  
  const excelPath = path.join(cfg.folder, filename);
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Fichier Excel introuvable : "${excelPath}"`);
  }

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
}

// Helper : récupérer la config GM (retourne null si non configurée)
function getGMConfig() {
  return dbGet('gm_excel_config', null);
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

// Gestionnaire du watcher (conservé pour compatibilité ascendante mais inutilisé)
let gmWatcher = null;

function startGMWatcher(cfg) {
  if (gmWatcher) { clearInterval(gmWatcher); gmWatcher = null; }

  // Ajouter automatiquement l'extension .xlsx si elle n'est pas présente
  let filename = cfg.filename;
  if (!filename.toLowerCase().endsWith('.xlsx') && !filename.toLowerCase().endsWith('.xls')) {
    filename += '.xlsx';
  }
  
  const excelPath = path.join(cfg.folder, filename);
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
    res.json({ success: true, result: { added: 0, updated: 0 }, rowCount: data.length });
  } catch (e) {
    res.status(500).json({ success: false, error: excelErrorMessage(e) });
  }
});

// Désynchroniser (arrêter la surveillance)
app.delete('/api/gm-excel-config', (req, res) => {
  if (gmWatcher) { clearInterval(gmWatcher); gmWatcher = null; }
  dbSet('gm_excel_config', null);
  res.json({ success: true });
});

// Vérifier la connexion à l'Excel (lecture directe)
app.post('/api/gm-import-excel', (req, res) => {
  const cfg = getGMConfig();
  if (!cfg || !cfg.active) {
    return res.status(400).json({ success: false, error: 'Aucune synchronisation configurée.' });
  }
  try {
    const data = parseGMExcel(cfg);
    dbSet('gm_excel_config', { ...cfg, lastSync: new Date().toISOString() });
    res.json({ success: true, result: { added: 0, updated: 0 }, rowCount: data.length, source: cfg.filename });
  } catch (e) {
    res.status(500).json({ success: false, error: excelErrorMessage(e) });
  }
});

// ─── ROUTES : CRUD KPI MAÇONNERIE ────────────────────────────────────────────────

// Créer ou mettre à jour un KPI (écriture directe dans Excel)
app.post('/api/gm-kpi', requireToken, requireWriteRateLimit, (req, res) => {
  const { year, week, m3, hours, objectifRatio, tempsBeton, tempsAciers, tempsChargement, tempsCentrale, qtAcierFaconne, comment } = req.body;

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
    qtAcierFaconne: qtAcierFaconne !== null && qtAcierFaconne !== '' ? parseFloat(qtAcierFaconne) : null,
    comment: comment.trim()
  };

  try {
    // Vérifier si la semaine existe déjà dans l'Excel
    const existing = parseGMExcel(cfg);
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
    // Vérifier que la ligne existe
    const existing = parseGMExcel(cfg);
    if (!existing.find(k => k.year === year && k.week === week)) {
      return res.status(404).json({ success: false, error: 'KPI introuvable dans l\'Excel.' });
    }

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
    let kpis = parseGMExcel(cfg);

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
    const allKpis = parseGMExcel(cfg);

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

app.put('/api/cbco-excel-config', requireToken, requireWriteRateLimit, (req, res) => {
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

// ─── RH SÉCURITÉ : CONFIG + WATCHER + AUTO-IMPORT ───────────────────────────────

const RH_SECURITY_COMPANIES = [
  { id: 'cbco',      label: 'Concept Bois Côte d\'Opale', filename: 'CBCO_Suivi_Accidents.xlsx' },
  { id: 'charpente', label: 'Goudalle Charpente',          filename: 'GoudalleCharpente_Suivi_Accidents.xlsx' },
  { id: 'macons',    label: 'Nouvelle Goudalle Maçonnerie', filename: 'GoudalleMacons_Suivi_Accidents.xlsx' },
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
    .filter((entry) => /\.(xlsx|xlsm|xls)$/i.test(entry));

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
  const folder = cfg?.folder || '';
  for (const company of RH_SECURITY_COMPANIES) {
    if (!company.filename) continue;
    try {
      allIncidents.push(...parseRHSaisieWorkbook(company, folder));
    } catch (e) {
      console.warn(`[RH-Securite] Erreur lecture ${company.id} (${company.filename}) : ${e.message}`);
    }
  }
  allIncidents.sort((a, b) => String(b.accidentDate || '').localeCompare(String(a.accidentDate || '')));
  return allIncidents;
}

function applyRHSecurityIncidents(incidents) {
  dbSet('rh_security_incidents', incidents);
  return { imported: incidents.length, companies: RH_SECURITY_COMPANIES.length };
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

let rhSecurityWatcher = null;

function startRHSecurityWatcher(cfg) {
  if (rhSecurityWatcher) {
    clearInterval(rhSecurityWatcher);
    rhSecurityWatcher = null;
  }

  const getFingerprints = () => RH_SECURITY_COMPANIES.map((company) => {
    if (!company.filename) return `${company.id}:missing`;
    try {
      const resolved = resolveExistingExcelPath(cfg.folder, company.filename);
      return `${company.id}:${resolved.resolvedFilename}:${fs.statSync(resolved.fullPath).mtimeMs}`;
    } catch {
      return `${company.id}:missing`;
    }
  }).join('|');

  let lastFingerprint = getFingerprints();
  rhSecurityWatcher = setInterval(() => {
    try {
      const nextFingerprint = getFingerprints();
      if (nextFingerprint === lastFingerprint) return;
      lastFingerprint = nextFingerprint;
      const incidents = parseRHSecurityExcels(cfg);
      const result = applyRHSecurityIncidents(incidents);
      dbSet('rh_security_excel_config', {
        ...cfg,
        active: true,
        lastSync: new Date().toISOString(),
        lastSyncResult: result
      });
      console.log(`[RH-Securite] Import OK — ${incidents.length} accident(s) synchronisé(s).`);
    } catch (e) {
      console.error(`[RH-Securite] Erreur watcher : ${e.message}`);
    }
  }, 30000);
}

(function resumeRHSecurityWatcherOnStartup() {
  const cfg = dbGet('rh_security_excel_config', null);
  if (cfg && cfg.active) {
    console.log('[RH-Securite] Reprise de la surveillance au démarrage...');
    startRHSecurityWatcher(cfg);
  }
})();

async function writeAccidentToExcel(folderPath, companyId, data) {
  const company = RH_SECURITY_COMPANIES.find((c) => c.id === companyId);
  if (!company) throw new Error(`Entreprise inconnue : ${companyId}`);

  const resolved = resolveExistingExcelPath(folderPath, company.filename);
  const excelPath = resolved.fullPath;

  // xlsx-populate préserve la mise en forme, les couleurs et les tableaux Excel
  const workbook = await XlsxPopulate.fromFileAsync(excelPath);
  const sheet = workbook.sheet('Saisie');
  if (!sheet) throw new Error('Feuille "Saisie" introuvable dans ' + company.filename);

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

async function updateAccidentInExcel(folderPath, companyId, rowIndex, data) {
  const company = RH_SECURITY_COMPANIES.find((c) => c.id === companyId);
  if (!company) throw new Error(`Entreprise inconnue : ${companyId}`);

  const resolved = resolveExistingExcelPath(folderPath, company.filename);
  const excelPath = resolved.fullPath;

  const workbook = await XlsxPopulate.fromFileAsync(excelPath);
  const sheet = workbook.sheet('Saisie');
  if (!sheet) throw new Error('Feuille "Saisie" introuvable dans ' + company.filename);

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

// ─── RECHERCHE ACCIDENT (fuzzy, léger, depuis le cache) ──────────────────────

app.get('/api/rh-security-search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);

  const normalize = (s) =>
    String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  const terms = normalize(q).split(/\s+/).filter(Boolean);
  const incidents = dbGet('rh_security_incidents', []);
  const modifications = dbGet('rh_security_modifications', {});

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
    modifiedAt: modifications[inc.id]?.modifiedAt || null,
  })));
});

// ─── DÉTAIL D'UN ACCIDENT (chargement lazy au clic) ─────────────────────────

app.get('/api/rh-security-incident/:id', (req, res) => {
  const incidents = dbGet('rh_security_incidents', []);
  const inc = incidents.find((i) => i.id === req.params.id);
  if (!inc) return res.status(404).json({ success: false, error: 'Accident introuvable.' });
  const modifications = dbGet('rh_security_modifications', {});
  res.json({ ...inc, modifiedAt: modifications[inc.id]?.modifiedAt || null });
});

// ─── MODIFICATION D'UN ACCIDENT ───────────────────────────────────────────────

app.put('/api/rh-security-update-accident', requireToken, requireWriteRateLimit, async (req, res) => {
  const cfg = dbGet('rh_security_excel_config', null);
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
    await updateAccidentInExcel(cfg.folder, companyId, rowIndex, data);

    // Enregistrer la date de modification
    const modifications = dbGet('rh_security_modifications', {});
    modifications[id] = { modifiedAt: new Date().toISOString() };
    dbSet('rh_security_modifications', modifications);

    // Re-sync du cache
    const incidents = parseRHSecurityExcels(cfg);
    applyRHSecurityIncidents(incidents);

    res.json({ success: true, incidentCount: incidents.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/rh-security-excel-config', (req, res) => {
  res.json(dbGet('rh_security_excel_config', null));
});

app.put('/api/rh-security-excel-config', requireToken, requireWriteRateLimit, (req, res) => {
  const folder = String(req.body?.folder || '').trim();
  if (!folder) {
    return res.status(400).json({ success: false, error: 'Champ manquant : folder.' });
  }
  try {
    const cfg = { folder, active: true };
    const incidents = parseRHSecurityExcels(cfg);
    const result = applyRHSecurityIncidents(incidents);
    const storedCfg = { ...cfg, lastSync: new Date().toISOString(), lastSyncResult: result };
    dbSet('rh_security_excel_config', storedCfg);
    startRHSecurityWatcher(storedCfg);
    res.json({ success: true, result, incidentCount: incidents.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/rh-security-add-accident', requireToken, requireWriteRateLimit, async (req, res) => {
  const cfg = dbGet('rh_security_excel_config', null);
  if (!cfg || !cfg.active) {
    return res.status(400).json({ success: false, error: "Aucun dossier Excel configure. Connecter d'abord le dossier depuis la page RH admin." });
  }
  const { companyId, nom, dateAccident, gravite } = req.body || {};
  if (!companyId || !nom || !dateAccident || !gravite) {
    return res.status(400).json({ success: false, error: 'Champs obligatoires manquants : companyId, nom, dateAccident, gravite.' });
  }
  try {
    const writeResult = await writeAccidentToExcel(cfg.folder, companyId, req.body);
    const incidents = parseRHSecurityExcels(cfg);
    applyRHSecurityIncidents(incidents);
    res.json({ success: true, ...writeResult, incidentCount: incidents.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/rh-security-excel-config', (req, res) => {
  if (rhSecurityWatcher) {
    clearInterval(rhSecurityWatcher);
    rhSecurityWatcher = null;
  }
  dbSet('rh_security_excel_config', null);
  res.json({ success: true });
});

app.post('/api/rh-security-import-excel', (req, res) => {
  const cfg = dbGet('rh_security_excel_config', null);
  if (!cfg || !cfg.active) {
    return res.status(400).json({ success: false, error: 'Aucune synchronisation configurée.' });
  }
  try {
    const incidents = parseRHSecurityExcels(cfg);
    const result = applyRHSecurityIncidents(incidents);
    dbSet('rh_security_excel_config', { ...cfg, lastSync: new Date().toISOString(), lastSyncResult: result });
    res.json({ success: true, result, incidentCount: incidents.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/rh-security-incidents', (req, res) => {
  res.json(dbGet('rh_security_incidents', []));
});

app.get('/api/rh-security-summary', (req, res) => {
  const incidents = dbGet('rh_security_incidents', []);
  res.json({ success: true, ...computeRHSecuritySummary(incidents) });
});


// Servir les fichiers PDF du planning avec logging
app.use('/server/uploads', (req, res, next) => {
  console.log('[Planning PDF] Accès demandé:', req.path);
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      console.log('[Planning PDF] Fichier servi:', filePath);
    }
  }
}));

// /api/health expose le token de sécurité uniquement aux clients du réseau local.
// Ce token doit être inclus dans toutes les requêtes d'écriture.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', token: SERVER_TOKEN, timestamp: new Date().toISOString() });
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
  const cbcoCfg = dbGet('cbco_excel_config', null);
  if (cbcoCfg && cbcoCfg.active) {
    let excelPath = path.join(cbcoCfg.folder, cbcoCfg.filename);
    if (!fs.existsSync(excelPath)) {
      const candidates = ['.xlsx', '.xlsm', '.xls'];
      const found = candidates.find(ext => fs.existsSync(excelPath + ext));
      if (found) excelPath = excelPath + found;
    }
    if (fs.existsSync(excelPath)) {
      console.log(`✅ [Excel CBCO] Connecté : ${excelPath}`);
    } else {
      console.log(`❌ [Excel CBCO] Fichier introuvable : ${excelPath}`);
    }
  } else {
    console.log(`⚠️  [Excel CBCO] Aucun fichier Excel configuré`);
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
  if (rhCfg && rhCfg.active) {
    console.log(`✅ [Excel RH Sécurité] Dossier : ${rhCfg.folder}`);
    for (const company of RH_SECURITY_COMPANIES) {
      const fp = path.join(rhCfg.folder, company.filename);
      console.log(fs.existsSync(fp) ? `   ✅ ${company.filename}` : `   ❌ ${company.filename} (introuvable)`);
    }
  } else {
    console.log(`⚠️  [Excel RH Sécurité] Aucun dossier configuré`);
  }
  console.log('');
});
