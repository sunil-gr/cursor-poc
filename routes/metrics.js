// routes/metrics.js
// Handles usage metrics dashboard and API routes

const express = require('express');
const router = express.Router();
// Import requireLogin directly from the controller for authentication middleware
const { requireLogin } = require('../controllers/loginController');
const metricsController = require('../controllers/metricsController');
const { processAllStateVscdbRecursive, getAllMetrics, scanLogsForSensitiveInfo } = require('../controllers/logProcessor');

// Protect all /usage-metrics routes
router.use('/usage-metrics', requireLogin);

// New endpoint to generate logs manually
router.post('/usage-metrics/generate-logs', async (req, res) => {
  try {
    const { startDate, endDate, user } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        message: 'Please provide both startDate and endDate in YYYY-MM-DD format'
      });
    }
    
    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ 
        error: 'Invalid date format',
        message: 'Please provide valid dates in YYYY-MM-DD format'
      });
    }
    
    // Trigger log processing for the specified date range
    const sqliteFolderPath = process.env.SQLITE_FOLDER_PATH || './cursorlogs';
    
    await processAllStateVscdbRecursive(sqliteFolderPath, startDate, endDate, user);
    res.json({ 
      success: true, 
      message: `Logs generated successfully for ${startDate} to ${endDate}`,
      dateRange: { startDate, endDate },
      user: user || null
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to generate logs', 
      details: error.message 
    });
  }
});

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
    } else {
      // Fallback to days parameter
      const days = parseInt(req.query.days) || 5;
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      endDate = new Date();
    }
    
    // Use the enhanced getAllMetrics function
    const data = getAllMetrics(startDate, endDate);
    
    // Optimize data to return only what's actually displayed in the view
    const optimizedData = {
      // System & Network Information - combined section
      systemNetworkInfo: {
        // System Information
        workspaceId: data.systemInfo?.workspaceId || 'Local Workspace',
        workspaceOpenedDate: data.workspaceSettings?.workspaceOpenedDate || 'Recent',
        ipAddress: data.networkInfo?.ipAddress || 'Local Development',
        totalSessions: (() => {
          // Calculate total sessions from available session data
          const terminalSessions = data.performanceMetrics?.terminalActivity?.terminalSessions || 0;
          const composerSessions = data.performanceMetrics?.composerActivity?.totalComposers || 0;
          const aiChatSessions = data.performanceMetrics?.workspaceActivity?.activeSessions || 0;
          return terminalSessions + composerSessions + aiChatSessions;
        })(),
        // Network Information
        userAgent: (() => {
          const userAgent = data.networkInfo?.userAgent;
          if (!userAgent) return 'Cursor IDE (Electron-based)';
          
          try {
            // If it's a JSON string, parse it
            if (typeof userAgent === 'string' && userAgent.startsWith('{')) {
              const parsedUserAgent = JSON.parse(userAgent);
              if (typeof parsedUserAgent === 'string') {
                return parsedUserAgent;
              } else if (parsedUserAgent.userAgent && typeof parsedUserAgent.userAgent === 'string') {
                return parsedUserAgent.userAgent;
              } else if (parsedUserAgent.ua && typeof parsedUserAgent.ua === 'string') {
                return parsedUserAgent.ua;
              } else {
                return 'Cursor IDE (Electron-based)';
              }
            } else if (typeof userAgent === 'string') {
              return userAgent;
            } else {
              return 'Cursor IDE (Electron-based)';
            }
          } catch (e) {
            // If parsing fails, use default
            return 'Cursor IDE (Electron-based)';
          }
        })(),
        remoteConnectionsCount: data.networkInfo?.remoteConnections ? data.networkInfo.remoteConnections.length : 0,
        gitIntegration: data.systemInfo?.gitInfo ? 'Active' : 'Not detected'
      },
      
      // Performance Metrics - only the counts that are displayed
      performanceMetrics: {
        responseTimesCount: data.performanceMetrics?.responseTimes ? data.performanceMetrics.responseTimes.length : 0,
        errorRatesCount: data.performanceMetrics?.errorRates ? data.performanceMetrics.errorRates.length : 0,
        fileOperationsCount: data.performanceMetrics?.fileOperations ? data.performanceMetrics.fileOperations.length : 0,
        workspaceActivity: data.performanceMetrics?.workspaceActivity || {
          totalFiles: 0,
          uniqueFileTypes: 0,
          editorStates: 0
        },
        searchActivity: data.performanceMetrics?.searchActivity || {
          searchQueries: 0,
          findHistory: 0
        },
        terminalActivity: data.performanceMetrics?.terminalActivity || {
          terminalSessions: 0
        },
        composerActivity: data.performanceMetrics?.composerActivity || {
          totalComposers: 0,
          activeComposers: 0
        }
      },
      
      // AI Service Metrics - limit to last 10 (most recent)
      aiServiceMetrics: {
        recentPrompts: data.aiServiceMetrics?.recentPrompts?.slice(-10) || [],
        recentGenerations: data.aiServiceMetrics?.recentGenerations?.slice(-10) || []
      },
      
      // Editor Activity - limit to last 10 (most recent)
      editorActivity: {
        openedFiles: data.editorActivity?.openedFiles?.slice(-10) || []
      },
      
      // Sensitive data - limit to last 10 (most recent)
      sensitiveResults: data.sensitiveResults ? data.sensitiveResults.slice(-10) : []
    };
    
    // Check if there's any meaningful data
    const hasAnyData = Object.keys(optimizedData).length > 0 && 
      Object.values(optimizedData).some(metric => {
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
        availableMetrics: Object.keys(optimizedData),
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      });
    }
    
    // Return optimized data with summary info
    res.json({
      ...optimizedData,
      summary: {
        totalPrompts: data.prompts?.length || 0,
        totalGenerations: data.generations?.length || 0,
        totalFiles: data.editorActivity?.openedFiles?.length || 0,
        showingTop: 10,
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      }
    });
  } catch (error) {
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

// New endpoints for line changes and tab acceptance
router.get('/api/metrics/line-changes', metricsController.getLineChangesFromChat);
router.get('/api/metrics/tab-acceptance', metricsController.getTabAcceptanceData);

// Dashboard page - Modified to only read existing logs without regenerating
router.get('/usage-metrics', async (req, res) => {
  const { startDate, endDate } = req.query;
  // Use the same logic as the API to get metrics data
  const metricsController = require('../controllers/metricsController');
  // Use the same date logic as the API
  let start, end;
  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.render('dashboard', {
        title: 'AI Service Usage Metrics',
        bodyClass: 'dashboard-bg',
        head: '<script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>',
        session: req.session,
        metricsData: {},
        startDate,
        endDate,
        user: req.query.user || '',
        noLogsFound: true
      });
    }
    end.setHours(23, 59, 59, 999);
  } else {
    // Fallback to last 5 days
    start = new Date();
    start.setDate(start.getDate() - 5);
    end = new Date();
  }
  // Use the getAllMetrics function for aggregation
  const { getAllMetrics } = require('../controllers/logProcessor');
  const data = getAllMetrics(start, end);
  
  // Structure the data to match what the view expects
  const metricsData = {
    // System & Network Information - combined section
    systemNetworkInfo: {
      // System Information
      workspaceId: data.systemInfo?.workspaceId || 'Local Workspace',
      workspaceOpenedDate: data.workspaceSettings?.workspaceOpenedDate || 'Recent',
      ipAddress: data.networkInfo?.ipAddress || 'Local Development',
      totalSessions: (() => {
        // Calculate total sessions from available session data
        const terminalSessions = data.performanceMetrics?.terminalActivity?.terminalSessions || 0;
        const composerSessions = data.performanceMetrics?.composerActivity?.totalComposers || 0;
        const aiChatSessions = data.performanceMetrics?.workspaceActivity?.activeSessions || 0;
        return terminalSessions + composerSessions + aiChatSessions;
      })(),
      // Network Information
      userAgent: (() => {
        const userAgent = data.networkInfo?.userAgent;
        if (!userAgent) return 'Cursor IDE (Electron-based)';
        
        try {
          // If it's a JSON string, parse it
          if (typeof userAgent === 'string' && userAgent.startsWith('{')) {
            const parsedUserAgent = JSON.parse(userAgent);
            if (typeof parsedUserAgent === 'string') {
              return parsedUserAgent;
            } else if (parsedUserAgent.userAgent && typeof parsedUserAgent.userAgent === 'string') {
              return parsedUserAgent.userAgent;
            } else if (parsedUserAgent.ua && typeof parsedUserAgent.ua === 'string') {
              return parsedUserAgent.ua;
            } else {
              return 'Cursor IDE (Electron-based)';
            }
          } else if (typeof userAgent === 'string') {
            return userAgent;
          } else {
            return 'Cursor IDE (Electron-based)';
          }
        } catch (e) {
          // If parsing fails, use default
          return 'Cursor IDE (Electron-based)';
        }
      })(),
      remoteConnectionsCount: data.networkInfo?.remoteConnections ? data.networkInfo.remoteConnections.length : 0,
      gitIntegration: data.systemInfo?.gitInfo ? 'Active' : 'Not detected'
    },
    
    // Performance Metrics - only the counts that are displayed
    performanceMetrics: {
      responseTimesCount: data.performanceMetrics?.responseTimes ? data.performanceMetrics.responseTimes.length : 0,
      errorRatesCount: data.performanceMetrics?.errorRates ? data.performanceMetrics.errorRates.length : 0,
      fileOperationsCount: data.performanceMetrics?.fileOperations ? data.performanceMetrics.fileOperations.length : 0,
      workspaceActivity: data.performanceMetrics?.workspaceActivity || {
        totalFiles: 0,
        uniqueFileTypes: 0,
        editorStates: 0
      },
      searchActivity: data.performanceMetrics?.searchActivity || {
        searchQueries: 0,
        findHistory: 0
      },
      terminalActivity: data.performanceMetrics?.terminalActivity || {
        terminalSessions: 0
      },
      composerActivity: data.performanceMetrics?.composerActivity || {
        totalComposers: 0,
        activeComposers: 0
      }
    },
    
    // AI Service Metrics - limit to last 10 (most recent)
    aiServiceMetrics: {
      recentPrompts: data.aiServiceMetrics?.recentPrompts?.slice(-10) || [],
      recentGenerations: data.aiServiceMetrics?.recentGenerations?.slice(-10) || []
    },
    
    // Editor Activity - limit to last 10 (most recent)
    editorActivity: {
      openedFiles: data.editorActivity?.openedFiles?.slice(-10) || []
    },
    
    // Sensitive data - limit to last 10 (most recent)
    sensitiveResults: data.sensitiveResults ? data.sensitiveResults.slice(-10) : []
  };
  
  const hasAnyData = Object.keys(metricsData).length > 0 && 
    Object.values(metricsData).some(metric => {
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
    return res.render('dashboard', {
      title: 'AI Service Usage Metrics',
      bodyClass: 'dashboard-bg',
      head: '<script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>',
      session: req.session,
      metricsData: {},
      startDate,
      endDate,
      user: req.query.user || '',
      noLogsFound: true
    });
  }
  
  // Also aggregate prompt acceptance report using the same logic as in metricsController
  const prompts = data.prompts || [];
  const generations = data.generations || [];
  const promptAcceptanceReport = prompts.map((prompt, idx) => {
    let matchedGen = null;
    if (prompt.text) {
      matchedGen = generations.find(gen => {
        if (gen.textDescription && gen.textDescription.includes(prompt.text)) return true;
        if (gen.description && gen.description.includes(prompt.text)) return true;
        return false;
      });
    }
    if (!matchedGen && generations[idx]) {
      matchedGen = generations[idx];
    }
    return {
      prompt: prompt.text || '',
      status: matchedGen ? 'Accepted' : 'Rejected',
      response: matchedGen ? (matchedGen.textDescription || matchedGen.description || '') : '',
      responseRaw: matchedGen || null
    };
  });
  
  // Add prompt acceptance report to metricsData - limit to last 10 (most recent)
  metricsData.promptAcceptanceReport = promptAcceptanceReport.slice(-10);
  
  res.render('dashboard', {
    title: 'AI Service Usage Metrics',
    bodyClass: 'dashboard-bg',
    head: '<script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>',
    session: req.session,
    metricsData,
    startDate,
    endDate,
    user: req.query.user || '',
    noLogsFound: false
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
    const limit = parseInt(req.query.limit) || 10;
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
    res.status(500).json({ error: 'Failed to fetch prompts' });
  }
});

router.get('/api/metrics/generations', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
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
    res.status(500).json({ error: 'Failed to fetch generations' });
  }
});

