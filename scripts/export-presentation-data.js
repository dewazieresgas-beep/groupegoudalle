const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'server', 'data');
const DB_PATH = path.join(DATA_DIR, 'goudalle.json');
const EXCEL_PATHS_PATH = path.join(DATA_DIR, 'excel-paths.json');
const RH_FOLDER_PATH = path.join(DATA_DIR, 'rh-folder.txt');
const OUT_PATH = path.join(DATA_DIR, 'presentation-data-export.json');
const API_BASE = process.env.PRESENTATION_API_BASE || 'http://localhost:3000/api';

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { __readError: error.message };
  }
}

function readText(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function resolveExcelPath(folder, filename) {
  if (!folder || !filename) return null;
  const candidates = /\.(xlsx|xlsm|xls)$/i.test(filename)
    ? [path.join(folder, filename)]
    : ['.xlsx', '.xlsm', '.xls', ''].map((ext) => path.join(folder, filename + ext));
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found || candidates[0] || null;
}

function fileStatus(fullPath) {
  if (!fullPath) return { fullPath: null, exists: false };
  try {
    const stat = fs.statSync(fullPath);
    return {
      fullPath,
      exists: true,
      lastModified: stat.mtime.toISOString(),
      sizeBytes: stat.size
    };
  } catch {
    return { fullPath, exists: false };
  }
}

function sanitizeUsers(users) {
  const safe = {};
  Object.entries(users || {}).forEach(([username, user]) => {
    safe[username] = {
      ...user,
      password: user && user.password ? '[masque]' : undefined,
      passwordHash: user && user.passwordHash ? '[masque]' : undefined
    };
    Object.keys(safe[username]).forEach((key) => safe[username][key] === undefined && delete safe[username][key]);
  });
  return safe;
}

function count(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return value == null ? 0 : 1;
}

function summarizeSylveBalance(balance) {
  const result = {};
  ['cbco', 'gc', 'gm'].forEach((company) => {
    const imports = Array.isArray(balance?.[company]) ? balance[company] : [];
    result[company] = {
      imports: imports.length,
      clients: imports.reduce((sum, item) => sum + count(item.clients), 0),
      latestImport: imports[0]
        ? {
            id: imports[0].id,
            mois: imports[0].mois,
            annee: imports[0].annee,
            periode: imports[0].periode || '',
            clients: count(imports[0].clients)
          }
        : null
    };
  });
  return result;
}

async function fetchApi(endpoint) {
  const url = API_BASE + endpoint;
  try {
    const response = await fetch(url, { method: 'GET' });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return {
      ok: response.ok,
      status: response.status,
      endpoint,
      fetchedAt: new Date().toISOString(),
      payload
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      endpoint,
      fetchedAt: new Date().toISOString(),
      error: error.message
    };
  }
}

async function fetchExcelSnapshots(fetchPlan) {
  const entries = await Promise.all(fetchPlan.map(async (item) => {
    const result = await fetchApi(item.endpoint);
    return [item.target, result];
  }));
  return Object.fromEntries(entries);
}

const db = readJson(DB_PATH, {});
const excelBackups = readJson(EXCEL_PATHS_PATH, {});
const rhFolderBackup = readText(RH_FOLDER_PATH);

const excelLinks = {
  gmProductiviteMaconnerie: {
    label: 'Production - Goudalle Maconnerie',
    configKey: 'gm_excel_config',
    config: db.gm_excel_config || excelBackups.gm || null,
    source: 'Excel reseau, lu et ecrit par le serveur',
    api: {
      config: '/api/gm-excel-config',
      data: '/api/gm-kpis-by-period',
      periods: '/api/gm-available-periods',
      write: '/api/gm-kpi'
    },
    sheet: (db.gm_excel_config || excelBackups.gm || {}).sheet || 'Donnees indicateurs',
    columns: {
      A: 'year',
      B: 'week',
      C: 'm3',
      D: 'hours',
      E: 'objectifRatio',
      F: 'tempsBeton',
      G: 'tempsAciers',
      H: 'tempsChargement',
      I: 'tempsCentrale',
      J: 'tempsChantier',
      K: 'qtAcierFaconne',
      L: 'comment'
    }
  },
  cbcoProductiviteUsine: {
    label: 'Production - Usine CBCO',
    configKey: 'cbco_productivite_excel_config',
    config: db.cbco_productivite_excel_config || excelBackups.cbco_productivite || null,
    source: 'Excel reseau lu par le serveur',
    api: {
      config: '/api/cbco-productivite-excel-config',
      data: '/api/cbco-productivite'
    },
    sheets: {
      sc: 'Speedcut',
      ultra: 'Ultra',
      extra: 'Extra',
      collage: 'Collage',
      assemblage: 'Assemblage',
      qualite: 'Qualite'
    },
    extractedFields: [
      'week',
      'year',
      'speedcutM3',
      'speedcutProductivite',
      'ultraM3',
      'ultraProductivite',
      'extraM2',
      'extraProductivite',
      'collagePresses',
      'collageSurface',
      'assemblageTempsRealise',
      'qualiteTests',
      'qualiteNonConformites'
    ]
  },
  rhSecurite: {
    label: 'RH - Accidents du travail',
    configKey: 'rh_security_excel_config',
    config: db.rh_security_excel_config || (rhFolderBackup ? { folder: rhFolderBackup, active: true } : null),
    source: 'Dossier Excel reseau, un fichier par societe',
    api: {
      config: '/api/rh-security-excel-config',
      incidents: '/api/rh-security-incidents',
      summary: '/api/rh-security-summary',
      search: '/api/rh-security-search',
      add: '/api/rh-security-add-accident'
    },
    files: [
      { id: 'cbco', label: "Concept Bois Cote d'Opale", filename: 'CBCO_Suivi_Accidents.xlsx' },
      { id: 'charpente', label: 'Goudalle Charpente', filename: 'GoudalleCharpente_Suivi_Accidents.xlsx' },
      { id: 'macons', label: 'Goudalle Maçonnerie', filename: 'GoudalleMacons_Suivi_Accidents.xlsx' },
      { id: 'sylve', label: 'Sylve Data', filename: 'SylveData_Suivi_Accidents.xlsx' }
    ],
    sheet: 'Saisie',
    columns: {
      A: 'numero',
      B: 'nom',
      C: 'prenom',
      D: 'statut',
      E: 'accidentDate',
      F: 'type',
      G: 'gravite',
      H: 'cause',
      I: 'description',
      J: 'debutArret',
      K: 'finArret',
      L: 'prolongation',
      M: 'stopDays',
      N: 'soins',
      O: 'debutSoins',
      P: 'finSoins',
      Q: 'siege',
      R: 'nature'
    }
  },
  commerceIndicateurs: {
    label: 'Commerce - Indicateurs commerciaux',
    config: {
      folder: process.env.COMMERCE_EXCEL_FOLDER || 'Z:\\03-BE\\Projet en cours\\Mathieu',
      sheet: 'Indicateur commercial'
    },
    source: 'Dernier fichier Excel detecte automatiquement dans le dossier',
    api: {
      data: '/api/commerce-indicators',
      status: '/api/commerce-link-status'
    },
    requiredSheets: ['Rappels', 'En Cours', 'Termines', 'Indicateur commercial'],
    extractedFields: [
      'year',
      'month',
      'fiscalYear',
      'enCoursKeur',
      'terminesKeur',
      'totalKeur',
      'monthLabel'
    ]
  },
  appelsOffres: {
    label: "Commerce - Appels d'offre",
    configKey: 'ao_excel_config',
    config: db.ao_excel_config || excelBackups.ao || null,
    source: 'Excel reseau configure depuis la page Liaison Excel',
    api: {
      config: '/api/ao-excel-config',
      data: '/api/ao-indicateurs'
    },
    extractedFields: [
      'nom',
      'client',
      'typePrincipal',
      'responsable',
      'status',
      'dateEntree',
      'effectiveDate',
      'fiscalYear',
      'montant'
    ]
  },
  comptaBalanceAgee: {
    label: 'Comptabilite - Balance agee Sage',
    storageKey: 'sylve_balance',
    source: 'Fichier Excel importe manuellement dans le navigateur puis synchronise en JSON serveur',
    api: {
      data: '/api/sylve-balance',
      ca: '/api/sylve-ca',
      paiements: '/api/sylve-paiements'
    },
    companies: [
      { id: 'cbco', label: 'CBCO' },
      { id: 'gc', label: 'Goudalle Charpente' },
      { id: 'gm', label: 'Goudalle Maconnerie' }
    ],
    columns: {
      C: 'compte',
      D: 'client',
      G: 'soldeCompte',
      I: 'nonEchu',
      K: 'j1_30',
      N: 'j31_45',
      P: 'j46_60',
      R: 'j61_plus'
    }
  },
  chantiers: {
    label: 'Chantiers',
    configKey: 'chantiers_excel_config',
    config: db.chantiers_excel_config || null,
    source: 'Configuration presente dans la base JSON, endpoints non identifies dans server.js'
  }
};

Object.values(excelLinks).forEach((link) => {
  if (link.config?.folder && link.config?.filename) {
    link.fileStatus = fileStatus(resolveExcelPath(link.config.folder, link.config.filename));
  }
  if (link.config?.folder && Array.isArray(link.files)) {
    link.files = link.files.map((file) => ({
      ...file,
      fileStatus: fileStatus(resolveExcelPath(link.config.folder, file.filename))
    }));
  }
});

const databaseCollections = {
  rh_security_excel_config: db.rh_security_excel_config || null,
  gm_excel_config: db.gm_excel_config || null,
  cbco_productivite_excel_config: db.cbco_productivite_excel_config || null,
  ao_excel_config: db.ao_excel_config || null,
  chantiers_excel_config: db.chantiers_excel_config || null,
  sylve_balance: db.sylve_balance || { cbco: [], gc: [], gm: [] },
  sylve_ca: db.sylve_ca || { cbco: 0, gc: 0, gm: 0, bilanDate: '' },
  sylve_paiements: db.sylve_paiements || {},
  users: sanitizeUsers(db.users || {})
};

const apiFetchPlan = [
  { target: 'gmProductiviteMaconnerie.data', method: 'GET', endpoint: '/gm-kpis-by-period?force=1', responsePath: 'payload.kpis' },
  { target: 'gmProductiviteMaconnerie.periods', method: 'GET', endpoint: '/gm-available-periods?force=1', responsePath: 'payload' },
  { target: 'cbcoProductiviteUsine.data', method: 'GET', endpoint: '/cbco-productivite?force=1', responsePath: 'payload.entries' },
  { target: 'rhSecurite.incidents', method: 'GET', endpoint: '/rh-security-incidents', responsePath: 'payload' },
  { target: 'rhSecurite.summary', method: 'GET', endpoint: '/rh-security-summary', responsePath: 'payload' },
  { target: 'commerceIndicateurs.data', method: 'GET', endpoint: '/commerce-indicators?force=1', responsePath: 'payload.rows' },
  { target: 'commerceIndicateurs.status', method: 'GET', endpoint: '/commerce-link-status?force=1', responsePath: 'payload' },
  { target: 'appelsOffres.data', method: 'GET', endpoint: '/ao-indicateurs?force=1', responsePath: 'payload.records' },
  { target: 'appelsOffres.config', method: 'GET', endpoint: '/ao-excel-config', responsePath: 'payload' },
  { target: 'cbcoProductiviteUsine.config', method: 'GET', endpoint: '/cbco-productivite-excel-config', responsePath: 'payload' },
  { target: 'gmProductiviteMaconnerie.config', method: 'GET', endpoint: '/gm-excel-config', responsePath: 'payload' },
  { target: 'rhSecurite.config', method: 'GET', endpoint: '/rh-security-excel-config', responsePath: 'payload' }
];

async function main() {
  const excelSnapshots = await fetchExcelSnapshots(apiFetchPlan);

  const exportData = {
    meta: {
      generatedAt: new Date().toISOString(),
      generatedBy: 'scripts/export-presentation-data.js',
      apiBase: API_BASE,
      purpose: 'Donnees actuelles, liaisons Excel et snapshots Excel pour construire presentation.html hors serveur',
      notes: [
        'Les utilisateurs sont conserves pour presenter les roles mais les mots de passe sont masques.',
        'excelSnapshots contient les reponses API recuperees au moment de l export, donc les donnees Excel parsees si le serveur y avait acces.',
        'Les champs fileStatus indiquent si les fichiers reseau sont accessibles depuis ce poste au moment de l export.'
      ]
    },
    databaseSummary: Object.fromEntries(
      Object.entries(databaseCollections).map(([key, value]) => [key, { count: count(value) }])
    ),
    presentationReadyData: {
      compta: {
        balanceAgee: databaseCollections.sylve_balance,
        caReference: databaseCollections.sylve_ca,
        paiementsEnAttente: databaseCollections.sylve_paiements,
        summary: summarizeSylveBalance(databaseCollections.sylve_balance)
      },
      utilisateurs: databaseCollections.users
    },
    excelLinks,
    apiFetchPlan,
    excelSnapshots,
    rawDatabaseCollections: databaseCollections
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(exportData, null, 2), 'utf8');
  console.log(`Export presentation genere : ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
