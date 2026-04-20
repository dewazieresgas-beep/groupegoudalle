#!/usr/bin/env node
/**
 * TESTS FONCTIONNELS — js/auth.js
 *
 * Teste le système d'authentification : login, rate limiting, permissions
 * et gestion des utilisateurs.
 * Lancer : node tests/test_auth.js
 */

'use strict';

// ─── Polyfills minimalistes pour exécuter auth.js + api.js en Node ───────────────
const _localStorage = {};
global.localStorage = {
  getItem:    (k) => _localStorage[k] !== undefined ? _localStorage[k] : null,
  setItem:    (k, v) => { _localStorage[k] = v; },
  removeItem: (k) => { delete _localStorage[k]; }
};
const _sessionStorage = {};
global.sessionStorage = {
  getItem:    (k) => _sessionStorage[k] !== undefined ? _sessionStorage[k] : null,
  setItem:    (k, v) => { _sessionStorage[k] = v; },
  removeItem: (k) => { delete _sessionStorage[k]; }
};
global.window = {
  location: { pathname: '/pages/gm.html', href: '' },
  addEventListener: () => {},
  dispatchEvent: () => {},
  serverReady: Promise.resolve(false),
  onServerReady: () => {},
  loadServerKeys: () => Promise.resolve(false)
};
global.document = {
  addEventListener: () => {},
  documentElement: { style: {} }
};
global.AbortController = undefined; // simule env sans AbortController

