# Intranet Goudalle - Prototype MVP

**Prototype 100% statique** d'intranet pour le groupe Goudalle, développé en HTML/CSS/JavaScript vanilla. Authentification et base de données simulées via `localStorage`.

---

## 📁 Structure du projet

```
groupegoudalle/
├── index.html              # Accueil (page protégée, dashboard GM)
├── style.css               # Styles globaux
├── pages/
│   ├── login.html          # Page de connexion (publique)
│   ├── gm.html             # Dashboard Goudalle Maçonnerie (protégé)
│   ├── gm-admin.html       # Référent GM - Gestion KPI (protégé)
│   └── account.html        # Mon compte (protégé)
├── js/
│   └── app.js              # Logique auth, storage, utils, KPI
├── data/
│   └── seed.json           # Données initiales (users, KPI, seuils)
└── README.md               # Ce fichier
```

---

## 🚀 Lancement en local

### Prérequis
- Un serveur local (le simple double-clic sur `index.html` ne fonctionnera pas à cause des CORS sur `fetch('/data/seed.json')`)

### Option 1 : Live Server (VS Code)
1. Installer l'extension **Live Server** dans VS Code
2. Clic droit sur `index.html` → **Open with Live Server**
3. Le navigateur s'ouvre sur `http://127.0.0.1:5500/`

### Option 2 : Python
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```
Puis ouvrir `http://localhost:8000/`

### Option 3 : Node.js (http-server)
```bash
npx http-server -p 8000
```
Puis ouvrir `http://localhost:8000/`

---

## 🔐 Comptes de test

| Username     | Password | Rôle           | Accès             | Permissions                          |
|--------------|----------|----------------|-------------------|--------------------------------------|
| `acgoudalle` | `123`    | Direction      | Toutes entreprises| Lecture + Édition GM                 |
| `julie`      | `123`    | Référent GM    | GM uniquement     | Lecture + Édition GM                 |
| `gaspard`    | `123`    | Lecture seule  | GM uniquement     | Lecture seule (pas de bouton éditer) |

---

## 🧪 Checklist de tests manuels

### ✅ 1. Authentification et routing

- [ ] **Non connecté** : Accéder à `/index.html` → redirige vers `/pages/login.html`
- [ ] **Non connecté** : Accéder à `/pages/gm.html` → redirige vers `/pages/login.html`
- [ ] **Connexion** : Login avec `acgoudalle` / `123` → redirige vers `/index.html`
- [ ] **Connexion** : Login avec identifiants incorrects → message d'erreur
- [ ] **Déconnexion** : Cliquer sur "Déconnexion" → redirige vers `/pages/login.html` et session supprimée

---

### ✅ 2. Page d'accueil (`/index.html`)

- [ ] Affiche le menu latéral avec nom d'utilisateur
- [ ] Affiche la carte "Goudalle Maçonnerie" avec KPI de la dernière semaine publiée
- [ ] KPI affichés : Semaine, m³, Heures, h/m³, smiley, commentaire
- [ ] Graphique des 8 dernières semaines visible avec Chart.js
- [ ] Bouton "Ouvrir GM" → redirige vers `/pages/gm.html`
- [ ] Menu actif sur "Accueil"

---

### ✅ 3. Dashboard GM (`/pages/gm.html`)

- [ ] Accessible uniquement si utilisateur a accès GM (sinon redirection)
- [ ] Affiche KPI de la semaine passée (dernière publiée)
- [ ] Affiche le graphique des 8 dernières semaines
- [ ] Affiche le tableau des 4 semaines précédentes (W-1 à W-4)
- [ ] Affiche la moyenne du mois avec smiley calculé
- [ ] Colonnes du tableau : Semaine, m³, Heures, h/m³, Commentaire
- [ ] Menu actif sur "Goudalle Maçonnerie"

---

### ✅ 4. Référent GM (`/pages/gm-admin.html`)

**Accès**
- [ ] Accessible uniquement pour `acgoudalle` et `julie`
- [ ] `gaspard` est redirigé vers `/pages/gm.html`

**Formulaire de saisie**
- [ ] Pré-rempli avec année et semaine passée
- [ ] Champs m³, heures, commentaire, statut (draft/published)
- [ ] Enregistrement d'un nouveau KPI → apparaît dans la liste
- [ ] Modification d'un KPI existant → crée une entrée dans l'historique
- [ ] Commentaire obligatoire (sinon erreur)

**Liste des semaines**
- [ ] Affiche toutes les semaines (draft + published) triées par date décroissante
- [ ] Colonnes : Semaine, m³, Heures, h/m³, Statut, Commentaire, Actions
- [ ] Bouton "Modifier" → charge le KPI dans le formulaire
- [ ] Bouton "Publier" visible uniquement pour les drafts
- [ ] Publier un draft → passe en published et disparaît le bouton

