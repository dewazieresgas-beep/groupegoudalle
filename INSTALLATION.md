# 📖 Guide d'installation - Intranet Groupe Goudalle

## Prérequis

Installer **Node.js** sur le serveur Windows :
1. Aller sur https://nodejs.org
2. Télécharger la version **LTS** (ex: 20.x)
3. Installer avec les options par défaut

---

## Installation

1. **Copier le dossier complet** `groupegoudalle` sur le serveur (ex: `C:\Intranet\groupegoudalle`)

2. **Double-cliquer sur `DEMARRER-SERVEUR.bat`**
   - La première fois, il installe automatiquement les dépendances (quelques secondes)
   - Une fenêtre noire reste ouverte : c'est normal, c'est le serveur

3. **Accéder au site**
   - Depuis le serveur : http://localhost:3000
   - Depuis les autres PC du réseau : http://[IP-DU-SERVEUR]:3000

---

## Trouver l'IP du serveur

Sur le serveur Windows :
1. Ouvrir l'invite de commandes (`cmd`)
2. Taper `ipconfig`
3. Noter l'adresse **IPv4** (ex: 192.168.1.50)

L'adresse d'accès sera alors : **http://192.168.1.50:3000**

---

## Lancer automatiquement au démarrage de Windows

Pour que le serveur démarre automatiquement sans intervention :

1. Appuyer sur `Win + R`, taper `shell:startup`, valider
2. Créer un raccourci vers `DEMARRER-SERVEUR.bat` dans ce dossier

---

## Structure des données

Les données sont stockées dans `server/data/` :
- `users.json` — Comptes utilisateurs
- `kpis.json` — Indicateurs Goudalle Maçonnerie
- `cbco.json` — Chiffre d'affaires CBCO
- `cbco-commercial.json` — Affaires commerciales CBCO
- `sylve-balance.json` — Balance âgée Sylve
- `sylve-ca.json` — CA mensuel Sylve
- `sylve-paiements.json` — Paiements en attente Sylve
- `audit.json` — Journal d'audit
- `reminders-config.json` — Configuration rappels email
- `reminders-sent.json` — Historique rappels envoyés
- `thresholds.json` — Seuils KPI
- `admin-code.json` — Code administrateur

---

## Récupérer les données existantes (migration)

Si des données existent déjà dans le navigateur d'un PC :

1. Ouvrir le site sur ce PC
2. Ouvrir les outils développeur (F12)
3. Aller dans "Application" → "Local Storage"
4. Copier chaque valeur et la coller dans le fichier JSON correspondant dans `server/data/`

---

## Dépannage

**Le serveur ne démarre pas**
→ Vérifier que Node.js est bien installé : ouvrir cmd et taper `node --version`

**Accès refusé depuis un autre PC**
→ Vérifier que le pare-feu Windows autorise le port 3000 :
  - Panneau de configuration → Pare-feu Windows → Règles de trafic entrant
  - Ajouter une règle pour le port TCP 3000

**Les données n'apparaissent pas**
→ Vérifier que le fichier `server/data/users.json` existe et contient des données
