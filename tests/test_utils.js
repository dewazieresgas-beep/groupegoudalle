#!/usr/bin/env node
/**
 * TESTS FONCTIONNELS — js/utils.js
 *
 * Teste les fonctions pures qui ne dépendent pas du DOM ou du localStorage.
 * Lancer : node tests/test_utils.js
 */

'use strict';

// ─── Polyfills minimalistes pour exécuter utils.js en environnement Node ────────
const _localStorage = {};
global.localStorage = {
  getItem:    (k) => _localStorage[k] !== undefined ? _localStorage[k] : null,
  setItem:    (k, v) => { _localStorage[k] = v; },
  removeItem: (k) => { delete _localStorage[k]; }
};
global.window = {
  location: { pathname: '/pages/gm.html', href: '' },
  APP_LOGO: undefined
};
global.document = {
  addEventListener: () => {},
  documentElement: { style: {} }
};

// Stub minimal pour Auth (utilisé dans saveKPI, etc.)
global.Auth = {
  getSession: () => ({ username: 'test_user' }),
  audit: () => {}
};

// Charger utils.js
require('../client/js/utils.js');

// ─── Framework de test minimaliste ───────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓  ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${description}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Attendu null, obtenu ${JSON.stringify(actual)}`);
      }
    },
    toBeTrue()  { if (actual !== true)  throw new Error(`Attendu true, obtenu ${actual}`); },
    toBeFalse() { if (actual !== false) throw new Error(`Attendu false, obtenu ${actual}`); },
    toContain(substring) {
      if (!String(actual).includes(substring)) {
        throw new Error(`Attendu que "${actual}" contienne "${substring}"`);
      }
    },
    toBeGreaterThan(n) {
      if (!(actual > n)) throw new Error(`Attendu > ${n}, obtenu ${actual}`);
    }
  };
}

