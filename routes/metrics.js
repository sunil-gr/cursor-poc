// routes/metrics.js
// Handles usage metrics dashboard and API routes

console.log('=== METRICS ROUTE LOADED ===');

const express = require('express');
const router = express.Router();
// Import requireLogin directly from the controller for authentication middleware
const { requireLogin } = require('../controllers/loginController');
const metricsController = require('../controllers/metricsController');
const { processAllStateVscdbRecursive, getAllMetrics, scanLogsForSensitiveInfo } = require('../controllers/logProcessor');

// Protect all /usage-metrics routes
router.use('/usage-metrics', requireLogin);

// JSON API for usage metrics (aggregate last 5 days, newest logs first)
router.get('/usage-metrics/data', metricsController.getUsageMetricsData);

// API endpoint to get metrics data
router.get('/api/metrics', async (req, res) => {
  try {
    let startDate, endDate;
    
    // Check if startDate and endDate are provided in query parameters
    if (req.query.startDate && req.query.endDate) {
      startDate = new Date(req.query.startDate);
      endDate = new Date(req.query.endDate);
      
      // Validate dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ 
          error: 'Invalid date format',
          message: 'Please provide valid dates in YYYY-MM-DD format'
        });
      }
      
      // Set end date to end of day
      endDate.setHours(23, 59, 59, 999);
      
      // Trigger log processing for the specified date range
      const sqliteFolderPath = process.env.SQLITE_FOLDER_PATH || './cursorlogs';
      
      try {
        await processAllStateVscdbRecursive(sqliteFolderPath, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]);
        console.log(`Processed logs for date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
      } catch (processingError) {
        console.error('Error processing logs:', processingError);
        // Continue even if processing fails, as there might be existing logs
      }
    } else {
      // Fallback to days parameter
      const days = parseInt(req.query.days) || 5;
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      endDate = new Date();
    }
    
    // Use the enhanced getAllMetrics function
    const data = getAllMetrics(startDate, endDate);
    
    // Check if there's any meaningful data
    const hasAnyData = Object.keys(data).length > 0 && 
      Object.values(data).some(metric => {
        if (!metric) return false;
        if (Array.isArray(metric)) return metric.length > 0;
        if (typeof metric === 'object') {
          return Object.values(metric).some(val => {
            if (Array.isArray(val)) return val.length > 0;
            if (typeof val === 'object' && val !== null) return Object.keys(val).length > 0;
            return val && val !== '' && val !== '-' && val !== 0;
          });
        }
        return metric && metric !== '' && metric !== '-' && metric !== 0;
      });
    
    if (!hasAnyData) {
      return res.status(404).json({ 
        error: 'No meaningful metrics data found',
        message: 'No metrics data was found for the specified time period. This could be because no log files exist or the data format has changed.',
        availableMetrics: Object.keys(data),
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      });
    }
    
    // Before sending metrics data to the frontend, add debug log
    console.log('Sending metrics data to frontend:', data);
    
    res.json(data);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics', details: error.message });
  }
});

// Enhanced metrics endpoints
router.get('/api/metrics/enhanced', metricsController.getEnhancedMetrics);
router.get('/api/metrics/ai-service', metricsController.getAIServiceMetrics);
router.get('/api/metrics/editor-activity', metricsController.getEditorActivityMetrics);
router.get('/api/metrics/workspace-settings', metricsController.getWorkspaceSettingsMetrics);
router.get('/api/metrics/dev-environment', metricsController.getDevEnvironmentMetrics);
router.get('/api/metrics/composer-data', metricsController.getComposerDataMetrics);

// Dashboard page
router.get('/usage-metrics', (req, res) => {
  const logsDir = require('path').join(process.cwd(), 'cursorlogs');
  const fs = require('fs');
  const { startDate, endDate } = req.query;
  let start = startDate ? new Date(startDate).getTime() : 0;
  let end = endDate ? new Date(endDate).getTime() : Date.now();
  const allLogs = fs.readdirSync(logsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const fullPath = require('path').join(logsDir, f);
      return { name: f, path: fullPath };
    });
  let metricsData = {};
  if (allLogs.length) {
    let prompts = [], generations = [], historyEntries = [], languages = [];
    let composerData = null, searchHistory = null, aichatViews = 0, terminalViews = 0;
    for (const log of allLogs) {
      const logData = JSON.parse(fs.readFileSync(log.path, 'utf-8'));
      let items = [];
      if (Array.isArray(logData)) {
        items = logData;
      } else if (logData.ItemTable && Array.isArray(logData.ItemTable)) {
        items = logData.ItemTable;
      }
      let filtered = items;
      if (items.length && typeof items[0] === 'object') {
        const dateField = Object.keys(items[0]).find(field => /date|time|created|updated/i.test(field));
        if (dateField) {
          filtered = items.filter(row => {
            const val = row[dateField];
            if (!val) return false;
            let dateVal = null;
            if (typeof val === 'number') {
              dateVal = val > 1e12 ? val : val * 1000;
            } else if (typeof val === 'string') {
              const parsed = Date.parse(val);
              if (!isNaN(parsed)) dateVal = parsed;
            }
            if (!dateVal) return false;
            return dateVal >= start && dateVal <= end;
          });
        }
      }
      const getVal = key => {
        if (!filtered) return null;
        const entry = filtered.find(e => e.key === key);
        if (!entry) return null;
        try { return JSON.parse(entry.value); } catch { return entry.value; }
      };
      prompts = prompts.concat(getVal('aiService.prompts') || []);
      generations = generations.concat(getVal('aiService.generations') || []);
      historyEntries = historyEntries.concat(getVal('history.entries') || []);
      const langs = getVal('workbench.editor.languageDetectionOpenedLanguages.workspace') || [];
      langs.forEach(l => {
        if (!languages.some(existing => existing[0] === l[0])) languages.push(l);
      });
      if (!composerData) composerData = getVal('composer.composerData');
      if (!searchHistory) searchHistory = getVal('workbench.search.history');
      aichatViews = Math.max(aichatViews, parseInt(getVal('workbench.panel.aichat.numberOfVisibleViews') || 0));
      terminalViews = Math.max(terminalViews, parseInt(getVal('workbench.numberOfVisibleViews') || 0));
    }
    prompts = prompts.reverse();
    generations = generations.reverse();
    historyEntries = historyEntries.reverse();
    // Add sensitive info scan results
    const { results: sensitiveResults, keywordCounts: sensitiveKeywordCounts } = scanLogsForSensitiveInfo();
    // Add performance metrics from getAllMetrics
    const allMetrics = getAllMetrics(startDate, endDate);
    const performanceMetrics = allMetrics.performanceMetrics || {};
    metricsData = {
      prompts,
      generations,
      composerData: composerData || {},
      historyEntries,
      searchHistory: searchHistory || {},
      languages,
      aichatViews,
      terminalViews,
      sensitiveResults,
      sensitiveKeywordCounts,
      performanceMetrics
    };
  }
  // Before sending metrics data to the frontend, add debug log
  console.log('Sending metrics data to frontend:', metricsData);
  res.render('dashboard', {
    title: 'AI Service Usage Metrics',
    bodyClass: 'dashboard-bg',
    head: '<script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>',
    session: req.session,
    metricsData,
    startDate,
    endDate
  });
});

// Dashboard page with log selection
router.get('/dashboard', requireLogin, (req, res) => {
  res.render('dashboard_select', {
    title: 'Select Metrics Range',
    bodyClass: 'dashboard-bg',
    session: req.session
  });
});

// Detailed views for prompts, generations, and files
router.get('/usage-metrics/prompts', requireLogin, (req, res) => {
  res.render('prompts_detail', {
    title: 'All Prompts',
    bodyClass: 'dashboard-bg',
    head: '<script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>',
    session: req.session
  });
});

router.get('/usage-metrics/generations', requireLogin, (req, res) => {
  res.render('generations_detail', {
    title: 'All Generations',
    bodyClass: 'dashboard-bg',
    head: '<script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>',
    session: req.session
  });
});

router.get('/usage-metrics/files', requireLogin, (req, res) => {
  res.render('files_detail', {
    title: 'All Files',
    bodyClass: 'dashboard-bg',
    head: '<script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>',
    session: req.session
  });
});

router.get('/usage-metrics/remote-connections', requireLogin, (req, res) => {
  res.render('remote_connections_detail', {
    title: 'Remote Connections',
    bodyClass: 'dashboard-bg',
    session: req.session
  });
});

// API endpoints for detailed data with pagination
router.get('/api/metrics/prompts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const days = parseInt(req.query.days) || 30;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const endDate = new Date();
    
    const data = getAllMetrics(startDate, endDate);
    let prompts = data.aiServiceMetrics?.recentPrompts || [];
    
    // Simply reverse the array to get most recent first (assuming newer items are at the end)
    prompts = prompts.reverse();
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedPrompts = prompts.slice(startIndex, endIndex);
    
    res.json({
      prompts: paginatedPrompts,
      total: prompts.length,
      page: page,
      limit: limit,
      totalPages: Math.ceil(prompts.length / limit)
    });
  } catch (error) {
    console.error('Error fetching prompts:', error);
    res.status(500).json({ error: 'Failed to fetch prompts' });
  }
});

router.get('/api/metrics/generations', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const days = parseInt(req.query.days) || 30;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const endDate = new Date();
    
    const data = getAllMetrics(startDate, endDate);
    let generations = data.aiServiceMetrics?.recentGenerations || [];
    
    // Simply reverse the array to get most recent first (assuming newer items are at the end)
    generations = generations.reverse();
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedGenerations = generations.slice(startIndex, endIndex);
    
    res.json({
      generations: paginatedGenerations,
      total: generations.length,
      page: page,
      limit: limit,
      totalPages: Math.ceil(generations.length / limit)
    });
  } catch (error) {
    console.error('Error fetching generations:', error);
    res.status(500).json({ error: 'Failed to fetch generations' });
  }
});

router.get('/api/metrics/files', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const days = parseInt(req.query.days) || 30;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const endDate = new Date();
    
    const data = getAllMetrics(startDate, endDate);
    let files = data.editorActivity?.openedFiles || [];
    
    // Simply reverse the array to get most recent first (assuming newer items are at the end)
    files = files.reverse();
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedFiles = files.slice(startIndex, endIndex);
    
    res.json({
      files: paginatedFiles,
      total: files.length,
      page: page,
      limit: limit,
      totalPages: Math.ceil(files.length / limit)
    });
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

const parseDate = (str) => {
  const d = new Date(str);
  return isNaN(d) ? null : d.getTime();
};

router.post('/dashboard', requireLogin, async (req, res) => {
  const { startDate, endDate } = req.body;
  await processAllStateVscdbRecursive(process.env.SQLITE_FOLDER_PATH, startDate, endDate);
  // Redirect to usage-metrics page with startDate and endDate as query params
  res.redirect(`/usage-metrics?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
});

const isDateField = (field) => {
  return /date|time|created|updated/i.test(field);
};

const isRecent = (value, days) => {
  if (!value) return false;
  const now = Date.now();
  let dateVal = null;
  if (typeof value === 'number') {
    // Assume unix timestamp (ms or s)
    dateVal = value > 1e12 ? value : value * 1000;
  } else if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) dateVal = parsed;
  }
  if (!dateVal) return false;
  return dateVal >= (now - days * 24 * 60 * 60 * 1000);
};

router.get('/usage-metrics/sensitive-report', requireLogin, (req, res) => {
  const { results, keywordCounts } = scanLogsForSensitiveInfo();
  res.render('sensitive_report', {
    title: 'Sensitive Info Report',
    bodyClass: 'dashboard-bg',
    session: req.session,
    results,
    keywordCounts
  });
});

module.exports = router; 