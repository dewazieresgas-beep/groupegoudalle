/**
 * API CLIENT - Remplace le localStorage par des appels au serveur central
 * 
 * Ce fichier doit être inclus dans toutes les pages HTML AVANT auth.js et utils.js
 * 
 * Il expose un objet `ServerStorage` qui a la même interface que localStorage
 * mais synchronise les données avec le serveur Node.js.
 * 
 * Configuration : modifier SERVER_URL si le serveur tourne sur un autre port ou IP
 */

// ─── CONFIGURATION ──────────────────────────────────────────────────────────────
// Adresse du serveur Node.js
// En production sur le serveur d'entreprise, remplacer par l'IP du serveur
// Exemple: const SERVER_URL = 'http://192.168.1.50:3000/api';
const SERVER_URL = window.location.origin + '/api';

// ─── CACHE LOCAL (pour la réactivité de l'interface) ────────────────────────────
// Les données sont chargées depuis le serveur au démarrage et mises en cache.
// Chaque écriture met à jour le cache ET envoie au serveur.
const _cache = {};
let _serverAvailable = null; // null = pas encore testé, true/false après test
let _refreshInProgress = false;
let _serverToken = null;      // Token de sécurité reçu depuis /api/health
const _loadedServerKeys = new Set();

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortController === 'undefined') return undefined;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

// ─── CORRESPONDANCE CLÉ localStorage → ENDPOINT API ────────────────────────────
const KEY_TO_ENDPOINT = {
  'goudalle_users':                  '/users',
  'goudalle_admin_code':             '/admin-code',
  'goudalle_session':                null, // Session gardée en localStorage (propre à chaque navigateur)
  'goudalle_kpis':                   '/kpis',
  'goudalle_thresholds':             '/thresholds',
  'goudalle_cbco_data':              '/cbco',
  'goudalle_cbco_productivite':      '/cbco-productivite',
  'goudalle_cbco_securite':          '/cbco-securite',
  'goudalle_cbco_commercial':        '/cbco-commercial',
  'goudalle_sylve_balance':          '/sylve-balance',
  'goudalle_sylve_ca':               '/sylve-ca',
  'goudalle_sylve_paiements_attente':'/sylve-paiements',
  'goudalle_achats_imports':         '/achats-imports',
  'goudalle_achats_factures':        '/achats-factures',
  'goudalle_achats_lignes':          '/achats-lignes',
  'goudalle_achats_regles':          '/achats-regles',
};

// Clés qui restent dans localStorage (état UI local, session)
const LOCAL_ONLY_KEYS = new Set([
  'goudalle_session',
  'gm_sidebar_state',
  'gc_sidebar_state',
  'cbco_sidebar_state',
  'users_sidebar_state',
  'sylve_sidebar_state',
  'GM_TREND_RANGE',
]);

const DEFAULT_PRELOAD_KEYS = [
  'goudalle_users',
  'goudalle_admin_code',
];

const PAGE_PRELOAD_KEYS = {
  'profil.html': ['goudalle_users'],
  'utilisateurs.html': ['goudalle_users'],
  'utilisateurs-code-admin.html': ['goudalle_users'],
  'production-indicateurs-maconnerie.html': ['goudalle_kpis', 'goudalle_thresholds'],
  'production-saisie-maconnerie.html': ['goudalle_kpis', 'goudalle_thresholds'],
  'production-export-maconnerie.html': ['goudalle_kpis', 'goudalle_thresholds'],
  'commerce-indicateurs.html': ['goudalle_cbco_data', 'goudalle_cbco_commercial'],
  'commerce-saisie-ca.html': ['goudalle_cbco_data'],
  'production-indicateurs-usine-cbco.html': ['goudalle_cbco_productivite', 'goudalle_cbco_securite'],
  'production-saisie-productivite-usine.html': ['goudalle_cbco_productivite'],
  'commerce-saisie-indicateurs.html': ['goudalle_cbco_commercial'],
  'compta-indicateurs.html': ['goudalle_sylve_balance', 'goudalle_sylve_ca'],
  'compta-saisie.html': ['goudalle_sylve_balance', 'goudalle_sylve_ca'],
  'compta-paiements-maconnerie.html': ['goudalle_sylve_balance', 'goudalle_sylve_paiements_attente'],
  'compta-paiements-charpente.html': ['goudalle_sylve_balance', 'goudalle_sylve_paiements_attente'],
  'compta-paiements-cbco.html': ['goudalle_sylve_balance', 'goudalle_sylve_paiements_attente'],
  'production-indicateurs-generaux.html': ['goudalle_cbco_productivite'],
  // Les pages achats manipulent de gros volumes historiques.
  // On évite leur préchargement global au démarrage et on laisse chaque page
  // charger uniquement ce dont elle a besoin au moment opportun.
  'achat-indicateurs.html': [],
  'achat-saisie.html': [],
  'achat-controle.html': [],
};

