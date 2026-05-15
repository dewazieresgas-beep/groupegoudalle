# Description technique complète — Intranet Groupe Goudalle
**Document destiné à fournir le contexte complet à une IA tierce.**
**Auteur du projet : Gaspard DE WAZIÈRES — Sylve Support — Groupe Goudalle — 2025/2026**

---

## 1. VUE D'ENSEMBLE DU PROJET

Il s'agit d'un **site intranet de pilotage de la performance** développé pour le Groupe Goudalle, un groupe de construction basé en Hauts-de-France spécialisé dans le bois manufacturé, la charpente, la maçonnerie et les services support. Le groupe comprend quatre entités : **Goudalle Charpente**, **CBCO** (production bois industrielle), **Goudalle Maçonnerie**, et **Sylve Support** (services transverses).

Le site permet :
- La **saisie d'indicateurs de performance** par les équipes terrain
- La **centralisation des données** qui étaient auparavant dispersées dans des fichiers Excel isolés
- La **visualisation des performances** via des tableaux de bord par entité et par département
- L'**import automatique de fichiers Excel** depuis des dossiers réseau partagés
- Le **parsing de PDFs fournisseurs** pour extraire des données de facturation

L'objectif est simple : tout doit rester **sur le réseau interne de l'entreprise**, aucune donnée n'est envoyée sur Internet.

---

## 2. ARCHITECTURE GÉNÉRALE

```
Architecture client-serveur locale (intranet uniquement)

[Navigateur utilisateur]
        ↕  HTTP / REST API (réseau local)
[Serveur Node.js / Express — port 3000]
        ↕  lecture/écriture
[Base de données JSON — server/data/goudalle.json]
        ↕  lecture seule (import automatique)
[Dossiers réseau partagés — Z:\, W:\, X:\ (fichiers Excel)]
```

- Le **serveur tourne sur un PC du réseau interne** et sert à la fois les fichiers statiques (HTML/CSS/JS) et l'API REST.
- Le **frontend est en vanilla HTML/CSS/JavaScript**, sans framework.
- La **base de données est un unique fichier JSON** (`server/data/goudalle.json`), lu en mémoire au démarrage et sauvegardé à chaque écriture.
- Le serveur se lance avec un double-clic sur `DEMARRER-SERVEUR.bat`.

---

## 3. STRUCTURE DES FICHIERS

```
groupegoudalle/
├── DEMARRER-SERVEUR.bat          Script de lancement Windows (node server/server.js)
├── INSTALLATION.md               Guide de déploiement complet
├── client/                       Frontend — tout ce que le navigateur charge
│   ├── connexion.html            Page de connexion
│   ├── index.html                Tableau de bord d'accueil (vue groupe)
│   ├── inscription.html          Création de compte
│   ├── assets/                   Logos PNG des 4 entités + smileys sécurité
│   ├── css/
│   │   └── style.css             Feuille de style unique pour tout le site
│   ├── js/
│   │   ├── api.js                Client API — remplace localStorage par des appels serveur
│   │   ├── auth.js               Système d'authentification complet (sessions, rôles, permissions)
│   │   ├── utils.js              Utilitaires partagés
│   │   └── achat-saisie.js       Logique métier spécifique aux achats
│   └── pages/                    22 pages HTML par département
│       ├── achat-controle.html
│       ├── achat-indicateurs.html
│       ├── achat-saisie.html
│       ├── chantiers.html
│       ├── commerce-indicateurs.html
│       ├── commerce-liaison.html
│       ├── compta-indicateurs.html
│       ├── compta-paiements-cbco.html
│       ├── compta-paiements-charpente.html
│       ├── compta-paiements-maconnerie.html
│       ├── compta-saisie.html
│       ├── erreur-acces.html
│       ├── production-indicateurs-generaux.html
│       ├── production-indicateurs-maconnerie.html
│       ├── production-indicateurs-usine-cbco.html
│       ├── production-saisie-maconnerie.html
│       ├── production-saisie-productivite-usine.html
│       ├── profil.html
│       ├── rh-indicateurs.html
│       ├── rh-saisie.html
│       ├── utilisateurs-code-admin.html
│       └── utilisateurs.html
├── server/
│   ├── server.js                 Serveur Node.js/Express — point d'entrée unique
│   ├── package.json              Dépendances NPM
│   ├── package-lock.json
│   └── data/
│       └── goudalle.json         Base de données JSON (toutes les données)
└── tests/
    ├── run_tests.js              Lanceur de tests
    ├── test_auth.js              Tests authentification
    ├── test_collage.js           Tests logique métier collage CBCO
    ├── test_syntax.js            Tests syntaxe JS général
    ├── test_syntax_cbco.js       Tests syntaxe JS CBCO
    └── test_utils.js             Tests utilitaires
```

