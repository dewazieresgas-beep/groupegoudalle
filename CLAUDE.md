## Navigation contextuelle (Wiki-Brain)

Tu as accès à un wiki personnel situé dans `C:\Users\gdewazieres\Desktop\WikiBrain`. C'est la base de connaissance
cumulative de l'utilisateur. Utilise-le comme source de contexte principale.

Quand tu dois comprendre la codebase, les docs, les travaux passés ou toute connaissance stockée :

1. **Interroge TOUJOURS le graphe de connaissances en premier :** `graphify query "ta question"`
   (lancé depuis `C:\Users\gdewazieres\Desktop\WikiBrain`).
2. **Utilise `C:\Users\gdewazieres\Desktop\WikiBrain\wiki\index.md`** comme point d'entrée pour naviguer dans la structure du wiki.
3. **Utilise `C:\Users\gdewazieres\Desktop\WikiBrain\graphify-out\wiki\index.md`** s'il existe — c'est l'index wiki généré automatiquement par Graphify.
4. **Ne lis les fichiers bruts dans `C:\Users\gdewazieres\Desktop\WikiBrain\raw\`** que si l'utilisateur dit explicitement "lis le fichier brut" ou si la requête au graphe ne retourne pas la réponse.

## Règles de session Wiki-Brain

**Ingestion de sources.** Quand l'utilisateur dépose un fichier dans `C:\Users\gdewazieres\Desktop\WikiBrain\raw\`
et te demande de l'ingérer, suis `/wiki-brain ingest` — lis la source,
résume, crée ou mets à jour les pages wiki, crée des liens croisés de façon agressive, mets à jour
`wiki\index.md`, et ajoute une entrée dans `log.md`.

**Chaque session doit se terminer par une entrée de log.** Avant de terminer une session, ajoute
une ligne dans `C:\Users\gdewazieres\Desktop\WikiBrain\log.md` avec ce format exact :

```
## [YYYY-MM-DD HH:MM] session | <titre de session en 3-8 mots>
Touchées : <pages wiki séparées par des virgules, ou "aucune">
```

**Si la session a produit une connaissance durable** (décisions prises, choses apprises,
état du projet modifié, problèmes résolus) — mets à jour ou crée les pages wiki
pertinentes avec cette connaissance avant de terminer. Crée des liens croisés avec `[[Nom de page]]`.
Mets à jour `wiki\index.md`.

**Si la session était triviale** (correctif ponctuel, tâche routinière, exploration) —
passe la mise à jour wiki. Ajoute simplement la ligne de log.

**Ne jamais modifier les fichiers dans `raw\`.** Les sources sont immuables.
**Claude possède entièrement `wiki\`.** Mets-le à jour, ne demande pas la permission pour chaque
page — contente-toi de signaler ce qui a changé.
**Mets toujours à jour `wiki\index.md`** quand tu crées ou renommes une page wiki.
**Crée des liens croisés de façon agressive.** Syntaxe Obsidian `[[Nom de page]]`. Une page sans
liens entrants est un cul-de-sac.

## Commandes Wiki-Brain disponibles

- `/wiki-brain` — menu de statut
- `/wiki-brain ingest <fichier>` — ingérer une source
- `/wiki-brain query "<question>"` — interroger le graphe et le wiki
- `/wiki-brain lint` — vérification de santé du wiki
- `/wiki-brain rebuild` — forcer une reconstruction Graphify
- `/wiki-brain doctor` — vérifier l'installation
- `/recall` — afficher les 5 dernières activités et lire les pages liées
