// routes/login.js
// Handles login, logout, and authentication routes

const express = require('express');
const router = express.Router();
const loginController = require('../controllers/loginController');

// Login page (GET)
router.get('/login', loginController.renderLogin);

// Login handler (POST)
router.post('/login', loginController.handleLogin);

// Logout route
router.get('/logout', loginController.handleLogout);

// Export the requireLogin middleware for use in other routes
module.exports = {
  router,
  requireLogin: loginController.requireLogin
}; 