---

## 4. TECHNOLOGIES ET DÉPENDANCES

### Backend (server/server.js)
| Technologie | Version | Rôle |
|---|---|---|
| Node.js | LTS | Runtime JavaScript serveur |
| Express | 4.18.2 | Framework HTTP / routeur REST |
| cors | 2.8.5 | Middleware CORS (restriction réseau local) |
| xlsx | 0.18.5 | Lecture de fichiers Excel (.xlsx) |
| xlsx-populate | 1.21.0 | Lecture Excel avancée (cellules, feuilles nommées) |
| pdf-parse | 2.4.5 | Extraction de texte brut depuis des PDFs |
| crypto | natif Node | Génération du token de sécurité |
| fs | natif Node | Lecture/écriture fichiers (JSON, Excel) |
| path | natif Node | Gestion des chemins de fichiers |

### Frontend (client/)
- **HTML5** — structure des pages
- **CSS3** — style unique dans `style.css`
- **JavaScript ES6+** vanilla — aucun framework (pas de React, Vue, Angular)
- **localStorage** — utilisé comme fallback et stockage des sessions (intercepté par api.js)
- **Fetch API** — communication avec le serveur

---

## 5. SERVEUR (server/server.js) — DESCRIPTION DÉTAILLÉE

### 5.1 Démarrage et configuration

```javascript
const PORT = process.env.PORT || 3000;
const COMMERCE_EXCEL_FOLDER = process.env.COMMERCE_EXCEL_FOLDER || 'Z:\\03-BE\\Projet en cours\\Mathieu';
```

Le serveur écoute sur le port 3000. Le dossier contenant les fichiers Excel Commerce est configurable via variable d'environnement (`COMMERCE_EXCEL_FOLDER`). Par défaut, il pointe vers un chemin réseau Windows (`Z:\`).

### 5.2 Token de sécurité

```javascript
const SERVER_TOKEN = crypto.randomBytes(32).toString('hex');
```

À chaque démarrage du serveur, un token aléatoire de 32 octets (64 caractères hexadécimaux) est généré. Ce token est exposé via `/api/health` et doit être inclus dans le header `x-goudalle-token` pour **toutes les requêtes d'écriture (PUT)**. Si le serveur redémarre, le token change et les clients doivent en récupérer un nouveau (géré automatiquement par api.js).

### 5.3 Rate limiting

```javascript
const _writeCounters = new Map(); // IP → { count, resetAt }
// Limite : 60 requêtes d'écriture par IP par tranche de 60 secondes
```

Un rate limiter maison protège contre les abus : au-delà de 60 requêtes PUT par minute par adresse IP, le serveur répond 429. Un nettoyage automatique toutes les 5 minutes évite les fuites mémoire.

### 5.4 Base de données JSON

```javascript
const DB_PATH = path.join(__dirname, 'data', 'goudalle.json');
let store = {}; // Chargé en mémoire au démarrage
function saveStore() {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf8');
}
```

Toutes les données sont dans un **unique objet JavaScript `store`** chargé en mémoire. À chaque écriture (`dbSet`), le fichier JSON est réécrit intégralement. Les fonctions utilitaires :
- `dbGet(key, defaultValue)` — lecture avec valeur par défaut
- `dbSet(key, value)` — écriture + sauvegarde immédiate

