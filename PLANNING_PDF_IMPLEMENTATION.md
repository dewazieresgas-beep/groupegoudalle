# Implémentation - Planning de Production PDF

## Vue d'ensemble
Nouvelle fonctionnalité permettant d'importer et de consulter un PDF de planning de production CBCO avec zoom, pan et affichage en plein écran.

## Fichiers créés et modifiés

### 📝 Fichiers créés
1. **pages/planning-usine-cbco.html**
   - Nouvelle page dédiée à l'affichage du PDF
   - Intègre PDF.js pour le rendu
   - Interface moderne avec contrôles

2. **js/planning-pdf.js**
   - Logique complète de gestion du PDF
   - Fonctionnalités: zoom (0.5x à 3x), pan à la souris, plein écran
   - Adaptation automatique à la taille du conteneur

3. **server/planning-pdfs/**
   - Dossier de stockage des PDFs uploadés
   - Créé automatiquement au lancement du serveur

### ⚙️ Fichiers modifiés
1. **pages/production-saisie-productivite-usine.html**
   - Ajout d'un encart "Planning de Production"
   - Bouton d'import PDF
   - Affichage du statut et lien vers la page de visualisation

2. **server/server.js**
   - Ajout de `const multer = require('multer');`
   - Configuration multer pour les uploads (100MB max)
   - 3 nouveaux endpoints:
     - `POST /api/planning-pdf-upload` : Upload le PDF
     - `GET /api/planning-pdf-get` : Récupère l'URL du PDF actuel
     - `GET /api/planning-pdf-status` : Vérifie s'il y a un PDF en place
   - Route statique pour servir les PDFs: `/server/planning-pdfs`

3. **server/package.json**
   - Ajout de `multer: ^1.4.5-lts.1`

4. **js/utils.js**
   - Ajout du lien "📋 Planning Usine CBCO" dans la barre de navigation Production
   - Même permission que "Saisie Productivité Usine"

## 🎯 Fonctionnalités

### Page d'import (production-saisie-productivite-usine.html)
✅ Bouton d'import avec drag-drop possible  
✅ Indicateur de progression d'upload  
✅ Affichage du statut (en place / aucun planning)  
✅ Bouton pour accéder à la page d'affichage  
✅ Chaque nouvel upload supprime l'ancien  

### Page de visualisation (planning-usine-cbco.html)
✅ Affichage du PDF avec PDF.js  
✅ Zoom avant/arrière (touches 🔍+/🔍-)  
✅ Adaptation à la page (touche "Adapter")  
✅ Pan à la souris (drag & drop) - activé quand zoom > 100%  
✅ Zoom à la molette (Ctrl+Molette)  
✅ Plein écran (touche ⛶)  
✅ Indicateur de zoom en temps réel  
✅ Réinitialisation rapide (touche ↺)  
✅ Message si aucun PDF n'est importé  

## 🔧 Installation

Multer a été installé automatiquement via `npm install multer`.

Si réinstallation nécessaire:
```bash
cd server
npm install
```

## 📂 Structure stockage

```
server/
├── planning-pdfs/          # PDFs uploadés
│   └── planning-XXXXX.pdf  # Format: planning-{timestamp}.pdf
├── goudalle.json           # DB avec référence au PDF actuel
└── server.js
```

Les infos du PDF actuel sont stockées dans la clé `planning_pdf_current` de goudalle.json:
```json
{
  "filename": "planning-1695043200000.pdf",
  "originalname": "Planning CBCO 2024.pdf",
  "uploadedAt": "2024-10-10T12:00:00.000Z",
  "filesize": 2048576
}
```

## 🔐 Permissions

La fonctionnalité utilise la permission existante: `production_saisie_productivite`

## 🌐 URLs endpoints

- `GET /api/planning-pdf-status` - Vérifier si PDF en place
- `POST /api/planning-pdf-upload` - Upload un PDF (multipart/form-data)
- `GET /api/planning-pdf-get` - Récupérer l'URL du PDF
- `GET /server/planning-pdfs/[filename]` - Accès direct aux fichiers

## ⚠️ Limitations & Notes

- Taille max PDF: 100MB
- Seuls les fichiers `.pdf` sont acceptés
- Un seul PDF peut être en place à la fois (l'ancien est supprimé)
- Le pan n'est actif que quand zoom > 100%
- Compatible avec Firefox, Chrome, Edge (pas IE)
- Utilise PDF.js v3.11.174 depuis CDN

## 🧪 Test recommandé

1. Accéder à "Saisie Productivité Usine"
2. Scroll jusqu'à l'encart "Planning de Production"
3. Cliquer sur "Importer un PDF" et sélectionner un PDF
4. Vérifier le statut et le lien "Voir le planning"
5. Cliquer sur "Voir le planning" pour accéder à la nou page
6. Tester: zoom, pan, plein écran, adaptation
7. Re-importer un autre PDF pour vérifier la suppression de l'ancien

## 🚀 Prochaines améliorations possibles

- Support de plusieurs pages (navigation page précédente/suivante)
- Annotations sur le PDF
- Historique des PDF uploadés
- Export de la vue zoom/pan en image
- Rotation du PDF