// ─── Tests : escapeHtml ───────────────────────────────────────────────────────────
console.log('\n🔒 escapeHtml');
test('échappe les < et >', () => {
  expect(escapeHtml('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;');
});
test('échappe les guillemets', () => {
  expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
});
test('échappe les apostrophes', () => {
  expect(escapeHtml("l'exemple")).toBe('l&#39;exemple');
});
test('renvoie une chaîne vide pour null', () => {
  expect(escapeHtml(null)).toBe('');
});
test('renvoie une chaîne vide pour undefined', () => {
  expect(escapeHtml(undefined)).toBe('');
});
test('passe les chaînes sans caractères spéciaux', () => {
  expect(escapeHtml('Bonjour monde')).toBe('Bonjour monde');
});

// ─── Tests : calculateRatio ───────────────────────────────────────────────────────
console.log('\n📐 calculateRatio');
test('calcule correctement h/m³', () => {
  expect(calculateRatio(100, 20)).toBe(5);
});
test('renvoie null si m³ = 0', () => {
  expect(calculateRatio(100, 0)).toBeNull();
});
test('renvoie null si m³ = null', () => {
  expect(calculateRatio(50, null)).toBeNull();
});
test('accepte les nombres décimaux', () => {
  expect(calculateRatio(7.5, 1.5)).toBe(5);
});

// ─── Tests : getSmiley ────────────────────────────────────────────────────────────
console.log('\n😊 getSmiley');
test('renvoie "neutral" si ratio null', () => {
  expect(getSmiley(null)).toBe('neutral');
});
test('renvoie "vert" si ratio <= seuil (5)', () => {
  expect(getSmiley(4.9)).toBe('vert');
});
test('renvoie "vert" si ratio = seuil exactement', () => {
  expect(getSmiley(5)).toBe('vert');
});
test('renvoie "rouge" si ratio > seuil', () => {
  expect(getSmiley(5.1)).toBe('rouge');
});

// ─── Tests : getWeekNumber ────────────────────────────────────────────────────────
console.log('\n📅 getWeekNumber (ISO 8601)');
test('semaine 1 de 2024 (1er jan 2024 = lundi)', () => {
  expect(getWeekNumber(new Date(2024, 0, 1))).toBe(1);
});
test('dernière semaine de 2023 (31 déc 2023)', () => {
  expect(getWeekNumber(new Date(2023, 11, 31))).toBe(52);
});
test('semaine 14 de 2025 (3 avril 2025)', () => {
  expect(getWeekNumber(new Date(2025, 3, 3))).toBe(14);
});
test('retourne un entier entre 1 et 53', () => {
  const w = getWeekNumber(new Date());
  expect(w >= 1 && w <= 53).toBeTrue();
});

// ─── Tests : getFiscalYear ────────────────────────────────────────────────────────
console.log('\n📊 getFiscalYear (exercice oct → sept)');
test('octobre 2025 → exercice 2025', () => {
  expect(getFiscalYear(2025, 10)).toBe(2025);
});
test('septembre 2026 → exercice 2025', () => {
  expect(getFiscalYear(2026, 9)).toBe(2025);
});
test('janvier 2026 → exercice 2025', () => {
  expect(getFiscalYear(2026, 1)).toBe(2025);
});
test('novembre 2026 → exercice 2026', () => {
  expect(getFiscalYear(2026, 11)).toBe(2026);
});

// ─── Tests : getFiscalYearLabel ───────────────────────────────────────────────────
console.log('\n🏷️  getFiscalYearLabel');
test('exercice 2025 → "2025/2026"', () => {
  expect(getFiscalYearLabel(2025)).toBe('2025/2026');
});
test('exercice 2024 → "2024/2025"', () => {
  expect(getFiscalYearLabel(2024)).toBe('2024/2025');
});

// ─── Tests : getFiscalMonth ───────────────────────────────────────────────────────
console.log('\n🗓️  getFiscalMonth (position dans l\'exercice)');
test('octobre (10) = mois 1', () => {
  expect(getFiscalMonth(10)).toBe(1);
});
test('septembre (9) = mois 12', () => {
  expect(getFiscalMonth(9)).toBe(12);
});
test('janvier (1) = mois 4', () => {
  expect(getFiscalMonth(1)).toBe(4);
});
test('mars (3) = mois 6', () => {
  expect(getFiscalMonth(3)).toBe(6);
});

// ─── Tests : getWeekString ────────────────────────────────────────────────────────
console.log('\n🔤 getWeekString');
test('semaine 1 → "S01"', () => {
  expect(getWeekString(1)).toBe('S01');
});
test('semaine 14 → "S14"', () => {
  expect(getWeekString(14)).toBe('S14');
});
test('semaine 52 → "S52"', () => {
  expect(getWeekString(52)).toBe('S52');
});

// ─── Tests : getWeekDateRange ─────────────────────────────────────────────────────
console.log('\n📆 getWeekDateRange');
test('semaine 1 de 2024 commence le lundi 01/01/2024', () => {
  const range = getWeekDateRange(1, 2024);
  expect(range.monday).toBe('01/01/2024');
});
test('semaine 1 de 2024 finit le vendredi 05/01/2024', () => {
  const range = getWeekDateRange(1, 2024);
  expect(range.friday).toBe('05/01/2024');
});
test('retourne les clés monday et friday', () => {
  const range = getWeekDateRange(10, 2025);
  expect(typeof range.monday).toBe('string');
  expect(typeof range.friday).toBe('string');
});

// ─── Tests : compareByYearWeekDesc ────────────────────────────────────────────────
console.log('\n↕️  compareByYearWeekDesc');
test('année plus récente en premier', () => {
  const result = compareByYearWeekDesc({ year: 2026, week: 1 }, { year: 2025, week: 52 });
  expect(result < 0).toBeTrue();
});
test('même année : semaine plus récente en premier', () => {
  const result = compareByYearWeekDesc({ year: 2025, week: 15 }, { year: 2025, week: 10 });
  expect(result < 0).toBeTrue();
});
test('identiques : résultat = 0', () => {
  expect(compareByYearWeekDesc({ year: 2025, week: 5 }, { year: 2025, week: 5 })).toBe(0);
});

// ─── Tests : getBasePath ──────────────────────────────────────────────────────────
console.log('\n📁 getBasePath');
test('retourne "../" depuis /pages/', () => {
  global.window.location.pathname = '/pages/gm.html';
  expect(getBasePath()).toBe('../');
});
test('retourne "./" depuis la racine', () => {
  global.window.location.pathname = '/index.html';
  expect(getBasePath()).toBe('./');
});

// ─── Tests : formatCurrency ───────────────────────────────────────────────────────
console.log('\n💶 formatCurrency');
test('formate un entier en euros', () => {
  const result = formatCurrency(1500);
  expect(result).toContain('€');
});
test('formate zéro', () => {
  const result = formatCurrency(0);
  expect(result).toContain('€');
});

// ─── Résumé ───────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  Résultat : ${passed} réussi(s)  |  ${failed} échoué(s)`);
console.log('─'.repeat(50));
process.exit(failed > 0 ? 1 : 0);
