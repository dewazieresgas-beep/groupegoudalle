# 🧪 Checklist de tests - Intranet Goudalle

## 🎯 Instructions de test

1. Utiliser un serveur local (Live Server, Python, etc.)
2. Commencer avec un localStorage vide (ou tester la réinitialisation)
3. Tester dans l'ordre suivant pour une meilleure cohérence

---

## 📋 Tests par fonctionnalité

### 1️⃣ Initialisation et données

| Test | Étapes | Résultat attendu | ✅ |
|------|--------|------------------|---|
| Chargement initial | Ouvrir l'app pour la 1ère fois | Données de seed.json chargées dans localStorage | ☐ |
| Vérification users | Console : `JSON.parse(localStorage.getItem('intranet_users_v1'))` | 3 utilisateurs présents | ☐ |
| Vérification KPI | Console : `JSON.parse(localStorage.getItem('kpi_gm_weekly_v1'))` | 7 semaines présentes (6 published, 1 draft) | ☐ |
| Vérification seuils | Console : `JSON.parse(localStorage.getItem('kpi_gm_thresholds_v1'))` | greenMax: 4.5, orangeMax: 5.5 | ☐ |

---

### 2️⃣ Authentification

| Test | Username | Password | Résultat attendu | ✅ |
|------|----------|----------|------------------|---|
| Login valide (direction) | `acgoudalle` | `123` | Redirection vers /index.html | ☐ |
| Login valide (référent) | `julie` | `123` | Redirection vers /index.html | ☐ |
| Login valide (lecture) | `gaspard` | `123` | Redirection vers /index.html | ☐ |
| Login invalide | `test` | `wrong` | Message d'erreur, reste sur login | ☐ |
| Déjà connecté | Accéder à /pages/login.html | Redirection vers /index.html | ☐ |
| Déconnexion | Clic sur "Déconnexion" | Redirection vers /pages/login.html | ☐ |
| Session supprimée | Après déconnexion, vérifier localStorage | Key 'intranet_session_v1' supprimée | ☐ |

---

### 3️⃣ Protection des pages

| Test | Page | Utilisateur | Résultat attendu | ✅ |
|------|------|-------------|------------------|---|
| Accès non connecté | /index.html | Non connecté | Redirection vers /pages/login.html | ☐ |
| Accès non connecté | /pages/gm.html | Non connecté | Redirection vers /pages/login.html | ☐ |
| Accès non connecté | /pages/gm-admin.html | Non connecté | Redirection vers /pages/login.html | ☐ |
| Accès GM | /pages/gm.html | `gaspard` | Accès autorisé | ☐ |
| Accès GM Admin | /pages/gm-admin.html | `gaspard` | Redirection vers /pages/gm.html | ☐ |
| Accès GM Admin | /pages/gm-admin.html | `julie` | Accès autorisé | ☐ |
| Accès GM Admin | /pages/gm-admin.html | `acgoudalle` | Accès autorisé | ☐ |

---

### 4️⃣ Navigation et menu

| Test | Utilisateur | Vérification | ✅ |
|------|-------------|--------------|---|
| Affichage sidebar | `julie` | Sidebar visible avec nom "Julie Dupont" | ☐ |
| Affichage rôle | `julie` | Badge "Référent GM" dans sidebar | ☐ |
| Menu Accueil | Sur /index.html | "Accueil" en surbrillance | ☐ |
| Menu GM | Sur /pages/gm.html | "Goudalle Maçonnerie" en surbrillance | ☐ |
| Menu GM Référent | `julie` | Lien "GM Référent" visible dans menu | ☐ |
| Menu GM Référent | `gaspard` | Lien "GM Référent" **non visible** | ☐ |
| Badge prototype | Toutes pages | "⚠️ Prototype (auth simulée)" en bas du menu | ☐ |

---

### 5️⃣ Page d'accueil (/index.html)

| Test | Vérification | ✅ |
|------|--------------|---|
| Titre | "Tableau de bord" affiché | ☐ |
| Carte GM | Carte "🏗️ Goudalle Maçonnerie" visible | ☐ |
| KPI semaine | Affiche S08 - 2026 (dernière publiée au 27/02/2026) | ☐ |
| KPI m³ | Valeur : 195.50 m³ | ☐ |
| KPI heures | Valeur : 882.75 heures | ☐ |
| KPI h/m³ | Valeur : 4.52 | ☐ |
| Smiley | 🟠 Orange (4.52 est entre 4.5 et 5.5) | ☐ |
| Commentaire | "Semaine courte..." affiché | ☐ |
| Graphique | Chart.js affiche 8 dernières semaines | ☐ |
| Bouton Ouvrir GM | Redirige vers /pages/gm.html | ☐ |

---

### 6️⃣ Dashboard GM (/pages/gm.html)

| Test | Vérification | ✅ |
|------|--------------|---|
| Titre | "🏗️ Goudalle Maçonnerie" | ☐ |
| Section semaine passée | Identique à page d'accueil | ☐ |
| Graphique tendance | 8 dernières semaines affichées | ☐ |
| Labels graphique | S03, S04, S05, S06, S07, S08 (selon données) | ☐ |
| Tableau historique | 4 semaines précédentes (W-1 à W-4) | ☐ |
| Colonnes tableau | Semaine, m³, Heures, h/m³, Commentaire | ☐ |
| Moyenne mois | Calcul correct de la moyenne h/m³ | ☐ |
| Smiley moyenne | Correspond au ratio moyen | ☐ |

---

### 7️⃣ Référent GM - Formulaire (/pages/gm-admin.html)

**Test avec `julie`**

