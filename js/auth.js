/**
 * SYSTÈME D'AUTHENTIFICATION COMPLET
 * Gestion des utilisateurs, sessions, rôles et permissions
 */

const Auth = {
  // ============ CONSTANTES ============
  STORAGE_KEY_SESSION: 'goudalle_session',
  STORAGE_KEY_USERS: 'goudalle_users',
  STORAGE_KEY_ADMIN_CODE: 'goudalle_admin_code',
  STORAGE_KEY_AUDIT: 'goudalle_audit',

  ROLES: {
    DIRECTION: 'direction',
    REFERENT: 'referent',
    LECTURE: 'lecture'
  },

  PERMISSIONS: {
    direction: ['gm', 'gm_admin', 'users_admin', 'thresholds', 'audit'],
    referent: ['gm', 'gm_saisie', 'thresholds'],
    lecture: ['gm']
  },

  // ============ INITIALIZATION ============
  init() {
    // Créer la base de données initiale si elle n'existe pas
    if (!localStorage.getItem(this.STORAGE_KEY_USERS)) {
      this.createDefaultDatabase();
    }
    // Initialiser le code d'admin si absent
    if (!localStorage.getItem(this.STORAGE_KEY_ADMIN_CODE)) {
      localStorage.setItem(this.STORAGE_KEY_ADMIN_CODE, '0000');
    }
  },

  createDefaultDatabase() {
    const users = {
      'acgoudalle': {
        username: 'acgoudalle',
        password: '123',
        role: this.ROLES.DIRECTION,
        displayName: 'Antoine Goudalle',
        email: 'antoine@goudalle.fr',
        createdAt: new Date().toISOString(),
        createdBy: 'SYSTEM',
        isActive: true
      },
      'julie': {
        username: 'julie',
        password: '123',
        role: this.ROLES.REFERENT,
        displayName: 'Julie Referent',
        email: 'julie@goudalle.fr',
        createdAt: new Date().toISOString(),
        createdBy: 'acgoudalle',
        isActive: true
      },
      'gaspard': {
        username: 'gaspard',
        password: '123',
        role: this.ROLES.LECTURE,
        displayName: 'Gaspard Consultant',
        email: 'gaspard@goudalle.fr',
        createdAt: new Date().toISOString(),
        createdBy: 'acgoudalle',
        isActive: true
      }
    };
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));
  },

  // ============ LOGIN / LOGOUT ============
  login(username, password) {
    const users = this.getAllUsers();
    const user = users[username];

    if (!user) {
      return {
        success: false,
        message: '❌ Utilisateur non trouvé'
      };
    }

    if (!user.isActive) {
      return {
        success: false,
        message: '❌ Compte désactivé. Contactez un administrateur.'
      };
    }

    if (user.password !== password) {
      return {
        success: false,
        message: '❌ Mot de passe incorrect'
      };
    }

    // Créer la session
    const session = {
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      loginAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    };

    localStorage.setItem(this.STORAGE_KEY_SESSION, JSON.stringify(session));
    this.audit('LOGIN', `Connexion de ${username}`);

    return {
      success: true,
      message: '✅ Connexion réussie',
      user: session
    };
  },

  logout() {
    const session = this.getSession();
    if (session) {
      this.audit('LOGOUT', `Déconnexion de ${session.username}`);
    }
    localStorage.removeItem(this.STORAGE_KEY_SESSION);
  },

  // ============ SESSION ============
  getSession() {
    const session = localStorage.getItem(this.STORAGE_KEY_SESSION);
    return session ? JSON.parse(session) : null;
  },

  isConnected() {
    return this.getSession() !== null;
  },

  getCurrentUser() {
    const session = this.getSession();
    if (!session) return null;

    const users = this.getAllUsers();
    return users[session.username] || null;
  },

  // ============ PERMISSIONS ============
  hasAccess(permission) {
    const session = this.getSession();
    if (!session) return false;

    const userPermissions = this.PERMISSIONS[session.role] || [];
    return userPermissions.includes(permission);
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

  // ============ USER MANAGEMENT ============
  registerUser(username, password, displayName, email, role = this.ROLES.LECTURE, adminCode = null) {
    // Validations
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

    // Vérifier si l'utilisateur existe
    const users = this.getAllUsers();
    if (users[username]) {
      return { success: false, message: '❌ Cet utilisateur existe déjà' };
    }

    // Vérifier le rôle : si direction, besoin du code admin
    if (role === this.ROLES.DIRECTION || role === this.ROLES.REFERENT) {
      const correctCode = localStorage.getItem(this.STORAGE_KEY_ADMIN_CODE);
      if (adminCode !== correctCode) {
        return { 
          success: false, 
          message: '❌ Code d\'administration invalide. Seule la direction peut créer des rôles spéciaux.' 
        };
      }
    }

    // Créer l'utilisateur
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

    users[username] = newUser;
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));
    
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

  disableUser(username) {
    if (!this.isDirection()) {
      return { success: false, message: '❌ Accès refusé' };
    }

    const users = this.getAllUsers();
    if (!users[username]) {
      return { success: false, message: '❌ Utilisateur non trouvé' };
    }

    users[username].isActive = false;
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));
    this.audit('USER_DISABLED', `Desactivation : ${username}`);

    return { success: true, message: '✅ Utilisateur désactivé' };
  },

  changePassword(username, newPassword) {
    if (!this.isConnected()) {
      return { success: false, message: '❌ Non connecté' };
    }

    if (newPassword.length < 3) {
      return { success: false, message: '❌ Mot de passe trop court' };
    }

    const users = this.getAllUsers();
    if (!users[username]) {
      return { success: false, message: '❌ Utilisateur non trouvé' };
    }

    users[username].password = newPassword;
    localStorage.setItem(this.STORAGE_KEY_USERS, JSON.stringify(users));
    this.audit('PASSWORD_CHANGED', `Changement mot de passe : ${username}`);

    return { success: true, message: '✅ Mot de passe changé' };
  },

  // ============ ADMIN CODE ============
  setAdminCode(newCode, currentSession = null) {
    if (!currentSession || currentSession.role !== this.ROLES.DIRECTION) {
      return { success: false, message: '❌ Seul un directeur peut changer le code d\'admin' };
    }

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
  audit(action, details) {
    const audit = this.getAuditTrail();
    const session = this.getSession();

    audit.push({
      id: Date.now(),
      action,
      details,
      user: session?.username || 'SYSTEM',
      timestamp: new Date().toISOString()
    });

    // Limiter à 1000 entrées
    if (audit.length > 1000) {
      audit.shift();
    }

    localStorage.setItem(this.STORAGE_KEY_AUDIT, JSON.stringify(audit));
  },

  getAuditTrail() {
    const audit = localStorage.getItem(this.STORAGE_KEY_AUDIT);
    return audit ? JSON.parse(audit) : [];
  },

  // ============ UTILITIES ============
  requireAuth() {
    if (!this.isConnected()) {
      window.location.href = './login.html';
      return false;
    }
    return true;
  },

  requirePermission(permission) {
    if (!this.hasAccess(permission)) {
      window.location.href = './pages/error-access.html';
      return false;
    }
    return true;
  }
};

// Initialiser au chargement
Auth.init();