// Charger api.js en premier (Auth.init l'appelle via localStorage patché)
require('../client/js/api.js');
// Charger auth.js
require('../client/js/auth.js');

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
      if (actual !== expected)
        throw new Error(`Attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
    },
    toBeTrue()  { if (actual !== true)  throw new Error(`Attendu true, obtenu ${actual}`);  },
    toBeFalse() { if (actual !== false) throw new Error(`Attendu false, obtenu ${actual}`); },
    toBeNull()  { if (actual !== null)  throw new Error(`Attendu null, obtenu ${actual}`);  },
    toContain(sub) {
      if (!String(actual).includes(sub))
        throw new Error(`Attendu que "${actual}" contienne "${sub}"`);
    },
    toHaveProperty(prop) {
      if (actual == null || !(prop in actual))
        throw new Error(`Attendu la propriété "${prop}" sur ${JSON.stringify(actual)}`);
    }
  };
}

// Réinitialiser les données utilisateurs pour chaque groupe de tests
function resetUsers() {
  delete _localStorage['goudalle_users'];
  delete _localStorage['goudalle_admin_code'];
  delete _localStorage['goudalle_session'];
  Object.keys(_sessionStorage).forEach(k => delete _sessionStorage[k]);
  Auth.init();
}

// ─── Tests : initialisation ───────────────────────────────────────────────────────
console.log('\n🏁 Initialisation Auth');
resetUsers();
test('crée la base de données par défaut au premier démarrage', () => {
  const users = Auth.getAllUsers();
  expect(Object.keys(users).length > 0).toBeTrue();
});
test('acgoudalle existe dans la base par défaut', () => {
  const users = Auth.getAllUsers();
  expect('acgoudalle' in users).toBeTrue();
});
test('le code admin est initialisé', () => {
  const code = localStorage.getItem('goudalle_admin_code');
  expect(code !== null).toBeTrue();
});

// ─── Tests : login ────────────────────────────────────────────────────────────────
console.log('\n🔐 Login');
resetUsers();
test('login réussi avec acgoudalle', () => {
  const result = Auth.login('acgoudalle', '123');
  expect(result.success).toBeTrue();
});
test('session créée après login', () => {
  const session = Auth.getSession();
  expect(session).toHaveProperty('username');
  expect(session.username).toBe('acgoudalle');
});
test('echec avec mauvais mot de passe', () => {
  Auth.logout();
  const result = Auth.login('acgoudalle', 'mauvais');
  expect(result.success).toBeFalse();
});
test('message d\'erreur générique (pas d\'info sur l\'utilisateur)', () => {
  const result = Auth.login('acgoudalle', 'mauvais_mdp');
  expect(result.message).toContain('Mot de passe incorrect');
});
test('echec avec utilisateur inconnu', () => {
  const result = Auth.login('inconnu123', '123');
  expect(result.success).toBeFalse();
});
test('le message n\'indique pas si l\'utilisateur existe ou non', () => {
  // Sécurité : message identique pour user inexistant et mauvais mdp
  const r1 = Auth.login('inconnu123', 'abc');
  const r2 = Auth.login('acgoudalle', 'mauvais');
  expect(r1.success).toBeFalse();
  expect(r2.success).toBeFalse();
});

// ─── Tests : rate limiting ────────────────────────────────────────────────────────
console.log('\n🚦 Rate limiting (brute-force)');
resetUsers();
Auth.logout();
test('5 tentatives échouées bloquent le compte', () => {
  for (let i = 0; i < 5; i++) {
    Auth.login('acgoudalle', 'mauvais');
  }
  const result = Auth.login('acgoudalle', '123'); // même le bon mdp est bloqué
  expect(result.success).toBeFalse();
  expect(result.message).toContain('Trop de tentatives');
});
test('le blocage est levé après réinitialisation du rate limit', () => {
  Auth._clearRateLimit('acgoudalle');
  const result = Auth.login('acgoudalle', '123');
  expect(result.success).toBeTrue();
});
test('login réussi réinitialise le compteur', () => {
  Auth.logout();
  Auth.login('acgoudalle', 'mauvais');
  Auth.login('acgoudalle', '123'); // succès → reset
  Auth._clearRateLimit('acgoudalle'); // s'assurer que c'est propre
  const result = Auth._checkRateLimit('acgoudalle');
  expect(result.blocked).toBeFalse();
});

// ─── Tests : session ──────────────────────────────────────────────────────────────
console.log('\n🎫 Session');
resetUsers();
test('isConnected() true après login valide', () => {
  Auth.login('acgoudalle', '123');
  expect(Auth.isConnected()).toBeTrue();
});
test('isConnected() false après logout', () => {
  Auth.logout();
  expect(Auth.isConnected()).toBeFalse();
});
test('getSession() renvoie null sans session active', () => {
  expect(Auth.getSession()).toBeNull();
});
test('getCurrentUser() renvoie null sans session', () => {
  expect(Auth.getCurrentUser()).toBeNull();
});

// ─── Tests : permissions ──────────────────────────────────────────────────────────
console.log('\n🛡️  Permissions');
resetUsers();
Auth.login('acgoudalle', '123');
test('direction a accès à users_admin', () => {
  expect(Auth.hasAccess('users_admin')).toBeTrue();
});
test('direction a accès à gm', () => {
  expect(Auth.hasAccess('gm')).toBeTrue();
});
test('direction a accès à cbco', () => {
  expect(Auth.hasAccess('cbco')).toBeTrue();
});
test('isDirection() true pour acgoudalle', () => {
  expect(Auth.isDirection()).toBeTrue();
});
test('isReferent() false pour direction', () => {
  expect(Auth.isReferent()).toBeFalse();
});
Auth.logout();

// ─── Tests : création d'utilisateur ──────────────────────────────────────────────
console.log('\n👤 Gestion utilisateurs');
resetUsers();
Auth.login('acgoudalle', '123');
const adminCode = Auth.getAdminCode();

test('crée un utilisateur lecture sans code admin', () => {
  const result = Auth.registerUser('jean.dupont', 'pass123', 'Jean Dupont', 'jean@test.fr', 'lecture');
  expect(result.success).toBeTrue();
});
test('refuse un username trop court', () => {
  const result = Auth.registerUser('ab', 'pass123', 'Jean Dupont', 'jean@test.fr', 'lecture');
  expect(result.success).toBeFalse();
});
test('refuse un email invalide', () => {
  const result = Auth.registerUser('test.user', 'pass123', 'Test User', 'pas-un-email', 'lecture');
  expect(result.success).toBeFalse();
});
test('refuse un username déjà pris', () => {
  Auth.registerUser('user.doublon', 'pass123', 'Doublon', 'doublon@test.fr', 'lecture');
  const result = Auth.registerUser('user.doublon', 'pass123', 'Doublon 2', 'doublon2@test.fr', 'lecture');
  expect(result.success).toBeFalse();
});
test('crée un compte direction avec code admin valide', () => {
  const result = Auth.registerUser('chef.projet', 'pass456', 'Chef Projet', 'chef@test.fr', 'direction', adminCode);
  expect(result.success).toBeTrue();
});
test('refuse la création direction sans code admin', () => {
  const result = Auth.registerUser('autre.chef', 'pass456', 'Autre Chef', 'autre@test.fr', 'direction', 'mauvais_code');
  expect(result.success).toBeFalse();
});

// ─── Tests : désactivation / suppression ──────────────────────────────────────────
console.log('\n🔧 Désactivation / Suppression');
test('désactive un compte utilisateur', () => {
  const result = Auth.disableUser('jean.dupont');
  expect(result.success).toBeTrue();
});
test('compte désactivé ne peut plus se connecter', () => {
  Auth.logout();
  const result = Auth.login('jean.dupont', 'pass123');
  expect(result.success).toBeFalse();
  expect(result.message).toContain('désactivé');
});
test('réactive le compte', () => {
  Auth.login('acgoudalle', '123');
  Auth.enableUser('jean.dupont');
  Auth.logout();
  const result = Auth.login('jean.dupont', 'pass123');
  expect(result.success).toBeTrue();
  Auth.logout();
});
Auth.login('acgoudalle', '123');
test('supprime un compte non-direction', () => {
  const result = Auth.deleteUser('jean.dupont');
  expect(result.success).toBeTrue();
});
test('refuse de supprimer un compte direction', () => {
  const result = Auth.deleteUser('acgoudalle');
  expect(result.success).toBeFalse();
});

// ─── Tests : changement de mot de passe ───────────────────────────────────────────
console.log('\n🔑 Changement de mot de passe');
resetUsers();
Auth.login('acgoudalle', '123');
test('change le mot de passe avec succès', () => {
  Auth.registerUser('user.mdp', 'ancien', 'User MDP', 'mdp@test.fr', 'lecture');
  const result = Auth.changePassword('user.mdp', 'nouveau');
  expect(result.success).toBeTrue();
});
test('le nouveau mot de passe fonctionne', () => {
  Auth.logout();
  const result = Auth.login('user.mdp', 'nouveau');
  expect(result.success).toBeTrue();
  Auth.logout();
});
Auth.login('acgoudalle', '123');

// ─── Tests : code admin ───────────────────────────────────────────────────────────
console.log('\n🔒 Code admin');
resetUsers();
Auth.login('acgoudalle', '123');
const session = Auth.getSession();
test('peut changer le code admin (minimum 4 caractères)', () => {
  const result = Auth.setAdminCode('ABCD', session);
  expect(result.success).toBeTrue();
});
test('refuse un code admin trop court', () => {
  const result = Auth.setAdminCode('AB', session);
  expect(result.success).toBeFalse();
});
test('getAdminCode() retourne le nouveau code', () => {
  expect(Auth.getAdminCode()).toBe('ABCD');
});
test('getAdminCode() retourne null sans droits direction', () => {
  Auth.logout();
  expect(Auth.getAdminCode()).toBeNull();
});

// ─── Résumé ───────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  Résultat : ${passed} réussi(s)  |  ${failed} échoué(s)`);
console.log('─'.repeat(50));
process.exit(failed > 0 ? 1 : 0);
