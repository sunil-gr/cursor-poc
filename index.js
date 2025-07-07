require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const chokidar = require('chokidar');
const winston = require('winston');
const express = require('express');
const session = require('express-session');
const { router: loginRouter } = require('./routes/login');
const metricsRouter = require('./routes/metrics');
const expressLayouts = require('express-ejs-layouts');
const loginController = require('./controllers/loginController');

const logger = winston.createLogger({
  transports: [new winston.transports.Console()],
});

const {
  SQLITE_FOLDER_PATH,
  SQLITE_TABLE,
  API_ENDPOINT,
  POLL_INTERVAL_MS = 5000,
} = process.env;

let processedFiles = new Set();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'default_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Make session available in all EJS views (must be before routers)
app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// Serve static files before routers
app.use('/public', express.static('public'));

// Set up EJS and layouts before routers
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(expressLayouts);
app.set('layout', 'layout'); // default layout file (views/layout.ejs)

// Use login and metrics routers
app.use(loginRouter);
app.use(metricsRouter);

// Root route: redirect to /login if not authenticated, else to /usage-metrics
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/usage-metrics');
  }
  res.redirect('/login');
});

app.listen(PORT, () => {
  logger.info(`Usage metrics server running at http://localhost:${PORT}/usage-metrics`);
});