function getCurrentPageName() {
  const path = window.location.pathname || '';
  const filename = path.substring(path.lastIndexOf('/') + 1);
  return filename || 'index.html';
}

function getInitialPreloadKeys() {
  const page = getCurrentPageName();
  return [...new Set([...DEFAULT_PRELOAD_KEYS, ...(PAGE_PRELOAD_KEYS[page] || [])])];
}

// ─── VÉRIFICATION DU SERVEUR ────────────────────────────────────────────────────

async function checkServerAvailable() {
  try {
    const signal = createTimeoutSignal(8000);
    const res = await fetch(
      SERVER_URL + '/health',
      signal ? { method: 'GET', signal, cache: 'no-store' } : { method: 'GET', cache: 'no-store' }
    );
    _serverAvailable = res.ok;
    if (res.ok) {
      // Récupérer le token de sécurité généré au démarrage du serveur.
      // Ce token sera inclus dans toutes les requêtes d'écriture.
      const data = await res.json();
      if (data && data.token) _serverToken = data.token;
    }
  } catch {
    _serverAvailable = false;
  }
  return _serverAvailable;
}

// ─── CHARGEMENT INITIAL DES DONNÉES ────────────────────────────────────────────

/**
 * Charge toutes les données depuis le serveur et les met en cache.
 * À appeler une seule fois au démarrage (dans chaque page).
 */
async function loadAllFromServer() {
  return loadKeysFromServer(getInitialPreloadKeys(), { force: true });
}

/**
 * Charge explicitement un sous-ensemble de clés serveur (lazy loading).
 * Utile pour les collections volumineuses (ex: Achats) afin d'éviter
 * de ralentir toutes les pages.
 * @param {string[]} keys
 * @returns {Promise<boolean>}
 */
async function loadKeysFromServer(keys = [], options = {}) {
  const available = await checkServerAvailable();
  if (!available) return false;

  const force = options && options.force === true;
  const uniqueKeys = [...new Set(keys)]
    .filter(Boolean)
    .filter((key) => KEY_TO_ENDPOINT[key])
    .filter((key) => force || !_loadedServerKeys.has(key));

  if (uniqueKeys.length === 0) {
    return true;
  }

  await Promise.all(uniqueKeys.map(async (key) => {
    const endpoint = KEY_TO_ENDPOINT[key];
    try {
      const signal = createTimeoutSignal(20000);
      const res = await fetch(
        SERVER_URL + endpoint,
        signal ? { method: 'GET', signal, cache: 'no-store' } : { method: 'GET', cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        const isEmptyUsersObject = key === 'goudalle_users'
          && data
          && typeof data === 'object'
          && !Array.isArray(data)
          && Object.keys(data).length === 0;
        if (!isEmptyUsersObject) {
          _cache[key] = data;
        }
        _loadedServerKeys.add(key);
      }
    } catch (e) {
      console.warn(`[API] Impossible de charger la clé ${key}:`, e.message);
    }
  }));
  return true;
}

// ─── ENVOI AU SERVEUR ────────────────────────────────────────────────────────────

async function sendToServer(endpoint, data) {
  if (!_serverAvailable) return;
  try {
    const signal = createTimeoutSignal(5000);
    // Le token de sécurité est inclus dans chaque requête d'écriture.
    // Le serveur rejettera la requête avec 403 si le token est absent ou invalide.
    const headers = { 'Content-Type': 'application/json' };
    if (_serverToken) headers['x-goudalle-token'] = _serverToken;
    await fetch(SERVER_URL + endpoint, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
      ...(signal ? { signal } : {})
    });
  } catch (e) {
    console.warn(`[API] Erreur envoi ${endpoint}:`, e.message);
  }
}

// ─── REMPLACEMENT DU localStorage ───────────────────────────────────────────────

/**
 * Remplace localStorage.getItem()
 * Lit depuis le cache (alimenté par le serveur) ou localStorage pour les clés locales
 */
function apiGetItem(key) {
  // Clés d'état UI : toujours localStorage natif
  if (LOCAL_ONLY_KEYS.has(key) || key.startsWith('submenu_')) {
    return _origGet(key);
  }
  // Si on a la donnée en cache, la retourner
  if (key in _cache) {
    const val = _cache[key];
    return typeof val === 'string' ? val : JSON.stringify(val);
  }
  // Fallback sur localStorage natif si le serveur n'est pas disponible
  return _origGet(key);
}

