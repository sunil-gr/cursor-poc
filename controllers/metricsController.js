// controllers/metricsController.js
// Handles logic for usage metrics API

const fs = require('fs');
const path = require('path');
const { 
  processAllStateVscdbRecursive, 
  extractSystemInfo, 
  extractNetworkInfo, 
  extractPerformanceMetrics,
  extractAIServiceMetrics,
  extractEditorActivity,
  extractWorkspaceSettings,
  extractDevEnvironment,
  extractComposerData,
  getAllMetrics,
  loadLogs,
  filterLogsByDateRange,
  extractLineChangesFromChat,
  extractTabAcceptanceData
} = require('./logProcessor');
const winston = require('winston');

const logger = winston.createLogger({
  transports: [new winston.transports.Console()],
});

/**
 * Helper to get the latest log files from cursorlogs within the last N days (sorted newest first)
 */
function getRecentLogFiles(logsDir, days = 5) {
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return fs.readdirSync(logsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const fullPath = path.join(logsDir, f);
      return { name: f, path: fullPath, time: fs.statSync(fullPath).mtime.getTime() };
    })
    .filter(f => f.time >= cutoff)
    .sort((a, b) => b.time - a.time); // Newest first
}

function parseDate(str) {
  const d = new Date(str);
  return isNaN(d) ? null : d.getTime();
}

function isDateField(field) {
  return /date|time|created|updated/i.test(field);
}

/**
 * Serve usage metrics data as JSON
 * @param {Request} req
 * @param {Response} res
 */
