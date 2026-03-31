#!/usr/bin/env node
/**
 * LANCEUR DE TESTS — Groupe Goudalle
 *
 * Lance tous les fichiers de test dans l'ordre et résume les résultats.
 * Lancer depuis la racine du projet : node tests/run_tests.js
 *
 * Retourne exit code 0 si tout passe, 1 sinon.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const suites = [
  { name: 'Syntaxe JS',         file: 'tests/test_syntax.js'      },
  { name: 'Utils (fonctions)',   file: 'tests/test_utils.js'       },
  { name: 'Auth (authentif.)',   file: 'tests/test_auth.js'        },
  { name: 'Collage CBCO',        file: 'tests/test_collage.js'     },
  { name: 'Syntaxe CBCO HTML',   file: 'tests/test_syntax_cbco.js' },
];

console.log('\n══════════════════════════════════════════════════');
console.log('  SUITE DE TESTS — Groupe Goudalle Intranet');
console.log('══════════════════════════════════════════════════\n');

let allPassed = true;

suites.forEach(suite => {
  console.log(`▶  ${suite.name}`);
  const result = spawnSync('node', [suite.file], {
    cwd: ROOT,
    stdio: 'inherit',
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    allPassed = false;
    console.log(`   ⚠️  ${suite.name} : ÉCHEC (exit ${result.status})\n`);
  } else {
    console.log(`   ✅ ${suite.name} : OK\n`);
  }
});

console.log('══════════════════════════════════════════════════');
if (allPassed) {
  console.log('  ✅ TOUS LES TESTS PASSENT');
} else {
  console.log('  ❌ CERTAINS TESTS ONT ÉCHOUÉ');
}
console.log('══════════════════════════════════════════════════\n');

process.exit(allPassed ? 0 : 1);
