# 🚀 Déploiement sur GitHub Pages

## Étapes de déploiement

### 1. Créer le dépôt GitHub
```bash
# Déjà initialisé avec git
git status
```

### 2. Ajouter le remote (si pas déjà fait)
```bash
git remote add origin https://github.com/VOTRE_USERNAME/groupegoudalle.git
```

### 3. Push sur GitHub
```bash
git add .
git commit -m "Initial commit - Intranet Goudalle MVP"
git push -u origin main
```

### 4. Activer GitHub Pages
1. Aller sur GitHub.com → Votre repo `groupegoudalle`
2. **Settings** → **Pages**
3. Source : **Deploy from a branch**
4. Branch : **main** / **(root)**
5. Cliquer **Save**

### 5. Attendre le déploiement
- GitHub va déployer automatiquement (1-2 minutes)
- URL finale : `https://VOTRE_USERNAME.github.io/groupegoudalle/`

---

## ⚙️ Configuration

Aucune configuration spéciale nécessaire ! Le site est 100% statique.

---

## 🔗 Accès

Une fois déployé :
- **URL publique** : `https://VOTRE_USERNAME.github.io/groupegoudalle/`
- **Page de login** : `https://VOTRE_USERNAME.github.io/groupegoudalle/pages/login.html`

---

## 📝 Note importante

⚠️ **Prototype uniquement** : Ce site est une démo avec auth simulée. Ne pas utiliser en production avec de vraies données sensibles !

---

## 🔄 Mises à jour

Pour mettre à jour le site après modifications :

```bash
git add .
git commit -m "Description des modifications"
git push
```

GitHub Pages redéploiera automatiquement en 1-2 minutes.

---

## 🌐 Domaine personnalisé (optionnel)

Pour utiliser un domaine personnalisé (ex: `intranet.goudalle.fr`) :

1. Ajouter un fichier `CNAME` à la racine avec votre domaine
2. Configurer les DNS chez votre registrar :
   - Type : `CNAME`
   - Nom : `intranet` (ou `@` pour racine)
   - Valeur : `VOTRE_USERNAME.github.io`

---

**Date** : 27 février 2026
