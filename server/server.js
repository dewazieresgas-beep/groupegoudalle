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

function extractThicknessMeters(raw) {
  const txt = normalizeText(raw);
  const m = txt.match(/(\d{2,3}(?:[.,]\d+)?)\s*mm\b/);
  if (!m) return null;
  const mm = parseFloat(String(m[1]).replace(',', '.'));
  return Number.isFinite(mm) && mm > 0 ? mm / 1000 : null;
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

function computeVolumeM3FromNorm(line) {
  const qte = Number(line.qte_fact);
  if (!Number.isFinite(qte) || qte <= 0) return null;
  const unite = String(line.unite || '').toUpperCase();
  if (unite === 'M3') return qte;
  if (unite === 'M2' && isCltLineFromNorm(line)) {
    const ep = extractThicknessMeters([line.ressource, line.libelle_ligne].filter(Boolean).join(' '));
    if (!ep) return null;
    return qte * ep;
  }
  return null;
}

function allocateInvoiceLinesByBL(normalizedInvoiceLines, batchId, invoiceId) {
  const grouped = new Map();
  for (const l of normalizedInvoiceLines) {
    const key = l.bl_numero || `NO_BL_${invoiceId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(l);
  }

  const results = [];
  for (const [bl, lines] of grouped.entries()) {
    const products = lines.filter((l) => l.type_technique === 'product');
    const annexes = lines.filter((l) => l.type_technique === 'annexe');
    const extraByProductId = new Map(products.map((p) => [p.id, 0]));

    for (const annexe of annexes) {
      const amount = Number(annexe.montant) || 0;
      if (!products.length || amount === 0) continue;

      const volWeights = products.map((p) => ({ id: p.id, w: computeVolumeM3FromNorm(p) || 0 })).filter((x) => x.w > 0);
      const qtyWeights = products.map((p) => ({ id: p.id, w: Number(p.qte_fact) || 0 })).filter((x) => x.w > 0);
      const weights = volWeights.length ? volWeights : (qtyWeights.length ? qtyWeights : products.map((p) => ({ id: p.id, w: 1 })));
      const sumW = weights.reduce((a, b) => a + b.w, 0) || 1;

      for (const w of weights) {
        const part = amount * (w.w / sumW);
        extraByProductId.set(w.id, (extraByProductId.get(w.id) || 0) + part);
      }
    }

    for (const l of lines) {
      const extra = extraByProductId.get(l.id) || 0;
      const base = Number(l.montant) || 0;
      const isProduct = l.type_technique === 'product';
      results.push({
        id: `alloc_${l.id}`,
        normalized_line_id: l.id,
        raw_invoice_id: invoiceId,
        batch_id: batchId,
        allocated_montant: isProduct ? (base + extra) : base,
        base_montant: base,
        allocated_extra: isProduct ? extra : 0,
        allocation_key: annexes.length ? 'BL' : 'none',
        allocation_details: annexes.length ? `BL=${bl}; annexes=${annexes.length}` : null,
        volume_m3: computeVolumeM3FromNorm(l),
        active_for_indicators: Number(l.excluded_from_indicators || 0) ? 0 : (l.type_technique === 'annexe' ? 0 : 1)
      });
    }
  }
  return results;
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

  dbSet('achats_v2_import_batches', importBatches.filter((b) => b.id !== batchId));
  dbSet('achats_v2_raw_invoices', rawInvoices.filter((r) => r.batch_id !== batchId));
  dbSet('achats_v2_raw_invoice_lines', dbGet('achats_v2_raw_invoice_lines', []).filter((l) => !rawInvoiceIds.has(l.raw_invoice_id)));
  dbSet('achats_v2_normalized_invoice_lines', dbGet('achats_v2_normalized_invoice_lines', []).filter((l) => !rawInvoiceIds.has(l.raw_invoice_id)));
  dbSet('achats_v2_allocated_invoice_lines', dbGet('achats_v2_allocated_invoice_lines', []).filter((l) => !rawInvoiceIds.has(l.raw_invoice_id)));
  dbSet('achats_v2_invoice_render_cache', dbGet('achats_v2_invoice_render_cache', []).filter((r) => r.batch_id !== batchId));
  dbSet('achats_v2_invoice_versions', dbGet('achats_v2_invoice_versions', []).filter((v) => !rawInvoiceIds.has(v.raw_invoice_id)));
  dbSet('achats_v2_anomaly_logs', dbGet('achats_v2_anomaly_logs', []).filter((a) => a.batch_id !== batchId));

  return res.json({ success: true, deleted_batch_id: batchId });
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
        const isAnnexe = isAnnexeText(normText);
        const isService = !isAnnexe && isServiceText(normText);
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
    const ver = versionByInvoice.get(inv.id);
    if (ver && ver.status === 'neutralized') continue;
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
