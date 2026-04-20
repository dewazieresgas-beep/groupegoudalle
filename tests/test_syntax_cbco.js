#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../client/pages', 'production-indicateurs-usine-cbco.html');
const html = fs.readFileSync(filePath, 'utf-8');

// Extract JavaScript blocks
const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
let match;
let scriptCount = 0;
let hasErrors = false;

console.log('Vérification syntaxe cbco-usine.html\n');

while ((match = scriptRegex.exec(html)) !== null) {
  scriptCount++;
  const code = match[1];
  
  // Only check inline scripts (not external src)
  if (!match[0].includes('src=')) {
    try {
      // Basic syntax check
      new Function(code);
      console.log(`✓ Block ${scriptCount}: Syntaxe OK`);
    } catch (e) {
      console.error(`✗ Block ${scriptCount}: Erreur syntaxe`);
      console.error(`  ${e.message}`);
      hasErrors = true;
    }
  }
}

console.log(`\n=== VÉRIFICATION LOGIQUE ===\n`);

// Check the logic as requested
const logicChecks = [
  {
    name: 'getSelectedEntries() - retourne chartEntries basé sur start/endWeek',
    pattern: /function getSelectedEntries.*?return withData\.slice\(startIndex, endIndex \+ 1\);/s,
    found: false
  },
  {
    name: 'renderMachineSection() - chartEntries utilisé SEULEMENT pour chart',
    pattern: /const chartEntries = getSelectedEntries\(withData, cfg\.suffix\);[\s\S]*?const labels = chartEntries\.map/,
    found: false
  },
  {
    name: 'withData[withData.length - 1] utilisé pour KPIs (weekNumber, cubage, hours, prod, comment, indicator)',
    pattern: /const latest = withData\[withData\.length - 1\];[\s\S]*?document\.getElementById\(`weekNumber\$\{cfg\.suffix\}`\)\.textContent = latest/,
    found: false
  },
  {
    name: 'dataProd[] créé depuis chartEntries (chart only)',
    pattern: /const dataProd = chartEntries\.map/,
    found: false
  },
  {
    name: 'latestProd calculé depuis latest (dernier élément de withData)',
    pattern: /const latestProd = \(\(\) => \{[\s\S]*?const direct = toFiniteNumber\(latest\[cfg\.prodField\]\);/,
    found: false
  },
  {
    name: 'KPIs mis à jour avec latest, pas chartEntries',
    pattern: /document\.getElementById\(`cubage\$\{cfg\.suffix\}`\)\.textContent = formatNumber\(Number\(latest\[cfg\.m3Field\]\)/,
    found: false
  }
];

logicChecks.forEach(check => {
  if (check.pattern.test(html)) {
    console.log(`✓ ${check.name}`);
  } else {
    console.log(`✗ ${check.name}`);
    hasErrors = true;
  }
});

console.log(`\n=== RÉSUMÉ ===`);
console.log(`Scripts trouvés: ${scriptCount}`);
console.log(hasErrors ? '❌ ERREURS DÉTECTÉES' : '✅ AUCUNE ERREUR');

process.exit(hasErrors ? 1 : 0);
