# 📖 Guide de développement rapide

## 🚀 Démarrage rapide

### 1. Cloner et lancer
```bash
# Cloner le projet
git clone https://github.com/votre-username/groupegoudalle.git
cd groupegoudalle

# Lancer un serveur local
python -m http.server 8000
# OU
npx http-server -p 8000

# Ouvrir http://localhost:8000/pages/login.html
```

### 2. Se connecter
- Username: `julie` / Password: `123`
- Ou voir [README.md](README.md) pour les autres comptes

---

## 📝 Commandes utiles

### Réinitialiser localStorage
```javascript
// Dans la console du navigateur
localStorage.clear();
location.reload();
```

### Voir toutes les données
```javascript
// Session
JSON.parse(localStorage.getItem('intranet_session_v1'))

// Utilisateurs
JSON.parse(localStorage.getItem('intranet_users_v1'))

// KPI
JSON.parse(localStorage.getItem('kpi_gm_weekly_v1'))

// Historique
JSON.parse(localStorage.getItem('kpi_gm_history_v1'))

// Seuils
JSON.parse(localStorage.getItem('kpi_gm_thresholds_v1'))
```

### Ajouter un utilisateur (console)
```javascript
const users = JSON.parse(localStorage.getItem('intranet_users_v1'));
users.push({
  username: 'test',
  password: '123',
  role: 'gm_lecture',
  access: ['gm'],
  displayName: 'Test User'
});
localStorage.setItem('intranet_users_v1', JSON.stringify(users));
```

---

## 🛠️ Ajouter une nouvelle fonctionnalité

### Exemple : Ajouter une nouvelle page

#### 1. Créer le fichier HTML
```html
<!-- pages/nouvelle-page.html -->
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Nouvelle page - Intranet Goudalle</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="app-container">
    <div id="sidebar-container"></div>
    <main class="main-content">
      <h1>Nouvelle page</h1>
      <!-- Contenu -->
    </main>
  </div>
  <script src="/js/app.js"></script>
  <script>
    Auth.requireAuth(); // Protection
    App.init();
    document.getElementById('sidebar-container').innerHTML = UI.generateSidebar();
    App.highlightCurrentPage();
  </script>
</body>
</html>
```

#### 2. Ajouter au menu (si nécessaire)
Modifier `UI.generateSidebar()` dans [js/app.js](js/app.js) :

```javascript
<li><a href="/pages/nouvelle-page.html" class="menu-item">
  <span class="icon">🆕</span> Nouvelle page
</a></li>
```

---

## 🎨 Personnaliser le style

### Modifier les couleurs
Dans [style.css](style.css), section `:root` :

```css
:root {
  --primary: #2c3e50;       /* Couleur principale */
  --secondary: #3498db;     /* Couleur secondaire */
  --success: #27ae60;       /* Vert (smiley) */
  --warning: #f39c12;       /* Orange (smiley) */
  --danger: #e74c3c;        /* Rouge (smiley) */
}
```

### Modifier la largeur du menu
```css
:root {
  --sidebar-width: 260px;   /* Largeur du menu latéral */
}
```

---

## 🔧 Fonctions utiles

### Calculer le h/m³
```javascript
const ratio = KPICalculator.calculateRatio(hours, m3);
// Exemple: KPICalculator.calculateRatio(450, 100) → 4.50
```

### Obtenir le smiley
```javascript
const thresholds = StorageManager.getThresholds();
const smiley = KPICalculator.getSmiley(ratio, thresholds);
// Retourne: 'green', 'orange', 'red', ou 'none'
```

### Formater la semaine
```javascript
const formatted = WeekUtils.formatWeekNumber(8); // → "08"
```

### Vérifier les permissions
```javascript
Auth.hasGMAccess()   // true si accès GM
Auth.canEditGM()     // true si peut modifier
Auth.isReadOnly()    // true si lecture seule
```

---

## 🧩 Ajouter une nouvelle entreprise

### 1. Modifier seed.json
Ajouter les données initiales pour la nouvelle entreprise.

### 2. Créer les pages
- `pages/nouvelle-entreprise.html` (dashboard)
- `pages/nouvelle-entreprise-admin.html` (admin)