### 5.5 CORS (restriction réseau local)

```javascript
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // même origine
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    if (/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin)) return callback(null, true);
    callback(new Error('CORS : origine non autorisée'));
  }
}));
```

Seules les origines `localhost`, `127.0.0.1` et les plages d'IP réseau privé (192.168.x.x, 10.x.x.x, 172.16-31.x.x) sont autorisées. Toute requête depuis l'extérieur est rejetée.

### 5.6 Middlewares

- `express.json({ limit: '50mb' })` — parsing JSON avec limite 50 Mo (pour les imports volumineux)
- `requireToken(req, res, next)` — vérifie le header `x-goudalle-token`
- `requireWriteRateLimit(req, res, next)` — applique le rate limiting
- `express.static('../client')` — sert les fichiers HTML/CSS/JS/images du frontend

### 5.7 Routes REST API

Toutes les routes suivent le pattern `GET /api/<ressource>` (lecture libre) et `PUT /api/<ressource>` (écriture protégée par token + rate limit).

| Route | Méthode | Données | Protection |
|---|---|---|---|
| `/api/health` | GET | Token + statut | — |
| `/api/users` | GET/PUT | Objet utilisateurs | PUT : token |
| `/api/admin-code` | GET/PUT | Code admin (string) | GET+PUT : token |
| `/api/audit` | GET/PUT | Tableau d'audit | PUT : token |
| `/api/thresholds` | GET/PUT | Seuils KPI | PUT : token |
| `/api/cbco-productivite` | GET | Données Excel CBCO | — |
| `/api/cbco-securite` | GET/PUT | Incidents sécurité CBCO | PUT : token |
| `/api/rh-security-summary` | GET/PUT | Résumé sécurité RH | PUT : token |
| `/api/sylve-balance` | GET/PUT | Balance âgée Sylve | PUT : token |
| `/api/sylve-ca` | GET/PUT | Chiffre d'affaires Sylve | PUT : token |
| `/api/sylve-paiements` | GET/PUT | Paiements en attente | PUT : token |
| `/api/achats-imports` | GET/PUT | Imports achats (métadonnées) | PUT : token |
| `/api/achats-factures` | GET/PUT | Factures achats | PUT : token |
| `/api/achats-lignes` | GET/PUT | Lignes de factures achats | PUT : token |
| `/api/achats-regles` | GET/PUT | Règles de catégorisation achats | PUT : token |
| `/api/commerce-indicators` | GET | Indicateurs commerce (Excel) | — |
| `/api/achats-pdf` | POST | Import PDF fournisseur | token |
| `/api/cbco-productivite-config` | GET/PUT | Config Excel CBCO | PUT : token |

### 5.8 Import Excel Commerce

```javascript
const COMMERCE_EXCEL_FOLDER = 'Z:\\03-BE\\Projet en cours\\Mathieu';
const COMMERCE_EXCEL_SHEET = 'Indicateur commercial';
const COMMERCE_MIN_YEAR = 2021;
const COMMERCE_CACHE_TTL_MS = 60 * 1000; // 1 minute
```

