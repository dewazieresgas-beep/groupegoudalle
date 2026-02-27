# 🏗️ Architecture - Intranet Goudalle

## Vue d'ensemble

Prototype d'intranet 100% statique avec simulation d'authentification et de base de données via `localStorage`.

---

## 📊 Diagramme de flux

```
┌─────────────────┐
│  Utilisateur    │
│  non connecté   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  /pages/login   │◄─── Redirection auto si non authentifié
│    .html        │
└────────┬────────┘
         │ Login réussi
         ▼
┌─────────────────┐
│  /index.html    │──┐
│  (Accueil)      │  │
└────────┬────────┘  │
         │           │
         ├───────────┼────► /pages/gm.html (Dashboard GM)
         │           │
         ├───────────┼────► /pages/gm-admin.html (Référent)
         │           │
         ├───────────┼────► /pages/account.html (Mon compte)
         │           │
         └───────────┴────► Déconnexion → /pages/login.html
```

---

## 🗂️ Structure des données (localStorage)

### 1. Session utilisateur
**Key** : `intranet_session_v1`
```json
{
  "username": "julie",
  "role": "gm_referent",
  "access": ["gm"],
  "displayName": "Julie Dupont",
  "loginAt": "2026-02-27T10:00:00Z"
}
```

### 2. Utilisateurs
**Key** : `intranet_users_v1`
```json
[
  {
    "username": "acgoudalle",
    "password": "123",
    "role": "direction",
    "access": ["all"],
    "displayName": "A.C. Goudalle"
  }
]
```

### 3. KPI hebdomadaires
**Key** : `kpi_gm_weekly_v1`
```json
[
  {
    "id": "gm_2026_w08",
    "year": 2026,
    "week": 8,
    "m3": 195.50,
    "hours": 882.75,
    "comment": "Semaine courte...",
    "status": "published",
    "createdAt": "2026-02-24T10:00:00Z",
    "createdBy": "julie",
    "updatedAt": "2026-02-24T10:00:00Z",
    "updatedBy": "julie"
  }
]
```

### 4. Historique (audit trail)
**Key** : `kpi_gm_history_v1`
```json
[
  {
    "id": "hist_001",
    "kpiId": "gm_2026_w04",
    "changedAt": "2026-01-27T16:45:00Z",
    "changedBy": "julie",
    "oldValue": { "m3": 200, "hours": 1050, "comment": "...", "status": "draft" },
    "newValue": { "m3": 210, "hours": 1050, "comment": "...", "status": "published" },
    "reason": "Correction après validation"
  }
]
```

### 5. Seuils smiley
**Key** : `kpi_gm_thresholds_v1`
```json
{
  "greenMax": 4.5,
  "orangeMax": 5.5,
  "updatedAt": "2026-01-01T00:00:00Z",
  "updatedBy": "acgoudalle"
}
```

### 6. Flag d'initialisation
**Key** : `intranet_initialized_v1`
```
"true"
```

---

## 🔐 Modèle RBAC (Role-Based Access Control)

| Rôle | Username | Accès GM | Édition GM | Pages accessibles |
|------|----------|----------|------------|-------------------|
| **Direction** | `acgoudalle` | ✅ | ✅ | Toutes |
| **Référent GM** | `julie` | ✅ | ✅ | index, gm, gm-admin, account |
| **Lecture seule** | `gaspard` | ✅ | ❌ | index, gm, account |

### Règles de permission

```javascript
// Accès à /pages/gm.html
hasGMAccess() = access.includes('all') || access.includes('gm')

// Accès à /pages/gm-admin.html
canEditGM() = role === 'direction' || role === 'gm_referent'

// Mode lecture seule
isReadOnly() = role === 'gm_lecture'
```

---

## 📐 Calculs métier

### h/m³ (ratio)
```javascript
h_per_m3 = hours / m3
// Arrondi à 2 décimales
// Si m3 = 0 → afficher "—"
```

### Smiley
```javascript
if (h_per_m3 < greenMax)       → 🟢 Vert
if (greenMax ≤ h_per_m3 ≤ orangeMax) → 🟠 Orange
if (h_per_m3 > orangeMax)      → 🔴 Rouge
if (m3 = 0)                    → ⚪ None
```

### Moyenne du mois
```javascript
// Moyenne des h/m³ des 4 semaines précédant la semaine passée
// Ignorer les semaines non publiées
// Ignorer les semaines avec m3 = 0
moyenne = sum(ratios) / count(ratios_valides)
```

---

## 🗓️ Gestion des semaines ISO 8601

### Calcul de la semaine
- Norme ISO 8601 : semaine 1 = première semaine avec jeudi
- Semaines numérotées de 01 à 52 (ou 53 certaines années)

### Semaine passée
```javascript
// Semaine actuelle - 1
today = new Date()
lastWeek = new Date(today - 7 jours)
isoWeek = getISOWeek(lastWeek)
```

### Formatage
```javascript
// Toujours avec zéro devant
week = 3  → "03"
week = 12 → "12"
```

---

## 🎨 Composants UI

### Sidebar (menu latéral)
- Toujours visible sur pages protégées
- Badge utilisateur (nom + rôle)
- Menu conditionnel (GM Référent si autorisé)
- Badge prototype en bas

### Cards (cartes)
- En-tête avec titre + actions
- Corps avec contenu
- Ombre légère pour effet de relief

### KPI Boxes
- Affichage visuel des indicateurs
- Bordure gauche colorée (vert/orange/rouge)
- Label / Valeur / Unité / Smiley

### Graphiques (Chart.js)
- Type : Line chart
- Données : 8 dernières semaines
- Axe Y : h/m³
- Responsive

