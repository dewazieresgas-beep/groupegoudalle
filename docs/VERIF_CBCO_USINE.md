# ✅ VÉRIFICATION - pages/cbco-usine.html

## 📋 RAPPORT DE SYNTHÈSE

**Fichier:** `pages/cbco-usine.html`
**Date:** Vérification complète
**Statut:** ✅ **CONFIRMÉ - AUCUNE ERREUR SYNTAXIQUE**

---

## 🔍 VÉRIFICATION LOGIQUE DÉTAILLÉE

### 1️⃣ SÉLECTION START/END SEMAINE → CHART SEULEMENT

#### ✅ Récupération des entrées filtrées (ligne 438)
```javascript
const chartEntries = getSelectedEntries(withData, cfg.suffix);
```
**Comportement:** 
- Récupère `withData` (toutes les données triées par année/semaine)
- Applique la sélection start/endWeek via `getSelectedEntries()`
- Retourne uniquement les entrées dans la plage sélectionnée

#### ✅ Utilisation chartEntries → Labels du chart (lignes 439-440)
```javascript
const labels = chartEntries.map(e => e.semaineLabel || `S${e.week} ${e.year}`);
const latestLabel = labels[labels.length - 1];
```
**Comportement:** Les labels affichés dans le chart reflètent la sélection start/endWeek

#### ✅ Utilisation chartEntries → Datasets du chart (ligne 441-452)
```javascript
const dataProd = chartEntries.map(e => {
  const direct = toFiniteNumber(e[cfg.prodField]);
  if (direct !== null) return direct;
  if (machine === 'collage') {
    const h = toFiniteNumber(e.collageHeures);
    const p = toFiniteNumber(e.collagePresses);
    return (h !== null && p !== null && p > 0) ? (h / p) : null;
  }
  const useful = cfg.usefulField ? toFiniteNumber(e[cfg.usefulField]) : null;
  const main = toFiniteNumber(e[cfg.m3Field]);
  return (useful !== null && useful > 0 && main !== null) ? (main / useful) : null;
});
```
**Comportement:** 
- Crée `dataProd[]` UNIQUEMENT à partir de `chartEntries` 
- Impact: Le chart affiche les données filtrées par start/endWeek ✅

#### ✅ Utilisation chartEntries → Targets du chart (lignes 453-459)
```javascript
const dataTarget = machine === 'assemblage'
  ? chartEntries.map(() => 0)
  : chartEntries.map(e => {
      if (!cfg.targetField) return null;
      const t = toFiniteNumber(e[cfg.targetField]);
      return t !== null && t > 0 ? t : null;
    });
```
**Comportement:** 
- Les targets aussi créées à partir de `chartEntries`
- Même sélection que le chart ✅

---

### 2️⃣ KPIs UTILISENT DERNIÈRE DONNÉE GLOBALE withData

#### ✅ Récupération du dernier élément (ligne 460)
```javascript
const latest = withData[withData.length - 1];
```
**Comportement:**
- Récupère le DERNIER élément de `withData` (données complètes triées)
- INDÉPENDANT de la sélection start/endWeek
- C'est l'élément global le plus récent

#### ✅ weekNumber utilise latest (ligne 486)
```javascript
document.getElementById(`weekNumber${cfg.suffix}`).textContent = latest.semaineLabel || `S${latest.week} ${latest.year}`;
```
**Source:** `latest` (dernière donnée globale) ✅

#### ✅ cubage utilise latest (ligne 487)
```javascript
document.getElementById(`cubage${cfg.suffix}`).textContent = formatNumber(Number(latest[cfg.m3Field]) || 0);
```
**Source:** `latest` (dernière donnée globale) ✅

#### ✅ hours utilise latest (ligne 488)
```javascript
document.getElementById(`hours${cfg.suffix}`).textContent = formatNumber(Number(latest[cfg.hoursField]) || 0);
```
**Source:** `latest` (dernière donnée globale) ✅

#### ✅ prod utilise latest (lignes 461-472 + ligne 489)
```javascript
// Calcul de latestProd basé sur latest
const latestProd = (() => {
  const direct = toFiniteNumber(latest[cfg.prodField]);
  if (direct !== null) return direct;
  if (machine === 'collage') {
    const h = toFiniteNumber(latest.collageHeures);
    const p = toFiniteNumber(latest.collagePresses);
    return (h !== null && p !== null && p > 0) ? (h / p) : 0;
  }
  const useful = cfg.usefulField ? toFiniteNumber(latest[cfg.usefulField]) : null;
  const main = toFiniteNumber(latest[cfg.m3Field]);
  return (useful !== null && useful > 0 && main !== null) ? (main / useful) : 0;
})();

document.getElementById(`prod${cfg.suffix}`).textContent = formatNumber(latestProd);
```
**Source:** `latest` (dernière donnée globale) ✅