**Seuils smiley**
- [ ] Affiche les seuils actuels (greenMax, orangeMax)
- [ ] Modification des seuils → sauvegarde et rafraîchit la liste
- [ ] Vérification : seuil vert < seuil orange (sinon erreur)

---

### ✅ 5. Mon compte (`/pages/account.html`)

- [ ] Affiche username, nom complet, rôle, date de connexion
- [ ] Affiche les permissions (accès GM, édition, lecture seule)
- [ ] Affiche les entreprises accessibles
- [ ] Bouton "Réinitialiser localStorage" → confirme 2x puis supprime tout et redirige

---

### ✅ 6. Calculs KPI

- [ ] h/m³ = hours / m3, arrondi à 2 décimales
- [ ] Si m3 = 0 → h/m³ affiché comme "—"
- [ ] Smiley vert si h/m³ < 4.5
- [ ] Smiley orange si 4.5 ≤ h/m³ ≤ 5.5
- [ ] Smiley rouge si h/m³ > 5.5
- [ ] Moyenne du mois = moyenne des h/m³ des 4 semaines précédentes (ignorer m3=0 et non publiées)

---

### ✅ 7. Semaines ISO

- [ ] Numéros de semaine affichés avec zéro devant (01, 02, ..., 52)
- [ ] Semaine passée = semaine ISO précédente (calculée automatiquement)
- [ ] Graphiques et tableaux trient par année puis semaine décroissante

---

### ✅ 8. Données et historique

- [ ] Au premier lancement : les données de `seed.json` sont chargées dans localStorage
- [ ] Après rechargement de la page : les données persistent (localStorage)
- [ ] Chaque modification de KPI crée une entrée dans `kpi_gm_history_v1`
- [ ] L'historique contient : oldValue, newValue, changedAt, changedBy

---

### ✅ 9. Protection des pages

- [ ] `julie` (gm_referent) peut accéder à `/pages/gm-admin.html`
- [ ] `gaspard` (gm_lecture) **ne peut pas** accéder à `/pages/gm-admin.html`
- [ ] `gaspard` voit les dashboards mais **aucun bouton d'édition**
- [ ] Toutes les pages protégées redirigent vers `/pages/login.html` si non connecté

---

### ✅ 10. UI/UX

- [ ] Menu latéral visible sur toutes les pages protégées
- [ ] Item de menu actif en surbrillance
- [ ] Badge "Prototype (auth simulée)" visible en bas du menu
- [ ] Design professionnel, sobre, lisible
- [ ] Responsive (sidebar passe en pleine largeur sur mobile)
- [ ] Smileys colorés (vert 🟢, orange 🟠, rouge 🔴)

---

## 🛠️ Réinitialisation des données

### Méthode 1 : Via l'interface
1. Se connecter avec n'importe quel compte
2. Aller sur **Mon compte** (`/pages/account.html`)
3. Cliquer sur "Réinitialiser toutes les données"
4. Confirmer 2 fois

### Méthode 2 : Via la console du navigateur
```javascript
localStorage.clear();
location.reload();
```

Les données seront rechargées depuis `seed.json` au prochain accès.

---

## 📊 Technologies utilisées

- **HTML5** : Structure des pages
- **CSS3** : Design responsive et management visuel
- **JavaScript (Vanilla)** : Logique métier, routing, auth
- **Chart.js** (CDN) : Graphiques de tendance
- **localStorage** : Stockage des données et session

---

## 🔄 Migration future vers API

Le code est structuré pour être facilement remplaçable :

1. **Auth** : Remplacer `Auth.login()` par un appel API (`POST /api/login`)
2. **Storage** : Remplacer `StorageManager.getKPIWeekly()` par `fetch('/api/kpi/weekly')`
3. **Session** : Remplacer `localStorage` par cookies/JWT

Toutes les fonctions métier (`KPICalculator`, `WeekUtils`, `UI`) restent inchangées.

---

## 📝 Notes

- **Prototype** : Pas de sécurité réelle, les mots de passe sont en clair dans `seed.json`
- **LocalStorage** : Les données sont stockées dans le navigateur, ne pas utiliser en production
- **CORS** : Nécessite un serveur local pour `fetch('/data/seed.json')`
- **Browsers** : Testé sur Chrome, Firefox, Edge (versions récentes)

---

## 📧 Support

Pour toute question ou amélioration, contacter l'équipe de développement.

**Version** : 1.0.0 (MVP Prototype)  
**Date** : 27 février 2026