Le serveur lit automatiquement les fichiers Excel `.xlsx` présents dans le dossier réseau partagé `Z:\`. Un cache par signature de fichier (chemin + date de modification + taille) évite les relectures inutiles. La feuille `Indicateur commercial` est parsée pour extraire les indicateurs commerciaux par année et par semaine.

### 5.9 Import Excel CBCO Productivité

Le fichier Excel CBCO contient **6 feuilles** correspondant aux machines/processus de l'usine :
- `SC` — Speedcut (débit bois, m³/h)
- `Ultra` — machine Ultra (m³/h)
- `Extra` — machine Extra (m²/h, avec volume calculé)
- `Collage` — presse de collage (nombre pressées, temps de pressée)
- `Assemblage` — assemblage caissons (heures réalisées vs théoriques)
- `Qualite` — contrôle qualité (tests, non-conformités, réclamations)

Pour chaque feuille, le parseur :
1. Lit les colonnes configurées (numéro de semaine, année, heures Onaya, heures perdues, cubage, productivité, remarques, cible, TRS, etc.)
2. Calcule les **heures utiles** : `heuresOnaya - heuresPerdues`
3. Calcule la **productivité réelle** : `cubage / heuresUtiles` (si heures utiles > 0)
4. Regroupe par clé `année-semaine`
5. Fusionne toutes les feuilles sur la même clé

Le résultat final est un tableau d'entrées hebdomadaires contenant tous les indicateurs fusionnés.

### 5.10 Parser PDF fournisseur (Achats)

Le serveur inclut un **parser de PDFs fournisseurs** sophistiqué pour extraire les données de facturation. La stratégie :

**Structure d'un PDF fournisseur** (format fixe attendu) :
```
[Ligne d'en-tête facture] : date / numéro FR / fournisseur / montant HT
[Lignes d'articles]       : ressource / BL / ARC / chantier / libellé / unité / qté / PU / montant
[Total Bon]               : montant total de la facture
```

**Fonctions principales** :
- `parsePdfHeaderLine(line)` — détecte et parse les lignes d'en-tête de facture (regex sur format `DD/MM/YYYY FR... montant,HH`)
- `parsePdfArticleLine(line)` — parse les lignes d'articles (ressource, BL, ARC, chantier, libellé, unité, qté, PU, montant)
- `parsePdfTotalLine(line)` — détecte les totaux (Total Bon / Total Chantier / Total Fournisseur)
- `dedupeRepeatedLine(line)` — élimine les doublons de caractères OCR (ex : "FACT FACT" → "FACT")
- `parsePdfInvoiceBlocks(text)` — orchestrateur : assemble les blocs facture et finalise avec un montant robuste

**Logique de robustesse du montant** (`pickRobustInvoiceTotal`) :
Le montant final d'une facture est déterminé hiérarchiquement :
1. Si `Total Bon` est présent → priorité absolue
2. Si `Total Bon` absent mais somme des lignes disponible → la somme est utilisée si le montant en-tête est aberrant (ratio >100x ou <0.01x)
3. Sinon → montant de l'en-tête

**Calcul de volume m³ pour les lignes bois** (`computeVolumeM3FromNorm`) :
- Unité M3 → direct
- Unité M2 + ligne CLT/KLH → `m² × épaisseur (extraite du libellé en mm)`
- Unité U/ENS + ligne CLT/LC → `quantité × section (m²) × longueur (m)` (dimensions extraites du libellé)

**Ventilation des annexes** (`allocateInvoiceLinesByBL`) :
Les frais annexes (transport, éco-contribution, remise) sont ventilés proportionnellement sur les lignes produits, pondérés par volume m³ (si disponible) ou quantité. Sur une facture multi-BL, seules les annexes ayant un BL explicite sont ventilées.

**Normalisation du texte** (`normalizeText`) :
- Remplacement œ→oe, æ→ae
- NFD decomposition + suppression des diacritiques
- Normalisation des espaces
- Mise en minuscules

### 5.11 Utilitaires serveur

- `toNumberFr(raw)` — convertit une chaîne française (virgule décimale, espaces milliers) en nombre
- `normalizeText(str)` — normalise le texte pour des comparaisons insensibles aux accents
- `buildExcelSourceSignature(sourceFiles)` — signature unique d'un ensemble de fichiers (chemin+mtimeMs+size)
- `getCachedExcelRead(cacheName, sourceFiles, reader)` — cache par signature de fichier, évite les relectures
- `isWoodLikeText`, `isCltLineFromNorm`, `isLcLineFromNorm` — classification des lignes d'articles bois
- `isAnnexeText`, `isServiceText` — classification des lignes annexes/prestations
- `extractThicknessMeters` — extrait une épaisseur en mm d'un libellé texte
- `extractSectionLengthForUnitPieces` — extrait section + longueur d'un libellé (formats : cm×cm, mm×mm×mm, triplet sans unité)

---

## 6. CLIENT — api.js (Couche d'abstraction serveur)

### 6.1 Principe

`api.js` **intercepte les appels `localStorage`** au niveau natif en remplaçant `localStorage.getItem`, `localStorage.setItem` et `localStorage.removeItem` par ses propres versions. Cela permet à `auth.js` et aux pages de fonctionner sans aucune modification de leur code, tout en synchronisant les données avec le serveur.

```javascript
localStorage.getItem  = apiGetItem;   // lit depuis le cache serveur
localStorage.setItem  = apiSetItem;   // écrit cache + envoie au serveur
localStorage.removeItem = apiRemoveItem;
```

### 6.2 Cache local

```javascript
const _cache = {}; // clé localStorage → valeur parsée
```

Toutes les données serveur sont chargées en cache au démarrage. Les lectures sont instantanées (cache en mémoire). Les écritures mettent à jour le cache et envoient au serveur en arrière-plan (fire-and-forget).

### 6.3 Correspondance clés → endpoints

```javascript
const KEY_TO_ENDPOINT = {
  'goudalle_users':                  '/users',
  'goudalle_admin_code':             '/admin-code',
  'goudalle_session':                null,  // local only (chaque navigateur a sa propre session)
  'goudalle_thresholds':             '/thresholds',
  'goudalle_cbco_productivite':      '/cbco-productivite',
  'goudalle_cbco_securite':          '/cbco-securite',
  'goudalle_rh_security_summary':    '/rh-security-summary',
  'goudalle_sylve_balance':          '/sylve-balance',
  'goudalle_sylve_ca':               '/sylve-ca',
  'goudalle_sylve_paiements_attente':'/sylve-paiements',
  'goudalle_achats_imports':         '/achats-imports',
  'goudalle_achats_factures':        '/achats-factures',
  'goudalle_achats_lignes':          '/achats-lignes',
  'goudalle_achats_regles':          '/achats-regles',
};
```

### 6.4 Préchargement par page

Chaque page HTML ne charge que les données dont elle a besoin au démarrage (lazy loading intelligent) :

```javascript
const PAGE_PRELOAD_KEYS = {
  'index.html':                         ['goudalle_thresholds', 'goudalle_sylve_balance', 'goudalle_rh_security_summary', 'goudalle_cbco_productivite'],
  'production-indicateurs-usine-cbco.html': ['goudalle_cbco_productivite', 'goudalle_rh_security_summary'],
  'compta-paiements-maconnerie.html':   ['goudalle_sylve_balance', 'goudalle_sylve_paiements_attente'],
  'achat-saisie.html':                  [],  // chargement manuel uniquement (volumétrie importante)
  // ...
};
```

Les pages achats ne préchargent rien (volume trop important), elles font un `loadKeysFromServer()` manuel au moment opportun.

### 6.5 Token de sécurité côté client

Le token serveur est récupéré via `GET /api/health` et stocké dans `_serverToken`. Il est automatiquement inclus dans le header `x-goudalle-token` de toutes les requêtes PUT. Si le serveur retourne 403 (token invalide, ex : redémarrage serveur), le client refetch automatiquement le token et réessaie.

### 6.6 File d'attente des écritures

Si une écriture survient avant que le serveur ait répondu (race condition au démarrage), elle est mise en file `_pendingWrites` (Map endpoint → dernière valeur). Quand le serveur répond, toutes les écritures en attente sont envoyées.

### 6.7 Rafraîchissement automatique

```javascript
setInterval(async () => {
  // Recharge toutes les clés déjà chargées depuis le serveur
  await loadKeysFromServer(keys, { force: true });
  window.dispatchEvent(new CustomEvent('serverDataRefreshed'));
}, 60000); // toutes les 60 secondes
```

Les pages peuvent écouter l'événement `serverDataRefreshed` pour se mettre à jour automatiquement.

### 6.8 Gestion du quota localStorage

Si `localStorage.setItem` lève `QuotaExceededError` (données trop volumineuses, notamment les achats), l'erreur est interceptée : la donnée reste disponible via le cache mémoire et le serveur, sans bloquer l'interface.

---

## 7. CLIENT — auth.js (Authentification)

### 7.1 Stockage des données utilisateurs

```javascript
STORAGE_KEY_SESSION:    'goudalle_session'     // Session active (1 par navigateur)
STORAGE_KEY_USERS:      'goudalle_users'       // Base de tous les utilisateurs (objet JSON)
STORAGE_KEY_ADMIN_CODE: 'goudalle_admin_code'  // Code requis pour créer des rôles privilégiés
SESSION_TIMEOUT: 3600000                        // Expiration session : 1 heure
```

### 7.2 Modèle utilisateur

```javascript
{
  username: 'acgoudalle',
  password: '123',           // Mot de passe en clair (pas de hachage)
  role: 'direction',
  displayName: 'Anne-Cécile Goudalle',
  email: 'ac.goudalle@goudallecharpente.fr',
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'SYSTEM',
  isActive: true,
  customPermissions: ['cbco', 'rh', 'achats']  // optionnel — liste de permissions granulaires
}
```

### 7.3 Rôles et permissions

Le système a **un seul rôle nommé** : `direction`. Les utilisateurs `direction` ont automatiquement accès à **tout** (bypass dans `hasAccess`).

Pour les autres utilisateurs (sans rôle `direction`), l'accès est contrôlé par `customPermissions` : un tableau de chaînes représentant les modules auxquels l'utilisateur a accès (ex : `'cbco'`, `'rh'`, `'achats'`, `'gm'`, `'users_admin'`, etc.).

```javascript
hasAccess(permission) {
  if (role === 'direction') return true;  // bypass total
  return currentUser.customPermissions.includes(permission);
}
```

### 7.4 Rate limiting login (anti brute-force)

- 5 tentatives maximum avant blocage de 15 minutes
- Stocké dans `sessionStorage` (local à l'onglet, non partagé entre PC)
- Réinitialisation automatique après la période de blocage

### 7.5 Session

La session est un objet stocké dans `localStorage` (`goudalle_session`) contenant : username, displayName, email, role, loginAt, lastActivity. La session expire automatiquement 1 heure après `loginAt`. Un timer vérifie l'expiration toutes les 60 secondes et redirige vers la page de connexion si nécessaire.

### 7.6 Compte par défaut

Au premier lancement, un compte est créé automatiquement :
- Username : `acgoudalle`
- Password : `123`
- Rôle : `direction`

### 7.7 Fonctions principales

| Fonction | Description |
|---|---|
| `Auth.login(username, password)` | Authentifie, retourne `{ success, message, user }` |
| `Auth.logout()` | Supprime la session |
| `Auth.isConnected()` | Vérifie session active et non expirée |
| `Auth.requireAuth()` | Redirige vers login si non connecté |
| `Auth.requirePermission(perm)` | Redirige vers erreur-acces.html si accès refusé |
| `Auth.hasAccess(permission)` | Retourne true/false |
| `Auth.registerUser(...)` | Crée un compte (code admin requis pour rôle direction) |
| `Auth.disableUser(username)` | Désactive sans supprimer |
| `Auth.deleteUser(username)` | Supprime définitivement (impossible pour direction) |
| `Auth.changePassword(username, newPwd)` | Change le mot de passe |
| `Auth.updateUserProfile(...)` | Met à jour displayName, email, username |
| `Auth.setAdminCode(code)` | Change le code admin (direction uniquement) |

---

## 8. MODULES MÉTIER (pages HTML)

### 8.1 Production — Usine CBCO (`production-indicateurs-usine-cbco.html`)

Affiche les indicateurs hebdomadaires issus du fichier Excel CBCO :
- Speedcut : m³ débités, heures Onaya, heures perdues, heures utiles, productivité (m³/h), TRS, cible
- Ultra : mêmes métriques
- Extra : m² produits, productivité H/M
- Collage : heures, nombre pressées, temps de pressée, surface collée, nombre caissons
- Assemblage : temps réalisé vs théorique, variation en %
- Qualité : tests réalisés, non-conformités, réclamations clients

### 8.2 Production — Maçonnerie (`production-indicateurs-maconnerie.html`, `production-saisie-maconnerie.html`)

Suivi des chantiers maçonnerie avec saisie manuelle d'indicateurs. Seuils de performance configurables (`goudalle_thresholds`).

### 8.3 RH / Sécurité (`rh-indicateurs.html`, `rh-saisie.html`)

Saisie et visualisation des incidents sécurité. Utilise les smileys visuels (vert/rouge) pour le management visuel. Données dans `goudalle_rh_security_summary` (objet avec entrées hebdomadaires par entité).

### 8.4 Comptabilité — Balance âgée et paiements

Trois pages de paiements (Maçonnerie, Charpente, CBCO) affichant la balance âgée importée depuis le système Sylve. Les données `goudalle_sylve_balance` et `goudalle_sylve_paiements_attente` contiennent les montants en attente par client et par tranche d'échéance.

### 8.5 Commerce (`commerce-indicateurs.html`, `commerce-liaison.html`)

Les indicateurs commerciaux sont lus depuis un fichier Excel réseau (`Z:\03-BE\Projet en cours\Mathieu`) via l'endpoint `/api/commerce-indicators`. La feuille `Indicateur commercial` est parsée. La page liaison commerce permet de lier des chantiers à des devis.

### 8.6 Achats (`achat-saisie.html`, `achat-controle.html`, `achat-indicateurs.html`)

Module le plus complexe du projet :
- **Saisie** (`achat-saisie.js`) : import de PDFs fournisseurs via `/api/achats-pdf`. Le serveur parse le PDF et retourne les blocs factures structurés.
- **Contrôle** : validation et catégorisation des lignes d'achat avec règles configurables (`goudalle_achats_regles`).
- **Indicateurs** : agrégation des achats par fournisseur, par chantier, par catégorie, avec calcul de volumes m³ pour le bois.

### 8.7 Administration utilisateurs

- `utilisateurs.html` — liste des utilisateurs, création, activation/désactivation, suppression, modification des permissions granulaires
- `utilisateurs-code-admin.html` — changement du code admin (direction uniquement)
- `profil.html` — modification du profil personnel

---

## 9. DONNÉES STOCKÉES DANS goudalle.json

```javascript
{
  "users": { "username": { ...userObject } },
  "admin_code": "0000",
  "audit": [ { action, user, timestamp, details } ],
  "thresholds": { "ratioThreshold": 5 },
  "cbco_securite": { /* incidents sécurité CBCO par semaine */ },
  "rh_security_summary": { /* incidents sécurité globaux */ },
  "sylve_balance": { /* balance âgée par entité */ },
  "sylve_ca": { /* CA mensuel par entité */ },
  "sylve_paiements": { /* paiements en attente */ },
  "achats_imports": [ { /* métadonnées des imports PDF */ } ],
  "achats_factures": [ { /* factures parsées */ } ],
  "achats_lignes": [ { /* lignes détaillées */ } ],
  "achats_regles": [ { /* règles de catégorisation */ } ],
  "cbco_productivite_excel_config": {
    "active": true,
    "folder": "W:\\...",
    "filename": "Productivite_CBCO.xlsx"
  }
}
```

---

## 10. MÉCANISMES DE SÉCURITÉ

| Mécanisme | Où | Description |
|---|---|---|
| Token serveur dynamique | server.js / api.js | Généré au démarrage, requis sur tous les PUT |
| CORS réseau local | server.js | Bloque toutes les origines hors réseau privé |
| Rate limiting serveur | server.js | 60 PUT/min/IP, 429 si dépassé |
| Rate limiting login | auth.js | 5 tentatives / 15 min de blocage |
| Timeout requêtes | api.js | 8s pour health, 20s pour chargement, 5s pour écritures |
| Expiration session | auth.js | 1h après login, vérification toutes les 60s |
| Code admin | auth.js | Requis pour créer des rôles privilégiés |
| Token re-fetch auto | api.js | Si 403 (serveur redémarré), re-fetch et réessaie |

**Note importante** : les mots de passe sont stockés **en clair** dans le JSON (pas de hachage). Cela est acceptable pour un intranet fermé sur réseau local mais serait insuffisant pour un système exposé à Internet.

---

## 11. INITIALISATION D'UNE PAGE HTML TYPE

Chaque page HTML suit ce pattern d'initialisation :

```html
<!-- 1. Charger api.js EN PREMIER — intercepte localStorage et démarre la synchro serveur -->
<script src="../js/api.js"></script>
<!-- 2. Charger auth.js — système d'authentification (utilise localStorage intercepté) -->
<script src="../js/auth.js"></script>
<!-- 3. Charger utils.js — utilitaires partagés -->
<script src="../js/utils.js"></script>

<script>
  // 4. Masquer le contenu pendant le chargement (évite le flash non authentifié)
  document.documentElement.style.visibility = 'hidden';

  // 5. Vérifier l'authentification + permission dès que le serveur a répondu
  window.onServerReady(function() {
    if (!Auth.requireAuth()) return;
    Auth.requirePermission('cbco'); // redirige vers erreur-acces.html si refusé
    // Affichage maintenant garanti
  });
</script>
```

---

## 12. TESTS AUTOMATISÉS

```
tests/
├── run_tests.js         Orchestre les 5 suites, affiche résultats colorés, code de sortie 0/1
├── test_auth.js         Teste login, logout, rate limiting, permissions, gestion utilisateurs
├── test_collage.js      Teste la logique de calcul du temps de pressée CBCO
├── test_syntax.js       Vérifie la syntaxe JavaScript des fichiers client (sans navigateur)
├── test_syntax_cbco.js  Vérifie spécifiquement la syntaxe des pages CBCO
└── test_utils.js        Teste les fonctions utilitaires (formatage, calculs, dates)
```

Lancement : `npm test` depuis `server/` ou `node tests/run_tests.js` depuis la racine.

---

## 13. DÉPLOIEMENT

1. Installer Node.js (LTS) sur le PC serveur du réseau interne
2. Copier le dossier `groupegoudalle/` sur le PC serveur
3. Lancer `npm install` dans `server/`
4. Configurer les chemins réseau dans `server.js` (variables `COMMERCE_EXCEL_FOLDER`, etc.)
5. Double-clic sur `DEMARRER-SERVEUR.bat`
6. Accéder depuis n'importe quel PC du réseau via `http://[IP-SERVEUR]:3000`

Le guide complet est dans `INSTALLATION.md`.

---

## 14. POINTS IMPORTANTS POUR LA MAINTENANCE

- **Pour ajouter un indicateur** : créer une route GET/PUT dans server.js, ajouter la clé dans `KEY_TO_ENDPOINT` dans api.js, créer la page HTML correspondante.
- **Pour ajouter une permission** : ajouter la chaîne dans `customPermissions` des utilisateurs concernés depuis la page `utilisateurs.html`.
- **Pour ajouter un nouveau dossier Excel** : configurer le chemin dans server.js et créer la fonction de parsing correspondante sur le modèle de `parseCBCOProdExcel()`.
- **Le cache Excel** est invalidé automatiquement quand la date de modification ou la taille du fichier change (signature `mtimeMs + size`).
- **Le fichier goudalle.json** est réécrit intégralement à chaque écriture. Sur de très gros volumes (>10 000 entrées achats), cela peut devenir lent — envisager SQLite à terme.
- **Les mots de passe sont en clair** dans le JSON. Acceptable pour un intranet fermé.

---

*Fin du document — Gaspard DE WAZIÈRES — Mai 2026*