#### ✅ comment utilise latest (ligne 490)
```javascript
document.getElementById(`comment${cfg.suffix}`).value = sanitizeComment(latest[cfg.remarkField]);
```
**Source:** `latest` (dernière donnée globale) ✅

#### ✅ indicator utilise latest (lignes 480-484 + ligne 491-492)
```javascript
// Calcul de aboveTarget basé sur latestProd/latestTarget
const aboveTarget = machine === 'assemblage'
  ? (latestProd <= 0)
  : (latestTarget > 0
    ? (cfg.goodWhenLower ? latestProd <= latestTarget : latestProd >= latestTarget)
    : false);

document.getElementById(`indicator${cfg.suffix}`).className = `gm-indicator-card ${aboveTarget ? 'vert' : 'rouge'}`;
document.getElementById(`mood${cfg.suffix}`).src = aboveTarget ? cfg.moodGreen : cfg.moodRed;
```
**Source:** `latest` (dernière donnée globale) ✅

---

## 🔧 VÉRIFICATION SYNTAXE

### ✅ Braces/parenthèses équilibrées
- Toutes les accolades `{}` sont correctement fermées
- Toutes les parenthèses `()` sont correctement fermées
- Tous les crochets `[]` sont correctement fermés

### ✅ Template literals
- Syntaxe correcte: `` `S${e.week} ${e.year}` ``
- Syntaxe correcte: `` `startWeek${suffix}` ``
- Syntaxe correcte: `` `endWeek${suffix}` ``
- Syntaxe correcte: `` `weekNumber${cfg.suffix}` ``
- Syntaxe correcte: `` `cubage${cfg.suffix}` ``
- Syntaxe correcte: `` `hours${cfg.suffix}` ``
- Syntaxe correcte: `` `prod${cfg.suffix}` ``
- Syntaxe correcte: `` `comment${cfg.suffix}` ``
- Syntaxe correcte: `` `indicator${cfg.suffix}` ``
- Syntaxe correcte: `` `mood${cfg.suffix}` ``
- Syntaxe correcte: `` `chart${cfg.suffix}` ``
- Syntaxe correcte: `` `usineEmpty${cfg.suffix}` ``
- Syntaxe correcte: `` `usineContent${cfg.suffix}` ``

### ✅ Fonctions flèches
```javascript
const aboveTarget = machine === 'assemblage'
  ? (latestProd <= 0)
  : (latestTarget > 0
    ? (cfg.goodWhenLower ? latestProd <= latestTarget : latestProd >= latestTarget)
    : false);
```
- Syntaxe correcte ✅

### ✅ Array methods
- `map()` - syntaxe correcte
- `filter()` - syntaxe correcte
- `slice()` - syntaxe correcte
- `sort()` - syntaxe correcte

### ✅ Chaînes de caractères
- Guillemets doubles `"` équilibrés
- Backticks `` ` `` équilibrés
- Pas d'échappement manquant

### ✅ Opérateurs ternaires
- Toutes les chaînes ternaires correctement formées: `condition ? true : false`

---

## 📊 TABLEAU RÉCAPITULATIF

| Élément | Source | Impact |
|---------|--------|--------|
| **Chart: labels** | `chartEntries` | Affichées selon start/endWeek ✅ |
| **Chart: dataProd** | `chartEntries` | Filtrées selon start/endWeek ✅ |
| **Chart: dataTarget** | `chartEntries` | Filtrées selon start/endWeek ✅ |
| **KPI: weekNumber** | `latest` (withData[-1]) | Toujours dernière donnée ✅ |
| **KPI: cubage** | `latest` (withData[-1]) | Toujours dernière donnée ✅ |
| **KPI: hours** | `latest` (withData[-1]) | Toujours dernière donnée ✅ |
| **KPI: prod** | `latestProd` (from `latest`) | Toujours dernière donnée ✅ |
| **KPI: comment** | `latest` (withData[-1]) | Toujours dernière donnée ✅ |
| **KPI: indicator** | `aboveTarget` (from `latest`) | Toujours dernière donnée ✅ |

---

## ✅ CONCLUSION

**STATUS: VALIDÉ ✅**

1. ✅ **Sélection start/end semaine** impacte **UNIQUEMENT** les labels + datasets du chart
2. ✅ **weekNumber, cubage, hours, prod, comment, indicator** utilisent la **DERNIÈRE donnée globale withData**
3. ✅ **Aucune erreur syntaxique** détectée
4. ✅ **Logique conforme** aux spécifications

Le fichier est **prêt pour la production** sans modification nécessaire.

---

*Vérification effectuée: pages/cbco-usine.html (605 lignes)*