### 3. Ajouter les permissions
Dans les objets users de `seed.json` :
```json
{
  "username": "user",
  "access": ["gm", "nouvelle-entreprise"]
}
```

### 4. Créer les clés localStorage
```javascript
const STORAGE_KEYS = {
  // ...existant
  KPI_NOUVELLE_WEEKLY: 'kpi_nouvelle_weekly_v1',
  KPI_NOUVELLE_HISTORY: 'kpi_nouvelle_history_v1'
};
```

---

## 📊 Modifier les seuils par défaut

Dans [data/seed.json](data/seed.json) :

```json
"kpi_gm_thresholds": {
  "greenMax": 4.0,     // Nouveau seuil vert
  "orangeMax": 5.0,    // Nouveau seuil orange
  "updatedAt": "2026-01-01T00:00:00Z",
  "updatedBy": "acgoudalle"
}
```

Puis réinitialiser le localStorage.

---

## 🐛 Debugging

### Activer les logs
Dans [js/app.js](js/app.js), ajouter au début :

```javascript
const DEBUG = true;

function log(...args) {
  if (DEBUG) console.log('[DEBUG]', ...args);
}
```

Puis utiliser `log()` au lieu de `console.log()`.

### Vérifier le routing
```javascript
// Dans la console
console.log('Current path:', window.location.pathname);
console.log('Is authenticated:', Auth.isAuthenticated());
console.log('Session:', Auth.getSession());
```

### Forcer une redirection
```javascript
// Aller à la page de login
window.location.href = '/pages/login.html';

// Aller à l'accueil
window.location.href = '/index.html';
```

---

## 📦 Structure du code

```
app.js (exportations globales)
├── window.App            → Initialisation, navigation
├── window.Auth           → Authentification, permissions
├── window.StorageManager → CRUD localStorage
├── window.WeekUtils      → Calculs semaines ISO
├── window.KPICalculator  → Calculs métier
└── window.UI             → Génération HTML
```

### Utilisation dans les pages
```javascript
// Déjà disponibles globalement (pas besoin d'import)
Auth.isAuthenticated()
StorageManager.getKPIWeekly()
KPICalculator.calculateRatio(hours, m3)
```

---

## 🎯 Bonnes pratiques

### 1. Toujours protéger les pages
```javascript
Auth.requireAuth(); // En haut du script
```

### 2. Vérifier les permissions spécifiques
```javascript
if (!Auth.canEditGM()) {
  alert('Accès refusé');
  window.location.href = '/pages/gm.html';
}
```

### 3. Créer des entrées d'historique
```javascript
// Avant toute modification de KPI
StorageManager.addHistory({
  id: `hist_${Date.now()}`,
  kpiId: kpi.id,
  changedAt: new Date().toISOString(),
  changedBy: session.username,
  oldValue: { /* ancien état */ },
  newValue: { /* nouvel état */ }
});
```

### 4. Valider les formulaires
```javascript
if (!comment.trim()) {
  alert('Le commentaire est obligatoire');
  return;
}
```

---

## 🚀 Prochaines évolutions possibles

### Fonctionnalités MVP+
- Export Excel des KPI
- Graphique comparatif entre entreprises
- Notifications (brouillons en attente)
- Recherche par date/semaine
- Filtre par statut (draft/published)

### Migration API
- Backend Node.js/Express
- Base de données PostgreSQL
- JWT pour l'authentification
- WebSockets pour temps réel

### Amélioration UX
- Dark mode
- Raccourcis clavier
- Auto-save des brouillons
- Glisser-déposer pour fichiers

---

## 📚 Ressources

- [Chart.js Documentation](https://www.chartjs.org/)
- [localStorage API](https://developer.mozilla.org/fr/docs/Web/API/Window/localStorage)
- [ISO 8601 (semaines)](https://en.wikipedia.org/wiki/ISO_8601#Week_dates)
- [GitHub Pages](https://pages.github.com/)

---

## 🆘 Support

Pour toute question ou problème :
1. Vérifier [TESTS.md](TESTS.md) pour les tests de régression
2. Consulter [ARCHITECTURE.md](ARCHITECTURE.md) pour la structure
3. Voir [README.md](README.md) pour les instructions de base

---

**Version** : 1.0.0  
**Dernière mise à jour** : 27 février 2026
