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
  'goudalle_audit':                  '/audit',
  'goudalle_session':                null, // Session gardée en localStorage (propre à chaque navigateur)
  'goudalle_kpis':                   '/kpis',
  'goudalle_thresholds':             '/thresholds',
  'goudalle_cbco_data':              '/cbco',
  'goudalle_cbco_commercial':        '/cbco-commercial',
  'goudalle_sylve_balance':          '/sylve-balance',
  'goudalle_sylve_ca':               '/sylve-ca',
  'goudalle_sylve_paiements_attente':'/sylve-paiements',
  'goudalle_reminder_config':        '/reminders-config',
  'goudalle_reminders_sent':         '/reminders-sent',
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

// ─── VÉRIFICATION DU SERVEUR ────────────────────────────────────────────────────

async function checkServerAvailable() {
  try {
    const signal = createTimeoutSignal(3000);
    const res = await fetch(SERVER_URL + '/health', signal ? { method: 'GET', signal } : { method: 'GET' });
    _serverAvailable = res.ok;
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
  const available = await checkServerAvailable();
  if (!available) {
    console.warn('[API] Serveur non disponible - utilisation du localStorage de secours');
    return false;
  }

  const endpoints = [
    ['/users',           'goudalle_users'],
    ['/admin-code',      'goudalle_admin_code'],
    ['/audit',           'goudalle_audit'],
    ['/kpis',            'goudalle_kpis'],
    ['/thresholds',      'goudalle_thresholds'],
    ['/cbco',            'goudalle_cbco_data'],
    ['/cbco-commercial', 'goudalle_cbco_commercial'],
    ['/sylve-balance',   'goudalle_sylve_balance'],
    ['/sylve-ca',        'goudalle_sylve_ca'],
    ['/sylve-paiements', 'goudalle_sylve_paiements_attente'],
    ['/reminders-config','goudalle_reminder_config'],
    ['/reminders-sent',  'goudalle_reminders_sent'],
  ];

  await Promise.all(endpoints.map(async ([endpoint, key]) => {
    try {
      const res = await fetch(SERVER_URL + endpoint);
      if (res.ok) {
        const data = await res.json();
        // Ne pas écraser avec des données vides (ex: users={} au premier démarrage)
        const isEmpty = (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0)
                     || (Array.isArray(data) && data.length === 0 && key === 'goudalle_audit');
        if (!isEmpty || key !== 'goudalle_users') {
          _cache[key] = data;
        }
      }
    } catch (e) {
      console.warn(`[API] Impossible de charger ${endpoint}:`, e.message);
    }
  }));

  console.log('[API] Données chargées depuis le serveur ✅');
  return true;
}

// ─── ENVOI AU SERVEUR ────────────────────────────────────────────────────────────

async function sendToServer(endpoint, data) {
  if (!_serverAvailable) return;
  try {
    const signal = createTimeoutSignal(5000);
    await fetch(SERVER_URL + endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
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
  _origSet(key, value);
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
  return await loadAllFromServer();
}

// Lancer automatiquement au chargement du script
const _serverReady = initServerStorage();

// ─── EXPORT D'UN INDICATEUR DE DISPONIBILITÉ ────────────────────────────────────
// Les pages peuvent attendre que les données soient chargées avant d'afficher
window.serverReady = _serverReady;

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

// ─── RAFRAÎCHISSEMENT AUTOMATIQUE TOUTES LES MINUTES ────────────────────────
setInterval(async () => {
  await loadAllFromServer();
  window.dispatchEvent(new CustomEvent('serverDataRefreshed'));
}, 60000);