### Tableaux
- En-tête fixe coloré
- Lignes alternées au survol
- Badges pour statuts (draft/published)
- Actions en dernière colonne

---

## 🔄 Cycle de vie des données

### Initialisation (première visite)
1. Vérifier `intranet_initialized_v1`
2. Si absent → `fetch('/data/seed.json')`
3. Injecter dans localStorage
4. Marquer comme initialisé

### Authentification
1. Comparer username/password avec `intranet_users_v1`
2. Si valide → créer session dans `intranet_session_v1`
3. Rediriger vers `/index.html`

### Modification de KPI
1. Charger KPI existant
2. Sauvegarder oldValue dans historique
3. Mettre à jour KPI avec newValue
4. Sauvegarder dans localStorage

### Publication
1. Changer `status` de "draft" → "published"
2. Créer entrée dans historique
3. KPI devient visible sur dashboards

---

## 🚀 Points de migration vers API

### Authentification
```javascript
// AVANT (localStorage)
Auth.login(username, password)

// APRÈS (API)
fetch('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username, password })
})
```

### Récupération KPI
```javascript
// AVANT (localStorage)
StorageManager.getKPIWeekly()

// APRÈS (API)
fetch('/api/kpi/weekly')
  .then(res => res.json())
```

### Sauvegarde KPI
```javascript
// AVANT (localStorage)
StorageManager.saveKPI(kpi, username)

// APRÈS (API)
fetch('/api/kpi', {
  method: 'POST',
  body: JSON.stringify(kpi)
})
```

**Note** : Les fonctions métier (`KPICalculator`, `WeekUtils`, `UI`) restent inchangées.

---

## 📦 Dépendances externes

### Chart.js (CDN)
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

**Utilisé pour** : Graphiques de tendance h/m³

**Alternative** : Peut être remplacé par D3.js, Recharts, ApexCharts, etc.

---

## 🧩 Modules JavaScript

### `app.js` - Structure

```
app.js
├── Constants (STORAGE_KEYS)
├── WeekUtils (calculs semaines ISO)
├── KPICalculator (calculs h/m³, smiley, moyennes)
├── StorageManager (CRUD localStorage)
├── Auth (login, logout, session, permissions)
├── UI (génération sidebar, formatage)
└── App (initialisation, navigation)
```

### Fonctions exportées globalement
```javascript
window.App
window.Auth
window.StorageManager
window.WeekUtils
window.KPICalculator
window.UI
```

---

## 🎯 Principes de conception

### Séparation des responsabilités
- **Auth** : Gestion de l'authentification uniquement
- **StorageManager** : Abstraction du stockage (peut être remplacé par API)
- **KPICalculator** : Logique métier pure (pas de dépendance localStorage)
- **UI** : Génération de HTML uniquement

### Immutabilité simulée
- Les données sont récupérées, modifiées, puis sauvegardées
- Pas de mutation directe du localStorage

### Convention de nommage
- **Clés localStorage** : `prefix_entity_version` (ex: `kpi_gm_weekly_v1`)
- **ID des KPI** : `gm_YYYY_wWW` (ex: `gm_2026_w08`)
- **ID historique** : `hist_timestamp` (ex: `hist_1709035200000`)

---

## 📈 Performance

### Optimisations
- Pas de requêtes réseau (sauf seed.json initial)
- Tout en mémoire (localStorage)
- Pas de framework lourd (vanilla JS)

### Limites
- localStorage limité à ~5-10 Mo
- Pas de pagination (toutes les semaines chargées)
- Pas de cache côté serveur (n/a)

---

## 🔒 Sécurité (prototype)

### ⚠️ Limitations connues
- Mots de passe en clair dans `seed.json`
- Pas de HTTPS obligatoire
- Pas de protection CSRF
- Session stockée en clair dans localStorage
- Pas d'expiration de session

### ✅ Pour la production
- Hacher les mots de passe (bcrypt, argon2)
- Utiliser JWT avec cookies httpOnly
- Implémenter HTTPS
- Ajouter tokens CSRF
- Expiration de session (timeout)
- Rate limiting sur login

---

## 📱 Responsive Design

### Breakpoints
```css
/* Desktop */
@media (min-width: 769px) {
  sidebar: largeur fixe 260px
  main: margin-left 260px
}

/* Mobile */
@media (max-width: 768px) {
  sidebar: pleine largeur
  main: margin-left 0
  grid: 1 colonne
}
```

---

## 🧪 Stratégie de test

### Tests manuels
- Checklist dans `TESTS.md`
- ~80 tests couvrant toutes les fonctionnalités

### Tests automatisés (à implémenter)
```javascript
// Exemple avec Jest
test('KPICalculator.calculateRatio', () => {
  expect(calculateRatio(450, 100)).toBe(4.50);
  expect(calculateRatio(0, 0)).toBeNull();
});
```

---

## 📚 Glossaire

| Terme | Définition |
|-------|------------|
| **h/m³** | Heures de travail par mètre cube coulé (indicateur de productivité) |
| **Draft** | KPI enregistré mais non publié (invisible sur dashboards) |
| **Published** | KPI validé et visible sur les dashboards |
| **Semaine ISO** | Norme ISO 8601 de numérotation des semaines |
| **RBAC** | Role-Based Access Control (contrôle d'accès basé sur les rôles) |
| **Smiley** | Indicateur visuel (vert/orange/rouge) de performance |
| **Seuils** | Valeurs limites pour déterminer le smiley |

---

**Version** : 1.0.0  
**Date** : 27 février 2026  
**Auteur** : GitHub Copilot
