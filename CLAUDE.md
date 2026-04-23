# graphify

**graphify** (`~/.claude/skills/graphify/SKILL.md`) — transforme n'importe quelle entrée en graphe de connaissances : `/graphify`
Quand l'utilisateur tape `/graphify`, invoquer l'outil Skill avec `skill: "graphify"` avant toute autre action.

## Navigation dans le contexte (Graphify)

Quand tu as besoin de comprendre le code, les modules, l'architecture ou l'historique de ce projet :

1. **TOUJOURS interroger le graphe de connaissances en premier :** `/graphify query "ta question"`
   (exécuté depuis `C:\Users\gdewazieres\Desktop\WikiBrain`)
2. **Utiliser `C:\Users\gdewazieres\Desktop\WikiBrain\graphify-out\graph.json`** comme source de vérité sur les connexions entre concepts.
3. **Utiliser `C:\Users\gdewazieres\Desktop\WikiBrain\wiki\index.md`** comme point d'entrée pour naviguer dans la structure du wiki.
4. **Ne lire les fichiers source directement** (`server/server.js`, `client/js/*.js`, etc.) que si la requête au graphe ne retourne pas la réponse, ou si l'utilisateur demande explicitement.

### Exemples de requêtes utiles sur ce projet

- `graphify query "comment fonctionne le module achat"` → pipeline PDF, parsing, allocation
- `graphify query "watcher excel"` → pattern commun CBCO / GM / RH
- `graphify query "securite token"` → CSRF, CORS, rate limiting
- `graphify query "permissions utilisateurs"` → rôles, Auth.requirePermission
- `graphify query "bug résolu"` → historique des corrections

---

## Navigation contextuelle (Wiki-Brain)

Tu as accès à un wiki personnel situé dans `C:\Users\gdewazieres\Desktop\WikiBrain`. C'est la base de connaissance cumulative du projet Intranet Groupe Goudalle.

Modules documentés : **Achat** (PDF Onaya), **Production CBCO** (usine), **Production Maçonnerie** (GM), **RH Sécurité** (accidents), **Commerce** (Excel Mathieu), **Comptabilité** (Sylve), **API Client** (ServerStorage), **Sécurité Serveur**.

Quand tu dois comprendre la codebase, les décisions passées ou l'historique :

1. **Interroge le graphe en premier :** `graphify query "ta question"` (depuis `C:\Users\gdewazieres\Desktop\WikiBrain`)
2. **Lis `wiki\index.md`** pour naviguer dans les pages.
3. **Ne lis les fichiers bruts dans `raw\`** que si l'utilisateur le demande explicitement.

## Règles de session Wiki-Brain

**Ingestion.** Quand l'utilisateur dépose un fichier dans `C:\Users\gdewazieres\Desktop\WikiBrain\raw\` et demande de l'ingérer, suis `/wiki-brain ingest` — résume, crée/met à jour les pages wiki, crée des liens croisés `[[Nom de page]]`, mets à jour `wiki\index.md`, ajoute une entrée dans `log.md`.

**Fin de session — entrée de log obligatoire.** Avant de terminer, ajoute dans `C:\Users\gdewazieres\Desktop\WikiBrain\log.md` :

```
## [YYYY-MM-DD HH:MM] session | <titre en 3-8 mots>
Touchées : <pages wiki modifiées, ou "aucune">
```

**Si la session a produit une connaissance durable** (décision prise, bug résolu, feature ajoutée, changement d'architecture) → crée/mets à jour les pages wiki concernées, puis relance `/graphify --update C:\Users\gdewazieres\Desktop\WikiBrain` pour que le graphe intègre les nouvelles pages.

**Si la session était triviale** (correctif ponctuel, exploration sans conclusion) → log uniquement, pas de mise à jour wiki ni de rebuild graphe.

**Ne jamais modifier `raw\`.** Claude possède entièrement `wiki\` — mets-le à jour sans demander la permission, signale ce qui a changé.

## Commandes disponibles

- `/graphify` — construire ou mettre à jour le graphe de connaissances
- `/graphify query "<question>"` — interroger le graphe
- `/graphify --update C:\Users\gdewazieres\Desktop\WikiBrain` — rebuild incrémental après ajout de pages wiki
- `/wiki-brain` — menu statut
- `/wiki-brain ingest <fichier>` — ingérer une source
- `/wiki-brain lint` — vérification de santé du wiki
- `/recall` — 5 dernières activités du log
