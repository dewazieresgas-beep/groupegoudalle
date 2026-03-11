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
  STORAGE_KEY_AUDIT: 'goudalle_audit',          // Journal d'audit des actions

  // Rôles disponibles dans le système (hiérarchie décroissante)
  ROLES: {
    DIRECTION: 'direction',  // Accès complet : gestion + administration + audit
    REFERENT: 'referent',    // Accès intermédiaire : gestion + saisie
    REFERENT_CBCO: 'referent_cbco',  // Référent CBCO : suivi chiffre d'affaires
    REFERENT_SYLVE: 'referent_sylve',  // Référent Sylve Support
    REFERENT_GC: 'referent_gc', // Référent Goudalle Charpente
    LECTURE: 'lecture'       // Accès minimal : consultation uniquement
  },

  // Permissions par rôle - définit ce que chaque rôle peut faire
  PERMISSIONS: {
    direction: ['gm', 'gm_saisie', 'gm_paiement', 'gm_admin', 'gc', 'gc_saisie', 'gc_paiement', 'gc_admin', 'cbco', 'cbco_saisie', 'cbco_paiement', 'cbco_commercial', 'cbco_admin', 'sylve', 'sylve_saisie', 'users_admin', 'thresholds', 'audit'],
    referent: ['gm', 'gm_saisie', 'gm_paiement', 'gm_admin', 'thresholds', 'sylve'],
    referent_cbco: ['cbco', 'cbco_saisie', 'cbco_paiement', 'cbco_commercial', 'cbco_admin', 'sylve'],
    referent_sylve: ['sylve', 'sylve_saisie'],
    referent_gc: ['gc', 'gc_saisie', 'gc_paiement'],
    lecture: ['gm', 'sylve']
  },

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
      'julie': {
        username: 'julie',
        password: '123',
        role: this.ROLES.REFERENT,
        displayName: 'Julie Referent',
        createdAt: new Date().toISOString(),
        createdBy: 'acgoudalle',
        isActive: true
      },
      'christelle': {
        username: 'christelle',
        password: '123',
        role: this.ROLES.REFERENT_SYLVE,
        displayName: 'Christelle',
        createdAt: new Date().toISOString(),
        createdBy: 'acgoudalle',
        isActive: true
      },
      'mickael': {
        username: 'mickael',
        password: '123',
        role: this.ROLES.REFERENT_GC,
        displayName: 'Mickael',
        createdAt: new Date().toISOString(),
        createdBy: 'acgoudalle',
        isActive: true
      },
      'mathieu': {
        username: 'mathieu',
        password: '123',
        role: this.ROLES.REFERENT_CBCO,
        displayName: 'Mathieu',
        createdAt: new Date().toISOString(),
        createdBy: 'acgoudalle',
        isActive: true
      },
      'gaspard': {
        username: 'gaspard',
        password: '123',
        role: this.ROLES.LECTURE,
        displayName: 'Gaspard de Wazières',
        createdAt: new Date().toISOString(),
        createdBy: 'acgoudalle',
        isActive: true
      }
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
   * Crée la base de données initiale avec des comptes de démonstration
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
      // Compte référent - Peut gérer et saisir des données
      'julie': {
        username: 'julie',
        password: '123',
        role: this.ROLES.REFERENT,
        displayName: 'Julie Referent',
        createdAt: new Date().toISOString(),
        createdBy: 'acgoudalle',
        isActive: true
      },
      // Compte référent CBCO - Suivi chiffre d'affaires CBCO
      'mathieu': {
        username: 'mathieu',
        password: '123',
        role: this.ROLES.REFERENT_CBCO,
        displayName: 'Mathieu',
        createdAt: new Date().toISOString(),
        createdBy: 'acgoudalle',
        isActive: true
      },
      // Compte lecture - Consultation uniquement
      'gaspard': {
        username: 'gaspard',
        password: '123',
        role: this.ROLES.LECTURE,
        displayName: 'Gaspard de Wazières',
        createdAt: new Date().toISOString(),
        createdBy: 'acgoudalle',
        isActive: true
      },
    };
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));
  },

  // ============ LOGIN / LOGOUT ============
  /**
   * Authentifie un utilisateur avec ses identifiants
   * @param {string} username - Nom d'utilisateur
   * @param {string} password - Mot de passe
   * @returns {Object} - { success: boolean, message: string, user?: object }
   */
  login(username, password) {
    const users = this.getAllUsers();
    const user = users[username];

    // Vérification 1 : L'utilisateur existe-t-il ?
    if (!user) {
      return {
        success: false,
        message: '❌ Utilisateur non trouvé'
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
      return {
        success: false,
        message: '❌ Mot de passe incorrect'
      };
    }

    // Tout est OK : créer la session utilisateur
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
    // Enregistrer la connexion dans l'audit
    this.audit('LOGIN', `Connexion de ${username}`);

    return {
      success: true,
      message: '✅ Connexion réussie',
      user: session
    };
  },

  /**
   * Déconnecte l'utilisateur actuel
   * Supprime la session et enregistre l'action dans l'audit
   */
  logout() {
    const session = this.getSession();
    if (session) {
      this.audit('LOGOUT', `Déconnexion de ${session.username}`);
    }
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
   * Vérifie si un utilisateur est connecté
   * @returns {boolean}
   */
  isConnected() {
    return this.getSession() !== null;
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

    // Si l'utilisateur a des permissions personnalisées, les utiliser
    if (currentUser && Array.isArray(currentUser.customPermissions)) {
      return currentUser.customPermissions.includes(permission);
    }

    // Récupérer la liste des permissions pour ce rôle
    const userPermissions = this.PERMISSIONS[effectiveRole] || [];
    return userPermissions.includes(permission);
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
    this.audit('PERMISSIONS_UPDATED', `Permissions mises à jour : ${username}`);
    return { success: true, message: '✅ Permissions mises à jour' };
  },

  canViewGM() {
    return this.hasAccess('gm');
  },

  canEditGM() {
    return this.hasAccess('gm_saisie') || this.hasAccess('gm_admin');
  },

  canManageUsers() {
    return this.hasAccess('users_admin');
  },

  canManageThresholds() {
    return this.hasAccess('thresholds');
  },

  isDirection() {
    const session = this.getSession();
    return session && session.role === this.ROLES.DIRECTION;
  },

  isReferent() {
    const session = this.getSession();
    return session && session.role === this.ROLES.REFERENT;
  },

  isReferentCBCO() {
    const session = this.getSession();
    return session && session.role === this.ROLES.REFERENT_CBCO;
  },

  canViewCBCO() {
    return this.hasAccess('cbco');
  },

  canEditCBCO() {
    return this.hasAccess('cbco_saisie') || this.hasAccess('cbco_admin');
  },

  canViewSylve() {
    return this.hasAccess('sylve');
  },

  canEditSylve() {
    return this.hasAccess('sylve_saisie');
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
  registerUser(username, password, displayName, email, role = this.ROLES.LECTURE, adminCode = null, customPermissions = null) {
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
    // Les rôles DIRECTION et REFERENT nécessitent un code admin pour être créés
    if (role !== this.ROLES.LECTURE) {
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
    
    // Enregistrer dans l'audit
    this.audit('USER_CREATED', `Création utilisateur : ${username} (${role})`);

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
    this.audit('USER_DISABLED', `Desactivation : ${username}`);

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
    this.audit('USER_ENABLED', `Réactivation : ${username}`);

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
    this.audit('USER_DELETED', `Suppression définitive : ${username}`);

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
    this.audit('PASSWORD_CHANGED', `Changement mot de passe : ${username}`);

    return { success: true, message: '✅ Mot de passe changé' };
  },

  /**
   * Met à jour les informations personnelles d'un utilisateur
   * L'utilisateur peut modifier son propre profil (email, displayName)
   * @param {string} username - Identifiant de l'utilisateur
   * @param {string} newDisplayName - Nouveau nom complet
   * @param {string} newEmail - Nouvelle adresse email
   * @returns {Object} - { success: boolean, message: string }
   */
  updateUserProfile(username, newDisplayName, newEmail) {
    if (!this.isConnected()) {
      return { success: false, message: '❌ Non connecté' };
    }

    // Validation des données
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

    // Mettre à jour les informations
    users[username].displayName = newDisplayName;
    users[username].email = newEmail;
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));

    // Mettre à jour la session si c'est l'utilisateur connecté
    const session = this.getSession();
    if (session && session.username === username) {
      session.displayName = newDisplayName;
      session.email = newEmail;
      localStorage.setItem(this.STORAGE_KEY_SESSION, JSON.stringify(session));
    }

    this.audit('PROFILE_UPDATED', `Mise à jour profil : ${username}`);

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
    this.audit('ADMIN_CODE_CHANGED', 'Code d\'administration mis à jour');

    return { success: true, message: '✅ Code d\'administration mis à jour' };
  },

  getAdminCode() {
    if (!this.isDirection()) {
      return null;
    }
    return localStorage.getItem(this.STORAGE_KEY_ADMIN_CODE);
  },

  // ============ AUDIT TRAIL ============
  /**
   * Enregistre une action dans le journal d'audit
   * Permet de tracer toutes les actions importantes du système
   * @param {string} action - Type d'action (ex: 'LOGIN', 'USER_CREATED')
   * @param {string} details - Détails de l'action
   */
  audit(action, details) {
    const audit = this.getAuditTrail();
    const session = this.getSession();

    // Créer une nouvelle entrée d'audit
    audit.push({
      id: Date.now(),                              // ID unique basé sur le timestamp
      action,                                      // Type d'action
      details,                                     // Description détaillée
      user: session?.username || 'SYSTEM',         // Qui a fait l'action
      timestamp: new Date().toISOString()          // Quand (format ISO)
    });

    // Limiter le journal à 1000 entrées pour ne pas surcharger localStorage
    if (audit.length > 1000) {
      audit.shift();  // Supprimer la plus ancienne entrée
    }

    localStorage.setItem(this.STORAGE_KEY_AUDIT, JSON.stringify(audit));
  },

  getAuditTrail() {
    const audit = localStorage.getItem(this.STORAGE_KEY_AUDIT);
    return audit ? JSON.parse(audit) : [];
  },

  // ============ UTILITIES ============
  /**
   * Vérifie qu'un utilisateur est connecté, sinon redirige vers login
   * À utiliser en haut des pages protégées
   * @returns {boolean} - true si connecté, false sinon
   */
  requireAuth() {
    if (!this.isConnected()) {
      window.location.href = './login.html';
      return false;
    }
    return true;
  },

  /**
   * Vérifie qu'un utilisateur a une permission, sinon redirige vers page d'erreur
   * À utiliser pour protéger les pages selon les rôles
   * @param {string} permission - Permission requise (ex: 'users_admin')
   * @returns {boolean} - true si autorisé, false sinon
   */
  requirePermission(permission) {
    if (!this.hasAccess(permission)) {
      const base = window.location.pathname.includes('/pages/') ? '' : 'pages/';
      window.location.href = `./${base}error-access.html`;
      return false;
    }
    return true;
  }
};

// ============ INITIALISATION AUTOMATIQUE ============
// L'objet Auth s'initialise automatiquement au chargement de ce fichier
// Cela garantit que la base de données et le code admin existent toujours
Auth.init();