router.get('/api/metrics/files', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
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

// Add route for viewing all prompt acceptance records
router.get('/usage-metrics/prompt-acceptance', async (req, res) => {
  const { startDate, endDate } = req.query;
  let start, end;
  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.render('prompt_acceptance', {
        title: 'Prompt Acceptance Report',
        bodyClass: 'dashboard-bg',
        session: req.session,
        records: [],
        startDate,
        endDate,
        user: req.query.user || ''
      });
    }
    end.setHours(23, 59, 59, 999);
  } else {
    start = new Date();
    start.setDate(start.getDate() - 5);
    end = new Date();
  }
  const { getAllMetrics } = require('../controllers/logProcessor');
  const data = getAllMetrics(start, end);
  const prompts = data.prompts || [];
  const generations = data.generations || [];
  const promptAcceptanceReport = prompts.map((prompt, idx) => {
    let matchedGen = null;
    if (prompt.text) {
      matchedGen = generations.find(gen => {
        if (gen.textDescription && gen.textDescription.includes(prompt.text)) return true;
        if (gen.description && gen.description.includes(prompt.text)) return true;
        return false;
      });
    }
    if (!matchedGen && generations[idx]) {
      matchedGen = generations[idx];
    }
    return {
      prompt: prompt.text || '',
      status: matchedGen ? 'Accepted' : 'Rejected',
      response: matchedGen ? (matchedGen.textDescription || matchedGen.description || '') : '',
      responseRaw: matchedGen || null
    };
  });
  res.render('prompt_acceptance', {
    title: 'Prompt Acceptance Report',
    bodyClass: 'dashboard-bg',
    session: req.session,
    records: promptAcceptanceReport,
    startDate,
    endDate,
    user: req.query.user || ''
  });
});