/**
 * Remplace localStorage.setItem()
 * Écrit dans le cache ET envoie au serveur (sauf pour les clés locales)
 */
function apiSetItem(key, value) {
  // Clés d'état UI : toujours localStorage natif
  if (LOCAL_ONLY_KEYS.has(key) || key.startsWith('submenu_')) {
    _origSet(key, value);
    return;
  }

  // Stocker en cache
  try {
    _cache[key] = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    _cache[key] = value;
  }

  // Envoyer au serveur si un endpoint existe pour cette clé
  const endpoint = KEY_TO_ENDPOINT[key];
  if (endpoint && _serverAvailable) {
    sendToServer(endpoint, _cache[key]);
  }

  // Toujours aussi écrire en localStorage natif (double sécurité / fallback)
  try {
    _origSet(key, value);
  } catch (e) {
    // Jeux de données volumineux (ex: achats) peuvent dépasser le quota navigateur.
    // On conserve alors la donnée en cache + serveur sans bloquer l'interface.
    if (e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message || '')))) {
      console.warn(`[API] Quota localStorage atteint pour ${key}, conservation via cache/serveur uniquement.`);
      return;
    }
    throw e;
  }
}

/**
 * Remplace localStorage.removeItem()
 */
function apiRemoveItem(key) {
  if (LOCAL_ONLY_KEYS.has(key) || key.startsWith('submenu_')) {
    _origRemove(key);
    return;
  }
  delete _cache[key];
  _origRemove(key);
}

// ─── PATCH DU localStorage ───────────────────────────────────────────────────────
// On remplace les méthodes de localStorage par nos versions serveur.
// Cela permet à auth.js et utils.js de fonctionner sans modification.

const _origGet = localStorage.getItem.bind(localStorage);
const _origSet = localStorage.setItem.bind(localStorage);
const _origRemove = localStorage.removeItem.bind(localStorage);

localStorage.getItem = apiGetItem;
localStorage.setItem = apiSetItem;
localStorage.removeItem = apiRemoveItem;

// ─── INITIALISATION ──────────────────────────────────────────────────────────────

/**
 * À appeler au début de chaque page HTML (avant tout autre code).
 * Charge les données depuis le serveur et remplace localStorage.
 * 
 * @returns {Promise<boolean>} true si le serveur est disponible
 */
async function initServerStorage() {
  return await loadKeysFromServer(getInitialPreloadKeys(), { force: true });
}

// Lancer automatiquement au chargement du script
const _serverReady = initServerStorage();

// ─── EXPORT D'UN INDICATEUR DE DISPONIBILITÉ ────────────────────────────────────
// Les pages peuvent attendre que les données soient chargées avant d'afficher
window.serverReady = _serverReady;
window._serverToken = null; // Exposer le token pour les requêtes personnalisées

// Mettre à jour le token exposé quand il est disponible
_serverReady.then(() => {
  window._serverToken = _serverToken;
});

/**
 * Lance une fonction après que le serveur ait chargé toutes les données.
 * Remplace window.addEventListener('load', fn) pour garantir la synchronisation.
 * La fonction est aussi relancée automatiquement à chaque rafraîchissement automatique.
 */
window.onServerReady = function(fn) {
  window.addEventListener('load', async () => {
    await window.serverReady;
    fn();
  });
  window.addEventListener('serverDataRefreshed', () => fn());
};

// API utilitaire exposée aux pages pour lazy-loading ciblé
window.loadServerKeys = loadKeysFromServer;

// ─── RAFRAÎCHISSEMENT AUTOMATIQUE TOUTES LES MINUTES ────────────────────────
const _refreshTimer = setInterval(async () => {
  if (_refreshInProgress) return;
  _refreshInProgress = true;
  try {
    const keysToRefresh = _loadedServerKeys.size > 0
      ? [..._loadedServerKeys]
      : getInitialPreloadKeys();
    const loaded = await loadKeysFromServer(keysToRefresh, { force: true });
    if (loaded) {
      window.dispatchEvent(new CustomEvent('serverDataRefreshed'));
    }
  } finally {
    _refreshInProgress = false;
  }
}, 60000);

// Nettoyage du timer à la fermeture de la page pour éviter les fuites mémoire
window.addEventListener('beforeunload', () => {
  clearInterval(_refreshTimer);
}, { once: true });
