// controllers/loginController.js
// Handles login, logout, and authentication logic

/**
 * Render the login page
 * @param {Request} req
 * @param {Response} res
 */
exports.renderLogin = (req, res) => {
  res.render('login', { error: !!req.query.error, title: 'Login', bodyClass: 'login-bg' });
};

/**
 * Handle login POST
 * @param {Request} req
 * @param {Response} res
 */
exports.handleLogin = (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.LOGIN_USERNAME &&
    password === process.env.LOGIN_PASSWORD
  ) {
    req.session.authenticated = true;
    return res.redirect('/usage-metrics');
  }
  res.redirect('/login?error=1');
};

/**
 * Handle logout
 * @param {Request} req
 * @param {Response} res
 */
exports.handleLogout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
};

/**
 * Middleware to require login for protected routes
 */
exports.requireLogin = (req, res, next) => {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login');
};

// Helper middleware to redirect to /login if not authenticated
exports.redirectToLoginIfNotAuthenticated = (req, res, next) => {
  if (!req.session || !req.session.authenticated) {
    return res.redirect('/login');
  }
  next();
}; 