// Route for Generations Heatmap page
router.get('/usage-metrics/graph', async (req, res) => {
  try {
    // Use the same date/user logic as dashboard
    let start, end;
    const { startDate, endDate, user } = req.query;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.render('usage_metric_graph', {
          title: 'Usage Metrics Graph',
          bodyClass: 'dashboard-bg',
          session: req.session,
          metricsData: {},
          startDate,
          endDate,
          user: user || ''
        });
      }
      end.setHours(23, 59, 59, 999);
    } else {
      start = new Date();
      start.setDate(start.getDate() - 5); // Default to last 5 days
      end = new Date();
    }
    
    // Use getAllMetrics directly instead of the controller
    const { getAllMetrics } = require('../controllers/logProcessor');
    const metricsData = getAllMetrics(start, end);
    
    res.render('usage_metric_graph', {
      title: 'Usage Metrics Graph',
      bodyClass: 'dashboard-bg',
      session: req.session,
      metricsData,
      startDate: start.toISOString().slice(0,10),
      endDate: end.toISOString().slice(0,10),
      user: user || ''
    });
  } catch (err) {
    res.render('usage_metric_graph', {
      title: 'Usage Metrics Graph',
      bodyClass: 'dashboard-bg',
      session: req.session,
      metricsData: {},
      startDate: '',
      endDate: '',
      user: ''
    });
  }
});

module.exports = router; 