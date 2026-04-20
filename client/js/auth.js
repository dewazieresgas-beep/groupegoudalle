/**
 * SYSTÈME D'AUTHENTIFICATION COMPLET
 * Gestion des utilisateurs, sessions, rôles et permissions
 */

const Auth = {
  // ============ CONSTANTES ============
  // Clés utilisées dans localStorage pour stocker les données de manière persistante
  STORAGE_KEY_SESSION: 'goudalle_session',      // Session utilisateur actuelle
  STORAGE_KEY_USERS: 'goudalle_users',          // Base de données des utilisateurs
  STORAGE_KEY_ADMIN_CODE: 'goudalle_admin_code', // Code pour créer des comptes direction/référent
  SESSION_TIMEOUT: 3600000,                     // Durée de session : 1 heure (en ms)

  // Rôles disponibles dans le système
  ROLES: {
    DIRECTION: 'direction',  // Accès complet : gestion + administration + audit
  },

  // Permissions : la direction a toujours accès à tout (bypass dans hasAccess).
  // Les autres utilisateurs utilisent customPermissions (géré depuis la page utilisateurs).
  PERMISSIONS: {},

  // ============ INITIALIZATION ============
  /**
   * Initialise le système au chargement de la page
   * - Crée la base de données par défaut si première utilisation
   * - Définit le code admin initial (0000) si absent
   */
  init() {
    // Créer la base de données initiale si elle n'existe pas
    if (!localStorage.getItem(this.STORAGE_KEY_USERS)) {
      this.createDefaultDatabase();
    }
    // Migration douce : si la base existe déjà, ajouter les comptes démo manquants
    this.ensureDefaultUsers();

    // Initialiser le code d'admin par défaut si absent
    if (!localStorage.getItem(this.STORAGE_KEY_ADMIN_CODE)) {
      localStorage.setItem(this.STORAGE_KEY_ADMIN_CODE, '0000');
    }
  },

  /**
   * Ajoute les comptes de démonstration manquants sans écraser les comptes existants
   * Utile quand de nouveaux comptes par défaut sont ajoutés après une première exécution
   */
  ensureDefaultUsers() {
    const users = this.getAllUsers();
    let updated = false;

    const defaultUsers = {
      'acgoudalle': {
        username: 'acgoudalle',
        password: '123',
        role: this.ROLES.DIRECTION,
        displayName: 'Anne-Cécile Goudalle',
        createdAt: new Date().toISOString(),
        createdBy: 'SYSTEM',
        isActive: true
      },
    };

    Object.keys(defaultUsers).forEach((username) => {
      if (!users[username]) {
        users[username] = defaultUsers[username];
        updated = true;
      }
    });

    if (updated) {
      localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));
    }
  },

  /**
   * Crée la base de données initiale avec uniquement le compte direction
   * Appelée uniquement lors de la première utilisation de l'application
   */
  createDefaultDatabase() {
    const users = {
      // Compte direction - Accès complet à toutes les fonctionnalités
      'acgoudalle': {
        username: 'acgoudalle',
        password: '123',
        role: this.ROLES.DIRECTION,
        displayName: 'Anne-Cécile Goudalle',
        createdAt: new Date().toISOString(),
        createdBy: 'SYSTEM',
        isActive: true
      },
    };
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));
  },

  // ============ RATE LIMITING ============
  // Limite les tentatives de connexion pour bloquer le brute-force.
  // Stocké en sessionStorage (local à l'onglet, non partagé entre appareils).
  RATE_LIMIT_MAX: 5,          // Tentatives max avant blocage
  RATE_LIMIT_WINDOW: 900000,  // Durée du blocage : 15 minutes (en ms)

  _getRateKey(username) {
    return 'rl_' + String(username).toLowerCase();
  },

  _checkRateLimit(username) {
    const key = this._getRateKey(username);
    const raw = sessionStorage.getItem(key);
    if (!raw) return { blocked: false, remaining: this.RATE_LIMIT_MAX };
    const data = JSON.parse(raw);
    if (data.blockedUntil && Date.now() < data.blockedUntil) {
      const mins = Math.ceil((data.blockedUntil - Date.now()) / 60000);
      return { blocked: true, mins };
    }
    return { blocked: false, remaining: this.RATE_LIMIT_MAX - (data.count || 0) };
  },

  _recordFailedAttempt(username) {
    const key = this._getRateKey(username);
    const raw = sessionStorage.getItem(key);
    let data = raw ? JSON.parse(raw) : { count: 0, blockedUntil: 0 };
    // Réinitialiser si le blocage précédent est expiré
    if (data.blockedUntil && Date.now() >= data.blockedUntil) {
      data = { count: 0, blockedUntil: 0 };
    }
    data.count = (data.count || 0) + 1;
    if (data.count >= this.RATE_LIMIT_MAX) {
      data.blockedUntil = Date.now() + this.RATE_LIMIT_WINDOW;
      data.count = 0;
    }
    sessionStorage.setItem(key, JSON.stringify(data));
  },

  _clearRateLimit(username) {
    sessionStorage.removeItem(this._getRateKey(username));
  },

  // ============ LOGIN / LOGOUT ============
  /**
   * Authentifie un utilisateur avec ses identifiants
   * @param {string} username - Nom d'utilisateur
   * @param {string} password - Mot de passe
   * @returns {Object} - { success: boolean, message: string, user?: object }
   */
  login(username, password) {
    // ── RATE LIMITING : bloquer le brute-force ──────────────────────────
    const rate = this._checkRateLimit(username);
    if (rate.blocked) {
      return {
        success: false,
        message: `⏳ Trop de tentatives échouées. Réessayez dans ${rate.mins} min.`
      };
    }

    const users = this.getAllUsers();
    // Recherche insensible à la casse
    const matchedKey = Object.keys(users).find(k => k.toLowerCase() === username.toLowerCase());
    const user = matchedKey ? users[matchedKey] : null;

    // Vérification 1 : L'utilisateur existe-t-il ?
    if (!user) {
      this._recordFailedAttempt(username);
      return {
        success: false,
        message: '❌ Identifiants incorrects'
      };
    }

    // Vérification 2 : Le compte est-il actif ?
    if (!user.isActive) {
      return {
        success: false,
        message: '❌ Compte désactivé. Contactez un administrateur.'
      };
    }

    // Vérification 3 : Le mot de passe est-il correct ?
    if (user.password !== password) {
      this._recordFailedAttempt(username);
      const remaining = this._checkRateLimit(username);
      const hint = remaining.blocked
        ? ` Compte temporairement bloqué (${remaining.mins} min).`
        : ` (${Math.max(0, this.RATE_LIMIT_MAX - (this.RATE_LIMIT_MAX - (remaining.remaining || 0)))} tentative(s) restante(s) avant blocage)`;
      return {
        success: false,
        message: '❌ Mot de passe incorrect' + hint
      };
    }

    // Tout est OK : réinitialiser le compteur et créer la session
    this._clearRateLimit(username);
    const session = {
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      loginAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    };

    // Sauvegarder la session dans localStorage
    localStorage.setItem(this.STORAGE_KEY_SESSION, JSON.stringify(session));
    return {
      success: true,
      message: '✅ Connexion réussie',
      user: session
    };
  },

  /**
   * Déconnecte l'utilisateur actuel
   * Supprime la session active
   */
  logout() {
    // Supprimer la session du localStorage
    localStorage.removeItem(this.STORAGE_KEY_SESSION);
  },

  // ============ SESSION ============
  /**
   * Récupère la session active de l'utilisateur
   * @returns {Object|null} Session ou null si non connecté
   */
  getSession() {
    const session = localStorage.getItem(this.STORAGE_KEY_SESSION);
    return session ? JSON.parse(session) : null;
  },

  /**
   * Vérifie si un utilisateur est connecté ET si sa session n'a pas expiré (1h après login)
   * @returns {boolean}
   */
  isConnected() {
    const session = this.getSession();
    if (!session) return false;

    // Vérifier si la session a expiré (1h après le login)
    const loginAt = session.loginAt ? new Date(session.loginAt).getTime() : 0;
    if (Date.now() - loginAt > this.SESSION_TIMEOUT) {
      this.logout();
      return false;
    }
    return true;
  },

  /**
   * Active le contrôle périodique d'expiration de session (toutes les minutes).
   * Un seul timer est créé par page, nettoyé à la fermeture de la page.
   */
  initActivityTracking() {
    if (this._activityTimer) return; // Évite les doublons si appelé plusieurs fois
    this._activityTimer = setInterval(() => {
      if (!this.isConnected()) {
        const isLoginPage = window.location.pathname.endsWith('connexion.html') ||
                            window.location.pathname.endsWith('inscription.html');
        if (!isLoginPage) {
          window.location.href = this._getLoginUrl();
        }
      }
    }, 60000);
    // Nettoyage à la fermeture de la page pour éviter les fuites mémoire
    window.addEventListener('beforeunload', () => {
      if (this._activityTimer) {
        clearInterval(this._activityTimer);
        this._activityTimer = null;
      }
    }, { once: true });
  },

  /**
   * Retourne l'URL de la page de connexion selon la page courante
   * @returns {string}
   */
  _getLoginUrl() {
    return window.location.pathname.includes('/pages/') ? '../connexion.html' : './connexion.html';
  },

  /**
   * Récupère les informations complètes de l'utilisateur connecté
   * @returns {Object|null} - Données utilisateur complètes depuis la base
   */
  getCurrentUser() {
    const session = this.getSession();
    if (!session) return null;

    const users = this.getAllUsers();
    return users[session.username] || null;
  },

  // ============ PERMISSIONS ============
  /**
   * Vérifie si l'utilisateur connecté a accès à une permission spécifique
   * @param {string} permission - Nom de la permission (ex: 'gm', 'users_admin')
   * @returns {boolean}
   */
  hasAccess(permission) {
    const session = this.getSession();
    if (!session) return false;
    const currentUser = this.getCurrentUser();
    const effectiveRole = currentUser?.role || session.role;

    // Le rôle direction doit toujours conserver un accès total,
    // même si une permission n'a pas encore été ajoutée dans la liste.
    if (effectiveRole === this.ROLES.DIRECTION) return true;

    const aliasMap = {};

    // Si l'utilisateur a des permissions personnalisées, les utiliser
    if (currentUser && Array.isArray(currentUser.customPermissions)) {
      if (currentUser.customPermissions.includes(permission)) return true;
      const aliases = aliasMap[permission] || [];
      return aliases.some(a => currentUser.customPermissions.includes(a));
    }

    // Récupérer la liste des permissions pour ce rôle
    const userPermissions = this.PERMISSIONS[effectiveRole] || [];
    if (userPermissions.includes(permission)) return true;
    const aliases = aliasMap[permission] || [];
    return aliases.some(a => userPermissions.includes(a));
  },

  /**
   * Met à jour les permissions personnalisées d'un utilisateur
   * @param {string} username - Identifiant de l'utilisateur
   * @param {string[]|null} permissions - Liste de permissions, ou null pour revenir aux permissions du rôle
   * @returns {Object} - { success: boolean, message: string }
   */
  updateUserPermissions(username, permissions) {
    if (!this.isDirection()) {
      return { success: false, message: '❌ Accès refusé' };
    }
    const users = this.getAllUsers();
    if (!users[username]) {
      return { success: false, message: '❌ Utilisateur non trouvé' };
    }
    users[username].customPermissions = permissions;
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));
    return { success: true, message: '✅ Permissions mises à jour' };
  },

  isDirection() {
    const session = this.getSession();
    return session && session.role === this.ROLES.DIRECTION;
  },

  // ============ USER MANAGEMENT ============
  /**
   * Crée un nouveau compte utilisateur
   * @param {string} username - Identifiant unique
   * @param {string} password - Mot de passe
   * @param {string} displayName - Nom complet à afficher
   * @param {string} email - Adresse email
   * @param {string} role - Rôle (lecture par défaut)
   * @param {string} adminCode - Code admin requis pour rôles direction/référent
   * @returns {Object} - { success: boolean, message: string, user?: object }
   */
  registerUser(username, password, displayName, email, role = 'lecture', adminCode = null, customPermissions = null) {
    // ===== ÉTAPE 1 : VALIDATIONS DES DONNÉES =====
    if (!username || username.length < 3) {
      return { success: false, message: '❌ Nom d\'utilisateur : 3 caractères minimum' };
    }

    if (!password || password.length < 3) {
      return { success: false, message: '❌ Mot de passe : 3 caractères minimum' };
    }

    if (!displayName || displayName.length < 3) {
      return { success: false, message: '❌ Nom complet requis' };
    }

    if (!email || !email.includes('@')) {
      return { success: false, message: '❌ Email invalide' };
    }

    // ===== ÉTAPE 2 : VÉRIFIER L'UNICITÉ =====
    const users = this.getAllUsers();
    if (users[username]) {
      return { success: false, message: '❌ Cet utilisateur existe déjà' };
    }

    // ===== ÉTAPE 3 : CONTRÔLE DE SÉCURITÉ POUR RÔLES PRIVILÉGIÉS =====
    // Seul le rôle direction nécessite un code admin
    if (role !== 'lecture') {
      const correctCode = localStorage.getItem(this.STORAGE_KEY_ADMIN_CODE);
      if (adminCode !== correctCode) {
        return { 
          success: false, 
          message: '❌ Code d\'administration invalide. Seule la direction peut créer des rôles spéciaux.' 
        };
      }
    }

    // ===== ÉTAPE 4 : CRÉER L'UTILISATEUR =====
    const newUser = {
      username,
      password,
      displayName,
      email,
      role,
      createdAt: new Date().toISOString(),
      createdBy: this.getSession()?.username || 'SYSTEM',
      isActive: true
    };

    if (customPermissions && Array.isArray(customPermissions)) {
      newUser.customPermissions = customPermissions;
    }

    // Ajouter à la base de données
    users[username] = newUser;
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));

    return { 
      success: true, 
      message: '✅ Utilisateur créé avec succès',
      user: newUser
    };
  },

  getAllUsers() {
    const users = localStorage.getItem(this.STORAGE_KEY_USERS);
    return users ? JSON.parse(users) : {};
  },

  getUserList() {
    const users = this.getAllUsers();
    return Object.values(users);
  },

  /**
   * Désactive un compte utilisateur (réservé à la direction)
   * Le compte existe toujours mais ne peut plus se connecter
   * @param {string} username - Identifiant de l'utilisateur à désactiver
   * @returns {Object} - { success: boolean, message: string }
   */
  disableUser(username) {
    // Seule la direction peut désactiver des comptes
    if (!this.isDirection()) {
      return { success: false, message: '❌ Accès refusé' };
    }

    const users = this.getAllUsers();
    if (!users[username]) {
      return { success: false, message: '❌ Utilisateur non trouvé' };
    }

    // Marquer le compte comme inactif (ne peut plus se connecter)
    users[username].isActive = false;
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));

    return { success: true, message: '✅ Utilisateur désactivé' };
  },

  /**
   * Réactive un compte utilisateur désactivé (réservé à la direction)
   * Permet au compte de se reconnecter
   * @param {string} username - Identifiant de l'utilisateur à réactiver
   * @returns {Object} - { success: boolean, message: string }
   */
  enableUser(username) {
    // Seule la direction peut réactiver des comptes
    if (!this.isDirection()) {
      return { success: false, message: '❌ Accès refusé' };
    }

    const users = this.getAllUsers();
    if (!users[username]) {
      return { success: false, message: '❌ Utilisateur non trouvé' };
    }

    // Marquer le compte comme actif
    users[username].isActive = true;
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));

    return { success: true, message: '✅ Utilisateur réactivé' };
  },

  /**
   * Supprime définitivement un compte utilisateur (réservé à la direction)
   * Les comptes direction ne peuvent pas être supprimés
   * @param {string} username - Identifiant de l'utilisateur à supprimer
   * @returns {Object} - { success: boolean, message: string }
   */
  deleteUser(username) {
    if (!this.isDirection()) {
      return { success: false, message: '❌ Accès refusé' };
    }

    const users = this.getAllUsers();
    if (!users[username]) {
      return { success: false, message: '❌ Utilisateur non trouvé' };
    }

    if (users[username].role === this.ROLES.DIRECTION) {
      return { success: false, message: '❌ Impossible de supprimer un compte Direction' };
    }

    delete users[username];
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));

    return { success: true, message: '✅ Utilisateur supprimé définitivement' };
  },

  /**
   * Change le mot de passe d'un utilisateur
   * @param {string} username - Identifiant de l'utilisateur
   * @param {string} newPassword - Nouveau mot de passe
   * @returns {Object} - { success: boolean, message: string }
   */
  changePassword(username, newPassword) {
    if (!this.isConnected()) {
      return { success: false, message: '❌ Non connecté' };
    }

    // Validation : minimum 3 caractères
    if (newPassword.length < 3) {
      return { success: false, message: '❌ Mot de passe trop court' };
    }

    const users = this.getAllUsers();
    if (!users[username]) {
      return { success: false, message: '❌ Utilisateur non trouvé' };
    }

    // Mettre à jour le mot de passe
    users[username].password = newPassword;
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));

    return { success: true, message: '✅ Mot de passe changé' };
  },

  /**
   * Met à jour les informations personnelles d'un utilisateur
   * L'utilisateur peut modifier son propre profil (email, displayName)
   * @param {string} username - Identifiant de l'utilisateur
   * @param {string} newDisplayName - Nouveau nom complet
   * @param {string} newEmail - Nouvelle adresse email
   * @param {string|null} newUsername - Nouvel identifiant (optionnel)
   * @returns {Object} - { success: boolean, message: string }
   */
  updateUserProfile(username, newDisplayName, newEmail, newUsername) {
    if (!this.isConnected()) {
      return { success: false, message: '❌ Non connecté' };
    }

    if (!newDisplayName || newDisplayName.length < 3) {
      return { success: false, message: '❌ Nom complet : 3 caractères minimum' };
    }

    if (!newEmail || !newEmail.includes('@')) {
      return { success: false, message: '❌ Email invalide' };
    }

    const users = this.getAllUsers();
    if (!users[username]) {
      return { success: false, message: '❌ Utilisateur non trouvé' };
    }

    // Changement d'identifiant
    const effectiveNewUsername = (newUsername && newUsername.trim().length >= 3) ? newUsername.trim() : null;
    if (effectiveNewUsername && effectiveNewUsername.toLowerCase() !== username.toLowerCase()) {
      const conflict = Object.keys(users).find(k => k.toLowerCase() === effectiveNewUsername.toLowerCase());
      if (conflict) {
        return { success: false, message: '❌ Cet identifiant est déjà utilisé' };
      }
    }

    // Mettre à jour les informations
    users[username].displayName = newDisplayName;
    users[username].email = newEmail;

    if (effectiveNewUsername && effectiveNewUsername !== username) {
      const userData = users[username];
      userData.username = effectiveNewUsername;
      delete users[username];
      users[effectiveNewUsername] = userData;
    }

    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));

    // Mettre à jour la session si c'est l'utilisateur connecté
    const session = this.getSession();
    if (session && session.username === username) {
      session.displayName = newDisplayName;
      session.email = newEmail;
      if (effectiveNewUsername && effectiveNewUsername !== username) {
        session.username = effectiveNewUsername;
      }
      localStorage.setItem(this.STORAGE_KEY_SESSION, JSON.stringify(session));
    }

    return { success: true, message: '✅ Profil mis à jour' };
  },

  // ============ ADMIN CODE ============
  /**
   * Modifie le code d'administration
   * Ce code est requis pour créer des comptes direction et référent
   * Seule la direction peut le modifier
   * @param {string} newCode - Nouveau code (min 4 caractères)
   * @param {Object} currentSession - Session de l'utilisateur qui fait la modification
   * @returns {Object} - { success: boolean, message: string }
   */
  setAdminCode(newCode, currentSession = null) {
    // Vérification : seule la direction peut modifier le code
    if (!currentSession || currentSession.role !== this.ROLES.DIRECTION) {
      return { success: false, message: '❌ Seul un directeur peut changer le code d\'admin' };
    }

    // Validation : minimum 4 caractères pour la sécurité
    if (!newCode || newCode.length < 4) {
      return { success: false, message: '❌ Le code doit avoir au moins 4 caractères' };
    }

    localStorage.setItem(this.STORAGE_KEY_ADMIN_CODE, newCode);

    return { success: true, message: '✅ Code d\'administration mis à jour' };
  },

  getAdminCode() {
    if (!this.isDirection()) {
      return null;
    }
    return localStorage.getItem(this.STORAGE_KEY_ADMIN_CODE);
  },

  // ============ UTILITIES ============
  /**
   * Vérifie qu'un utilisateur est connecté, sinon redirige vers login
   * À utiliser en haut des pages protégées
   * @returns {boolean} - true si connecté, false sinon
   */
  requireAuth() {
    if (!this.isConnected()) {
      window.location.href = this._getLoginUrl();
      return false;
    }
    this.initActivityTracking();
    return true;
  },

  /**
   * Vérifie qu'un utilisateur a une permission, sinon redirige vers page d'erreur
   * Attend que les données serveur soient chargées avant de vérifier les permissions
   * (évite les faux refus quand les customPermissions viennent du serveur)
   * @param {string} permission - Permission requise (ex: 'users_admin')
   */
  requirePermission(permission) {
    if (!this.isConnected()) {
      window.location.href = this._getLoginUrl();
      return false;
    }
    this.initActivityTracking();

    const check = () => {
      if (!this.hasAccess(permission)) {
        const base = window.location.pathname.includes('/pages/') ? '' : 'pages/';
        window.location.href = `./${base}erreur-acces.html`;
      } else {
        // Afficher le contenu maintenant que la permission est confirmée
        document.documentElement.style.visibility = '';
      }
    };

    // Masquer le contenu le temps que le serveur réponde
    document.documentElement.style.visibility = 'hidden';

    if (window.serverReady) {
      window.serverReady.then(check);
    } else {
      check();
    }
  }
};

// ============ INITIALISATION AUTOMATIQUE ============
// L'objet Auth s'initialise automatiquement au chargement de ce fichier
// Cela garantit que la base de données et le code admin existent toujours
Auth.init();