| Test | Action | Résultat attendu | ✅ |
|------|--------|------------------|---|
| Pré-remplissage | Ouvrir la page | Année = 2026, Semaine = 08 (semaine passée) | ☐ |
| Saisie nouveau KPI | Remplir S10, 200 m³, 900h, "Test", Draft | KPI enregistré | ☐ |
| Vérification liste | Après enregistrement | S10 apparaît dans la liste avec badge "draft" | ☐ |
| Commentaire vide | Soumettre sans commentaire | Alerte "Commentaire obligatoire" | ☐ |
| Modification KPI | Clic "Modifier" sur S10 | Formulaire rempli avec données S10 | ☐ |
| Enregistrement modif | Changer m³ à 210, soumettre | KPI mis à jour | ☐ |
| Historique créé | Console : `JSON.parse(localStorage.getItem('kpi_gm_history_v1'))` | Nouvelle entrée avec oldValue/newValue | ☐ |
| Publier draft | Clic "Publier" sur S10 | Passe en "published", bouton disparaît | ☐ |
| Annuler | Remplir formulaire, clic "Annuler" | Formulaire réinitialisé | ☐ |

---

### 8️⃣ Référent GM - Seuils (/pages/gm-admin.html)

**Test avec `julie`**

| Test | Action | Résultat attendu | ✅ |
|------|--------|------------------|---|
| Affichage seuils | Scroll vers section seuils | greenMax = 4.5, orangeMax = 5.5 | ☐ |
| Modification seuils | greenMax = 4.0, orangeMax = 5.0, soumettre | Seuils sauvegardés | ☐ |
| Vérification localStorage | Console : `JSON.parse(localStorage.getItem('kpi_gm_thresholds_v1'))` | Nouveaux seuils présents | ☐ |
| Rafraîchissement smileys | Après modification des seuils | Liste KPI affiche nouveaux smileys | ☐ |
| Validation seuils | greenMax = 5.0, orangeMax = 4.0, soumettre | Alerte "Seuil vert doit être < orange" | ☐ |

---

### 9️⃣ Mon compte (/pages/account.html)

**Test avec `julie`**

| Test | Vérification | ✅ |
|------|--------------|---|
| Username | Affiche "julie" | ☐ |
| Nom complet | Affiche "Julie Dupont" | ☐ |
| Rôle | Affiche "Référent GM" | ☐ |
| Date connexion | Affiche date/heure de connexion | ☐ |
| Accès GM | ✅ Oui | ☐ |
| Modification GM | ✅ Oui | ☐ |
| Mode lecture seule | ✅ Non | ☐ |
| Entreprises | GM | ☐ |

**Test avec `acgoudalle`**

| Test | Vérification | ✅ |
|------|--------------|---|
| Rôle | Affiche "Direction" | ☐ |
| Entreprises | Toutes les entreprises du groupe | ☐ |

**Test avec `gaspard`**

| Test | Vérification | ✅ |
|------|--------------|---|
| Rôle | Affiche "Lecture seule" | ☐ |
| Modification GM | ❌ Non | ☐ |
| Mode lecture seule | ⚠️ Oui | ☐ |

---

### 🔟 Calculs KPI

| Test | m³ | Heures | h/m³ attendu | Smiley attendu | ✅ |
|------|-----|--------|--------------|----------------|---|
| Calcul normal | 100 | 450 | 4.50 | 🟠 Orange | ☐ |
| Calcul vert | 100 | 400 | 4.00 | 🟢 Vert | ☐ |
| Calcul rouge | 100 | 600 | 6.00 | 🔴 Rouge | ☐ |
| m³ = 0 | 0 | 100 | — | ⚪ None | ☐ |
| Moyenne 4 semaines | Voir tableau historique | Calcul = somme ratios / count | Smiley correct | ☐ |

---

### 1️⃣1️⃣ Réinitialisation

| Test | Action | Résultat attendu | ✅ |
|------|--------|------------------|---|
| Reset via UI | Mon compte > Réinitialiser > Confirmer 2x | localStorage vidé, redirection login | ☐ |
| Rechargement données | Après reset, login à nouveau | Données de seed.json rechargées | ☐ |
| Reset via console | `localStorage.clear(); location.reload();` | Même comportement | ☐ |

---

### 1️⃣2️⃣ Semaines ISO

| Test | Date du jour | Semaine passée attendue | ✅ |
|------|--------------|-------------------------|---|
| 27 février 2026 | Calcul auto | S08 (semaine précédente) | ☐ |
| Formatage | Semaine 3 | S03 (avec zéro) | ☐ |
| Tri décroissant | Liste KPI | 2026-W09, 2026-W08, ... | ☐ |

---

### 1️⃣3️⃣ Responsive & UI

| Test | Vérification | ✅ |
|------|--------------|---|
| Desktop | Sidebar fixe à gauche, contenu à droite | ☐ |
| Mobile (< 768px) | Sidebar en pleine largeur | ☐ |
| Graphique responsive | Chart.js s'adapte à la largeur | ☐ |
| Tableau responsive | Scroll horizontal si nécessaire | ☐ |
| Couleurs smileys | Vert = #27ae60, Orange = #f39c12, Rouge = #e74c3c | ☐ |

---

## ✅ Résumé

- **Total tests** : ~80
- **Temps estimé** : 45-60 minutes
- **Navigateurs** : Tester sur Chrome, Firefox, Edge

---

## 🐛 Bugs connus (à vérifier)

- [ ] Chart.js annotations plugin non inclus (lignes seuils ne s'affichent pas)
- [ ] Aucun message si pas de données publiées sur certaines pages
- [ ] Pas de validation du format de semaine (01-52)

---

**Date de création** : 27 février 2026  
**Version** : 1.0.0