function getUsageMetricsData(req, res) {
  const logsDir = path.join(process.cwd(), 'cursorlogs');
  const { startDate, endDate } = req.query;
  let start = parseDate(startDate);
  let end = parseDate(endDate);
  if (!start || !end) {
    // fallback: last 5 days
    start = Date.now() - 5 * 24 * 60 * 60 * 1000;
    end = Date.now();
  }
  const allLogs = fs.readdirSync(logsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const fullPath = path.join(logsDir, f);
      return { name: f, path: fullPath };
    });
  if (!allLogs.length) {
    return res.status(404).json({ error: 'No log files found in the selected range' });
  }
  try {
    // Aggregate data from all logs, filter by data date
    let prompts = [], generations = [], historyEntries = [], languages = [];
    let composerData = null, searchHistory = null, aichatViews = 0, terminalViews = 0;
    for (const log of allLogs) {
      const logData = JSON.parse(fs.readFileSync(log.path, 'utf-8'));
      const logStat = fs.statSync(log.path);
      let items = [];
      if (Array.isArray(logData)) {
        items = logData;
      } else if (logData.ItemTable && Array.isArray(logData.ItemTable)) {
        items = logData.ItemTable;
      }
      // Try to filter by date field if present
      let filtered = items;
      if (items.length && typeof items[0] === 'object') {
        const dateField = Object.keys(items[0]).find(isDateField);
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
      // Use filtered for all metrics
      const getVal = key => {
        if (!filtered) return null;
        const entry = filtered.find(e => e.key === key);
        if (!entry) return null;
        try { return JSON.parse(entry.value); } catch { return entry.value; }
      };
      // Add createdAt to each prompt if missing
      const promptArr = (getVal('aiService.prompts') || []).map(p => {
        if (!p.createdAt) {
          return { ...p, createdAt: logStat.mtime.getTime() };
        }
        return p;
      });
      prompts = prompts.concat(promptArr);
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
    
    // Prompt Acceptance Report Aggregation
    // For each prompt, determine if it was accepted (has a matching response in generations)
    const promptAcceptanceReport = prompts.map((prompt, idx) => {
      // Try to find a matching generation by text or close timestamp
      let matchedGen = null;
      if (prompt.text) {
        matchedGen = generations.find(gen => {
          // Match by textDescription or description containing the prompt text
          if (gen.textDescription && gen.textDescription.includes(prompt.text)) return true;
          if (gen.description && gen.description.includes(prompt.text)) return true;
          return false;
        });
      }
      // Fallback: match by order if no text match
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
    
    // Check if there's any meaningful data
    const hasMeaningfulData = prompts.length > 0 || generations.length > 0 || 
                             historyEntries.length > 0 || languages.length > 0 ||
                             composerData || searchHistory || aichatViews > 0 || terminalViews > 0;
    
    if (!hasMeaningfulData) {
      return res.status(404).json({ 
        error: 'No meaningful metrics data found in the selected range',
        message: 'The log files exist but contain no relevant metrics data for the specified time period.'
      });
    }
    
    // Limit sensitiveResults and promptAcceptanceReport to 10 most recent by default for API response
    const showAll = req.query.all === 'true';
    const limitedSensitiveResults = showAll ? (metricsData.sensitiveResults || []) : (metricsData.sensitiveResults || []).slice().reverse().slice(0, 10);
    const limitedPromptAcceptanceReport = showAll ? promptAcceptanceReport : promptAcceptanceReport.slice().reverse().slice(0, 10);

    // Limit all main array fields in the API response to 10 most recent by default
    function limitArr(arr) {
      return showAll ? arr : (Array.isArray(arr) ? arr.slice().reverse().slice(0, 10) : arr);
    }
    // Limit aiServiceMetrics array fields: sort by timestamp descending, then slice 0-10
    let limitedAiServiceMetrics = { ...data.aiServiceMetrics };
    if (limitedAiServiceMetrics) {
      Object.keys(limitedAiServiceMetrics).forEach(key => {
        if (Array.isArray(limitedAiServiceMetrics[key])) {
          if (!showAll) {
            // Only sort and slice if the array has timestamp or unixMs
            const arr = limitedAiServiceMetrics[key];
            if (arr.length && (arr[0].timestamp || arr[0].unixMs)) {
              limitedAiServiceMetrics[key] = arr.slice().sort((a, b) => {
                const ta = a.timestamp || a.unixMs || 0;
                const tb = b.timestamp || b.unixMs || 0;
                return tb - ta;
              }).slice(0, 10);
            } else {
              limitedAiServiceMetrics[key] = arr.slice(0, 10);
            }
          }
        }
      });
    }
    const response = {
      prompts: limitArr(prompts),
      generations: limitArr(generations),
      composerData: composerData || {},
      historyEntries: limitArr(historyEntries),
      searchHistory: limitArr(searchHistory),
      languages: limitArr(languages),
      aichatViews,
      terminalViews,
      promptAcceptanceReport: limitedPromptAcceptanceReport,
      sensitiveResults: limitedSensitiveResults,
      aiServiceMetrics: limitedAiServiceMetrics
    };
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read or parse log files', details: err.message });
  }
}

async function generateMetrics(startDate, endDate) {
  try {
    logger.info(`Generating metrics from ${startDate} to ${endDate}`);
    
    // Use the new getAllMetrics function
    const data = getAllMetrics(startDate, endDate);
    
    // Enhanced metrics with system information
    const enhancedMetrics = {
      prompts: data.aiServiceMetrics?.recentPrompts || [],
      generations: data.aiServiceMetrics?.recentGenerations || [],
      historyEntries: data.editorActivity?.openedFiles || [],
      searchHistory: data.systemInfo?.searchHistory || [],
      languages: data.devEnvironment?.languageDetection || [],
      
      // System Information
      systemInfo: {
        workspaceOpenedDate: data.workspaceSettings?.workspaceOpenedDate,
        workspaceId: data.systemInfo?.workspaceId,
        filePaths: data.systemInfo?.filePaths || [],
        searchHistory: data.systemInfo?.searchHistory || [],
        editorHistory: data.systemInfo?.editorHistory || [],
        languageUsage: data.systemInfo?.languageUsage || [],
        workspaceSettings: data.workspaceSettings || {},
        terminalInfo: data.systemInfo?.terminalInfo || {},
        gitInfo: data.systemInfo?.gitInfo || {},
        activityTimeline: data.systemInfo?.activityTimeline || []
      },
      
      // Network Information
      networkInfo: {
        ipAddress: data.networkInfo?.ipAddress,
        userAgent: data.networkInfo?.userAgent,
        remoteConnections: data.networkInfo?.remoteConnections || []
      },
      
      // Performance Metrics
      performanceMetrics: {
        responseTimes: data.performanceMetrics?.responseTimes || [],
        errorRates: data.performanceMetrics?.errorRates || [],
        fileOperations: data.performanceMetrics?.fileOperations || []
      },
      
      // AI Service Metrics
      aiServiceMetrics: data.aiServiceMetrics || {},
      
      // Editor Activity
      editorActivity: data.editorActivity || {},
      
      // Workspace Settings
      workspaceSettings: data.workspaceSettings || {},
      
      // Development Environment
      devEnvironment: data.devEnvironment || {},
      
      // Composer Data
      composerData: data.composerData || {}
    };
    
    return enhancedMetrics;
    
  } catch (error) {
    logger.error('Error generating metrics:', error);
    return {
      prompts: [],
      generations: [],
      historyEntries: [],
      searchHistory: [],
      languages: [],
      systemInfo: {},
      networkInfo: {},
      performanceMetrics: {},
      usageTimeline: [],
      fileActivity: [],
      sessionData: {}
    };
  }
}

// Get all enhanced metrics
async function getEnhancedMetrics(req, res) {
    try {
        const { startDate, endDate } = req.query;
        
        // Validate dates
        const start = startDate ? new Date(startDate) : new Date();
        const end = endDate ? new Date(endDate) : new Date();
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        // Get all enhanced metrics
        const allMetrics = getAllMetrics(start, end);
        
        res.json({
            success: true,
            data: allMetrics,
            dateRange: {
                start: start.toISOString(),
                end: end.toISOString()
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to get enhanced metrics', details: error.message });
    }
}

// Get AI service metrics
async function getAIServiceMetrics(req, res) {
    try {
        const { startDate, endDate } = req.query;
        
        const start = startDate ? new Date(startDate) : new Date();
        const end = endDate ? new Date(endDate) : new Date();
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        const logs = loadLogs();
        const filteredLogs = filterLogsByDateRange(logs, start, end);
        const aiMetrics = extractAIServiceMetrics(filteredLogs);
        
        res.json({
            success: true,
            data: aiMetrics,
            dateRange: {
                start: start.toISOString(),
                end: end.toISOString()
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to get AI service metrics', details: error.message });
    }
}

// Get editor activity metrics
async function getEditorActivityMetrics(req, res) {
    try {
        const { startDate, endDate } = req.query;
        
        const start = startDate ? new Date(startDate) : new Date();
        const end = endDate ? new Date(endDate) : new Date();
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        const logs = loadLogs();
        const filteredLogs = filterLogsByDateRange(logs, start, end);
        const editorMetrics = extractEditorActivity(filteredLogs);
        
        res.json({
            success: true,
            data: editorMetrics,
            dateRange: {
                start: start.toISOString(),
                end: end.toISOString()
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to get editor activity metrics', details: error.message });
    }
}

// Get workspace settings metrics
async function getWorkspaceSettingsMetrics(req, res) {
    try {
        const { startDate, endDate } = req.query;
        
        const start = startDate ? new Date(startDate) : new Date();
        const end = endDate ? new Date(endDate) : new Date();
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        const logs = loadLogs();
        const filteredLogs = filterLogsByDateRange(logs, start, end);
        const workspaceMetrics = extractWorkspaceSettings(filteredLogs);
        
        res.json({
            success: true,
            data: workspaceMetrics,
            dateRange: {
                start: start.toISOString(),
                end: end.toISOString()
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to get workspace settings metrics', details: error.message });
    }
}

// Get development environment metrics
async function getDevEnvironmentMetrics(req, res) {
    try {
        const { startDate, endDate } = req.query;
        
        const start = startDate ? new Date(startDate) : new Date();
        const end = endDate ? new Date(endDate) : new Date();
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        const logs = loadLogs();
        const filteredLogs = filterLogsByDateRange(logs, start, end);
        const devMetrics = extractDevEnvironment(filteredLogs);
        
        res.json({
            success: true,
            data: devMetrics,
            dateRange: {
                start: start.toISOString(),
                end: end.toISOString()
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to get development environment metrics', details: error.message });
    }
}

// Get composer data metrics
async function getComposerDataMetrics(req, res) {
    try {
        const { startDate, endDate } = req.query;
        
        const start = startDate ? new Date(startDate) : new Date();
        const end = endDate ? new Date(endDate) : new Date();
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        const logs = loadLogs();
        const filteredLogs = filterLogsByDateRange(logs, start, end);
        const composerMetrics = extractComposerData(filteredLogs);
        
        res.json({
            success: true,
            data: composerMetrics,
            dateRange: {
                start: start.toISOString(),
                end: end.toISOString()
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to get composer data metrics', details: error.message });
    }
}

/**
 * Get line changes from chat data
 * @param {Request} req
 * @param {Response} res
 */
async function getLineChangesFromChat(req, res) {
  try {
    const { startDate, endDate, user } = req.query;
    const logsDir = path.join(process.cwd(), 'cursorlogs');
    
    if (!fs.existsSync(logsDir)) {
      return res.status(404).json({ error: 'No cursorlogs directory found' });
    }

    // Get all log files
    const logFiles = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(logsDir, f));

    if (logFiles.length === 0) {
      return res.status(404).json({ error: 'No log files found' });
    }

    // Load and parse all logs
    const allLogs = [];
    for (const logFile of logFiles) {
      try {
        const logData = JSON.parse(fs.readFileSync(logFile, 'utf8'));
        allLogs.push(logData);
      } catch (parseError) {
        console.error(`Error parsing log file ${logFile}:`, parseError);
      }
    }

    if (allLogs.length === 0) {
      return res.status(404).json({ error: 'No valid log data found' });
    }

    // Extract line changes data
    const lineChangesData = extractLineChangesFromChat(allLogs);

    res.json({
      success: true,
      data: lineChangesData,
      message: 'Line changes from chat data retrieved successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve line changes from chat data',
      details: error.message
    });
  }
}

/**
 * Get tab acceptance data
 * @param {Request} req
 * @param {Response} res
 */
async function getTabAcceptanceData(req, res) {
  try {
    const { startDate, endDate, user } = req.query;
    const logsDir = path.join(process.cwd(), 'cursorlogs');
    
    if (!fs.existsSync(logsDir)) {
      return res.status(404).json({ error: 'No cursorlogs directory found' });
    }

    // Get all log files
    const logFiles = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(logsDir, f));

    if (logFiles.length === 0) {
      return res.status(404).json({ error: 'No log files found' });
    }

    // Load and parse all logs
    const allLogs = [];
    for (const logFile of logFiles) {
      try {
        const logData = JSON.parse(fs.readFileSync(logFile, 'utf8'));
        allLogs.push(logData);
      } catch (parseError) {
        console.error(`Error parsing log file ${logFile}:`, parseError);
      }
    }

    if (allLogs.length === 0) {
      return res.status(404).json({ error: 'No valid log data found' });
    }

    // Extract tab acceptance data
    const tabAcceptanceData = extractTabAcceptanceData(allLogs);

    res.json({
      success: true,
      data: tabAcceptanceData,
      message: 'Tab acceptance data retrieved successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve tab acceptance data',
      details: error.message
    });
  }
}

module.exports = {
  getUsageMetricsData,
  generateMetrics,
  getEnhancedMetrics,
  getAIServiceMetrics,
  getEditorActivityMetrics,
  getWorkspaceSettingsMetrics,
  getDevEnvironmentMetrics,
  getComposerDataMetrics,
  getLineChangesFromChat,
  getTabAcceptanceData
}; 