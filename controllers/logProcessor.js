const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const winston = require('winston');

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

const writeDataToCursorLogs = (baseName, data, ext = 'json') => {
  const logsDir = path.join(process.cwd(), 'cursorlogs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  let jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(logsDir, `${baseName}-${timestamp}.${ext}`);
  fs.writeFileSync(outPath, jsonStr, 'utf-8');
  logger.info(`[LogProcessor] Wrote log: ${outPath}`);
};

const listTablesInDb = (dbPath) => {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
      db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", (err, rows) => {
        db.close();
        if (err) return reject(err);
        resolve(rows.map(r => r.name));
      });
    });
  });
};

const runQueryAndSend = async (filePath) => {
  // List all tables for debug and process all tables
  let tables = [];
  try {
    tables = await listTablesInDb(filePath);
    logger.info(`[LogProcessor] Tables in ${filePath}: ${tables.join(', ') || '(none)'}`);
  } catch (err) {
    logger.error(`[LogProcessor] Failed to list tables in ${filePath}: ${err.message}`);
    return;
  }
  if (tables.length === 0) {
    logger.warn(`[LogProcessor] No tables found in ${filePath}`);
    return;
  }
  for (const table of tables) {
    await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, async (err) => {
        if (err) return reject(err);
        const query = `SELECT * FROM ${table}`;
        db.all(query, async (err, rows) => {
          db.close();
          if (err) {
            logger.error(`[LogProcessor] Error querying table ${table} in ${filePath}: ${err.message}`);
            return resolve();
          }
          if (Array.isArray(rows) && rows.length > 0) {
            try {
              // Write log to cursorlogs for this table
              writeDataToCursorLogs(`${path.basename(filePath, '.vscdb')}_${table}`, rows, 'json');
              logger.info(`[LogProcessor] Wrote log for table ${table} in ${filePath}`);
            } catch (apiErr) {
              logger.error(`[LogProcessor] Error writing log for table ${table} in ${filePath}: ${apiErr.message}`);
            }
          } else {
            logger.info(`[LogProcessor] No data in table ${table} from ${filePath}.`);
          }
          resolve();
        });
      });
    });
  }
};

const walkAndFindFiles = (dir, filename = 'state.vscdb', fileList = []) => {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkAndFindFiles(filePath, filename, fileList);
    } else if (file === filename) {
      fileList.push(filePath);
    }
  });
  return fileList;
};

function getRecentStateVscdbFiles(baseDir, days = 5) {
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const allFiles = walkAndFindFiles(baseDir, 'state.vscdb');
  return allFiles.filter(filePath => {
    const stat = fs.statSync(filePath);
    return stat.mtime.getTime() >= cutoff;
  });
}

async function processAllStateVscdbRecursive(baseDir, startDate, endDate) {
  logger.info(`[LogProcessor] Starting log generation for baseDir: ${baseDir}`);
  // Clear all old logs before generating new ones
  const logsDir = path.join(process.cwd(), 'cursorlogs');
  if (fs.existsSync(logsDir)) {
    logger.info(`[LogProcessor] Clearing old logs in ${logsDir}`);
    fs.readdirSync(logsDir).forEach(file => {
      if (file.endsWith('.json')) {
        logger.info(`[LogProcessor] Deleting old log: ${file}`);
        fs.unlinkSync(path.join(logsDir, file));
      }
    });
  } else {
    logger.info(`[LogProcessor] Creating logs directory: ${logsDir}`);
    fs.mkdirSync(logsDir);
  }
  // Clear processedFiles set so files are always processed
  processedFiles.clear();
  logger.info(`[LogProcessor] Looking for state.vscdb files...`);
  let files = getRecentStateVscdbFiles(baseDir, 10000); // get all files first
  if (startDate && endDate) {
    let start = new Date(startDate);
    let end = new Date(endDate);
    if (start.toDateString() === end.toDateString()) {
      // Set end to end of the day
      end.setHours(23, 59, 59, 999);
    }
    start = start.getTime();
    end = end.getTime();
    files = files.filter(filePath => {
      const stat = fs.statSync(filePath);
      return stat.mtime.getTime() >= start && stat.mtime.getTime() <= end;
    });
    logger.info(`[LogProcessor] Filtered to ${files.length} state.vscdb files in date range ${startDate} to ${endDate}`);
  } else {
    logger.info(`[LogProcessor] Found ${files.length} state.vscdb files in ${baseDir}`);
  }
  if (files.length === 0) {
    logger.warn(`[LogProcessor] No state.vscdb files found in ${baseDir}`);
  }
  for (const filePath of files) {
    logger.info(`[LogProcessor] Processing: ${filePath}`);
    if (!processedFiles.has(filePath)) {
      try {
        await runQueryAndSend(filePath);
        processedFiles.add(filePath);
        logger.info(`[LogProcessor] Finished and logged: ${filePath}`);
      } catch (err) {
        logger.error(`[LogProcessor] Failed processing ${filePath}: ${err.message}`);
      }
    } else {
      logger.info(`[LogProcessor] Skipping already processed: ${filePath}`);
    }
  }
  logger.info(`[LogProcessor] Log generation complete.`);
};

// Function to extract system information from cursorlogs
function extractSystemInfo(logData) {
  const systemInfo = {
    workspaceOpenedDate: null,
    userAgent: null,
    platform: null,
    os: null,
    cursorVersion: null,
    workspaceId: null,
    machineId: null,
    ipAddress: null,
    sessionInfo: {},
    filePaths: [],
    extensions: [],
    terminalInfo: {},
    gitInfo: {},
    searchHistory: [],
    editorHistory: [],
    languageUsage: [],
    workspaceSettings: {},
    performanceMetrics: {},
    errorLogs: [],
    activityTimeline: []
  };

  try {
    logData.forEach(item => {
      const { key, value } = item;
      
      // Extract workspace opened date
      if (key === 'cursorAuth/workspaceOpenedDate') {
        systemInfo.workspaceOpenedDate = value;
      }
      
      // Extract workspace ID
      if (key === 'terminal.integrated.layoutInfo') {
        try {
          const layoutInfo = JSON.parse(value);
          if (layoutInfo.workspaceId) {
            systemInfo.workspaceId = layoutInfo.workspaceId;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract search history
      if (key === 'workbench.search.history') {
        try {
          const searchData = JSON.parse(value);
          if (searchData.search && Array.isArray(searchData.search)) {
            systemInfo.searchHistory = searchData.search;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract find history
      if (key === 'workbench.find.history') {
        try {
          const findData = JSON.parse(value);
          if (Array.isArray(findData)) {
            systemInfo.searchHistory = [...systemInfo.searchHistory, ...findData];
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract editor history
      if (key === 'history.entries') {
        try {
          const historyData = JSON.parse(value);
          if (Array.isArray(historyData)) {
            systemInfo.editorHistory = historyData.map(entry => {
              if (entry.editor && entry.editor.resource) {
                return {
                  file: entry.editor.resource,
                  timestamp: entry.timestamp || null
                };
              }
              return null;
            }).filter(Boolean);
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract language usage
      if (key === 'workbench.editor.languageDetectionOpenedLanguages.workspace') {
        try {
          const langData = JSON.parse(value);
          if (Array.isArray(langData)) {
            systemInfo.languageUsage = langData.map(([lang, active]) => ({
              language: lang,
              active: active,
              count: 1
            }));
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract terminal information
      if (key === 'terminal.integrated.environmentVariableCollectionsV2') {
        try {
          const terminalData = JSON.parse(value);
          systemInfo.terminalInfo = {
            environmentVariables: terminalData,
            hasGitIntegration: terminalData.some(item => 
              item.extensionIdentifier === 'vscode.git'
            )
          };
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract Git information
      if (key === 'vscode.git') {
        try {
          const gitData = JSON.parse(value);
          systemInfo.gitInfo = {
            closedRepositories: gitData.closedRepositories || [],
            hasGitIntegration: true
          };
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract workspace settings
      if (key.includes('workbench.') && !key.includes('state')) {
        try {
          const settingValue = JSON.parse(value);
          systemInfo.workspaceSettings[key] = settingValue;
        } catch (e) {
          systemInfo.workspaceSettings[key] = value;
        }
      }
      
      // Extract file paths from various sources
      if (value && typeof value === 'string' && value.includes('file:///')) {
        const fileMatches = value.match(/file:\/\/\/[^"]+/g);
        if (fileMatches) {
          systemInfo.filePaths.push(...fileMatches);
        }
      }
      
      // Extract activity timeline
      if (key.includes('timestamp') || key.includes('date') || key.includes('time')) {
        try {
          const timestamp = new Date(value);
          if (!isNaN(timestamp.getTime())) {
            systemInfo.activityTimeline.push({
              key: key,
              timestamp: timestamp,
              value: value
            });
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    });
    
    // Process and clean up the data
    systemInfo.filePaths = [...new Set(systemInfo.filePaths)]; // Remove duplicates
    systemInfo.searchHistory = [...new Set(systemInfo.searchHistory)]; // Remove duplicates
    
    // Aggregate language usage
    const langCounts = {};
    systemInfo.languageUsage.forEach(lang => {
      if (langCounts[lang.language]) {
        langCounts[lang.language].count++;
      } else {
        langCounts[lang.language] = lang;
      }
    });
    systemInfo.languageUsage = Object.values(langCounts);
    
    // Sort activity timeline by timestamp
    systemInfo.activityTimeline.sort((a, b) => a.timestamp - b.timestamp);
    
  } catch (error) {
    logger.error('Error extracting system info:', error);
  }
  
  return systemInfo;
}

// Function to extract IP address and network information
function extractNetworkInfo(logData) {
  const networkInfo = {
    ipAddress: null,
    userAgent: null,
    networkInterfaces: [],
    connectionInfo: {},
    remoteConnections: []
  };
  
  try {
    logData.forEach(item => {
      const { key, value } = item;
      
      // Look for IP addresses in various formats
      if (value && typeof value === 'string') {
        // IPv4 pattern
        const ipv4Matches = value.match(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g);
        if (ipv4Matches) {
          networkInfo.ipAddress = ipv4Matches[0];
        }
        
        // IPv6 pattern
        const ipv6Matches = value.match(/\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g);
        if (ipv6Matches && !networkInfo.ipAddress) {
          networkInfo.ipAddress = ipv6Matches[0];
        }
        
        // Look for user agent strings in various formats
        if (typeof value === 'string' && (
              value.toLowerCase().includes('mozilla') ||
              value.toLowerCase().includes('chrome') ||
              value.toLowerCase().includes('safari') ||
              value.toLowerCase().includes('firefox') ||
              value.toLowerCase().includes('edge')
            )) {
          networkInfo.userAgent = value;
        } else if (typeof value === 'string' && value.trim().startsWith('{')) {
          // Try to parse JSON if the value looks like JSON
          try {
            const parsedValue = JSON.parse(value);
            // Look for user agent in common JSON structures
            if (parsedValue.userAgent && typeof parsedValue.userAgent === 'string' && (
                  parsedValue.userAgent.toLowerCase().includes('mozilla') ||
                  parsedValue.userAgent.toLowerCase().includes('chrome') ||
                  parsedValue.userAgent.toLowerCase().includes('safari') ||
                  parsedValue.userAgent.toLowerCase().includes('firefox') ||
                  parsedValue.userAgent.toLowerCase().includes('edge')
                )) {
              networkInfo.userAgent = parsedValue.userAgent;
            } else if (parsedValue.ua && typeof parsedValue.ua === 'string' && (
                  parsedValue.ua.toLowerCase().includes('mozilla') ||
                  parsedValue.ua.toLowerCase().includes('chrome') ||
                  parsedValue.ua.toLowerCase().includes('safari') ||
                  parsedValue.ua.toLowerCase().includes('firefox') ||
                  parsedValue.ua.toLowerCase().includes('edge')
                )) {
              networkInfo.userAgent = parsedValue.ua;
            } else if (parsedValue.agent && typeof parsedValue.agent === 'string' && (
                  parsedValue.agent.toLowerCase().includes('mozilla') ||
                  parsedValue.agent.toLowerCase().includes('chrome') ||
                  parsedValue.agent.toLowerCase().includes('safari') ||
                  parsedValue.agent.toLowerCase().includes('firefox') ||
                  parsedValue.agent.toLowerCase().includes('edge')
                )) {
              networkInfo.userAgent = parsedValue.agent;
            } else if (parsedValue.headers && typeof parsedValue.headers['user-agent'] === 'string' && (
                  parsedValue.headers['user-agent'].toLowerCase().includes('mozilla') ||
                  parsedValue.headers['user-agent'].toLowerCase().includes('chrome') ||
                  parsedValue.headers['user-agent'].toLowerCase().includes('safari') ||
                  parsedValue.headers['user-agent'].toLowerCase().includes('firefox') ||
                  parsedValue.headers['user-agent'].toLowerCase().includes('edge')
                )) {
              networkInfo.userAgent = parsedValue.headers['user-agent'];
            }
            // Otherwise, do not assign userAgent
          } catch (e) {
            // If JSON parsing fails, do not assign userAgent
          }
        }
        
        // Look for remote connection information
        if (value.toLowerCase().includes('remote') || 
            value.toLowerCase().includes('ssh') || 
            value.toLowerCase().includes('connection') ||
            value.toLowerCase().includes('network')) {
          networkInfo.remoteConnections.push({
            key: key,
            value: value
          });
        }
      }
    });
    
    // If no user agent found, provide a default based on common patterns
    if (!networkInfo.userAgent) {
      // Try to detect from other data
      const hasCursorData = logData.some(item => 
        item.key && item.key.toLowerCase().includes('cursor')
      );
      
      if (hasCursorData) {
        networkInfo.userAgent = 'Cursor IDE (Electron-based)';
      } else {
        networkInfo.userAgent = 'Unknown Browser/IDE';
      }
    }
    
    // If no IP found, try to extract from file paths or other data
    if (!networkInfo.ipAddress) {
      const localhostPatterns = logData.some(item => 
        item.value && typeof item.value === 'string' && 
        (item.value.includes('localhost') || item.value.includes('127.0.0.1'))
      );
      
      if (localhostPatterns) {
        networkInfo.ipAddress = '127.0.0.1 (localhost)';
      } else {
        networkInfo.ipAddress = 'Local Development';
      }
    }
    
  } catch (error) {
    logger.error('Error extracting network info:', error);
  }
  
  return networkInfo;
}

// Function to extract performance metrics
function extractPerformanceMetrics(logData) {
  const performanceMetrics = {
    memoryUsage: {},
    cpuUsage: {},
    responseTimes: [],
    errorRates: [],
    startupTime: null,
    sessionDuration: null,
    fileOperations: [],
    searchPerformance: [],
    extensionPerformance: [],
    // Additional metrics based on available data
    workspaceActivity: {
      totalFiles: 0,
      uniqueFileTypes: 0,
      activeSessions: 0,
      editorStates: 0
    },
    searchActivity: {
      searchQueries: 0,
      findHistory: 0
    },
    terminalActivity: {
      terminalSessions: 0,
      commands: 0
    },
    composerActivity: {
      totalComposers: 0,
      activeComposers: 0
    }
  };
  
  try {
    
    logData.forEach(item => {
      const { key, value } = item;
      
      // Look for actual performance data in cursor logs
      // Most cursor logs contain UI state, not performance metrics
      
      // Look for timing information in AI service data
      if (key === 'aiService.prompts' || key === 'aiService.generations') {
        try {
          const aiData = JSON.parse(value);
          if (Array.isArray(aiData)) {
            aiData.forEach(entry => {
              if (entry.unixMs) {
                performanceMetrics.responseTimes.push({
                  key: key,
                  time: Date.now() - entry.unixMs, // Calculate response time
                  timestamp: new Date(entry.unixMs)
                });
              }
            });
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Look for error information in AI service data
      if (key === 'aiService.prompts' || key === 'aiService.generations') {
        try {
          const aiData = JSON.parse(value);
          if (Array.isArray(aiData)) {
            aiData.forEach(entry => {
              if (entry.textDescription && entry.textDescription.includes('error')) {
                performanceMetrics.errorRates.push({
                  key: key,
                  value: entry.textDescription,
                  timestamp: new Date(entry.unixMs || Date.now())
                });
              }
            });
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Look for file operations in editor history
      if (key === 'history.entries') {
        try {
          const historyData = JSON.parse(value);
          if (Array.isArray(historyData)) {
            historyData.forEach(entry => {
              if (entry.editor && entry.editor.resource) {
                performanceMetrics.fileOperations.push({
                  key: 'file_opened',
                  value: entry.editor.resource,
                  timestamp: new Date(entry.timestamp || entry.unixMs || Date.now())
                });
              }
            });
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Look for workspace performance data
      if (key.includes('performance') || key.includes('memory') || key.includes('cpu')) {
        try {
          const perfData = JSON.parse(value);
          performanceMetrics[key] = perfData;
        } catch (e) {
          performanceMetrics[key] = value;
        }
      }
      
      // Extract workspace activity metrics
      if (key === 'history.entries') {
        try {
          const historyData = JSON.parse(value);
          if (Array.isArray(historyData)) {
            performanceMetrics.workspaceActivity.totalFiles = historyData.length;
            const fileTypes = new Set();
            historyData.forEach(entry => {
              if (entry.editor && entry.editor.resource) {
                const fileType = entry.editor.resource.split('.').pop() || 'unknown';
                fileTypes.add(fileType);
              }
            });
            performanceMetrics.workspaceActivity.uniqueFileTypes = fileTypes.size;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract search activity metrics
      if (key === 'workbench.find.history') {
        try {
          const searchHistory = JSON.parse(value);
          if (Array.isArray(searchHistory)) {
            performanceMetrics.searchActivity.findHistory = searchHistory.length;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      if (key === 'workbench.search.history') {
        try {
          const searchData = JSON.parse(value);
          if (searchData.search && Array.isArray(searchData.search)) {
            performanceMetrics.searchActivity.searchQueries = searchData.search.length;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract terminal activity metrics
      if (key === 'terminal.integrated.layoutInfo') {
        try {
          const terminalData = JSON.parse(value);
          if (terminalData.tabs && Array.isArray(terminalData.tabs)) {
            performanceMetrics.terminalActivity.terminalSessions = terminalData.tabs.length;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract composer activity metrics
      if (key === 'composer.composerData') {
        try {
          const composerData = JSON.parse(value);
          if (composerData.allComposers && Array.isArray(composerData.allComposers)) {
            performanceMetrics.composerActivity.totalComposers = composerData.allComposers.length;
            performanceMetrics.composerActivity.activeComposers = composerData.selectedComposerIds ? composerData.selectedComposerIds.length : 0;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract editor state metrics
      if (key === 'memento/workbench.editors.files.textFileEditor') {
        try {
          const editorData = JSON.parse(value);
          if (editorData.textEditorViewState && Array.isArray(editorData.textEditorViewState)) {
            performanceMetrics.workspaceActivity.editorStates = editorData.textEditorViewState.length;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Extract session activity
      if (key === 'workbench.panel.aichat.numberOfVisibleViews') {
        const viewCount = parseInt(value);
        if (!isNaN(viewCount)) {
          performanceMetrics.workspaceActivity.activeSessions += viewCount;
        }
      }
      
      if (key === 'terminal.numberOfVisibleViews') {
        const terminalCount = parseInt(value);
        if (!isNaN(terminalCount)) {
          performanceMetrics.terminalActivity.terminalSessions += terminalCount;
        }
      }
    });
    
  } catch (error) {
    logger.error('Error extracting performance metrics:', error);
  }
  
  return performanceMetrics;
}

// Extract AI service usage metrics
function extractAIServiceMetrics(logs) {
    const aiMetrics = {
        totalPrompts: 0,
        totalGenerations: 0,
        promptTypes: {},
        generationTypes: {},
        recentPrompts: [],
        recentGenerations: []
    };

    logs.forEach(log => {
        if (log.key === 'aiService.prompts') {
            try {
                const prompts = JSON.parse(log.value);
                aiMetrics.totalPrompts = prompts.length;
                aiMetrics.recentPrompts = prompts.map((p, index) => {
                    // Add fallback timestamp if none exists
                    const fallbackTimestamp = Date.now() - (index * 1000); // Each prompt gets a slightly earlier timestamp
                    const timestamp = p.timestamp || p.unixMs || p.createdAt || p.date || p.time || fallbackTimestamp;
                    
                    return {
                        text: p.text ? (p.text.substring(0, 100) + (p.text.length > 100 ? '...' : '')) : 'No text',
                        commandType: p.commandType || 'unknown',
                        timestamp: timestamp,
                        unixMs: p.unixMs || timestamp,
                        createdAt: p.createdAt || timestamp,
                        date: p.date || timestamp,
                        time: p.time || timestamp
                    };
                });
                
                prompts.forEach(prompt => {
                    const type = prompt.commandType || 'unknown';
                    aiMetrics.promptTypes[type] = (aiMetrics.promptTypes[type] || 0) + 1;
                });
            } catch (e) {
                console.error('Error parsing AI prompts:', e);
            }
        }

        if (log.key === 'aiService.generations') {
            try {
                const generations = JSON.parse(log.value);
                aiMetrics.totalGenerations = generations.length;
                aiMetrics.recentGenerations = generations.map(g => ({
                    description: g.textDescription ? (g.textDescription.substring(0, 100) + (g.textDescription.length > 100 ? '...' : '')) : 'No description',
                    type: g.type || 'unknown',
                    timestamp: g.unixMs ? new Date(g.unixMs).toLocaleString() : 'Unknown'
                }));
                
                generations.forEach(gen => {
                    const type = gen.type || 'unknown';
                    aiMetrics.generationTypes[type] = (aiMetrics.generationTypes[type] || 0) + 1;
                });
            } catch (e) {
                console.error('Error parsing AI generations:', e);
            }
        }
    });

    return aiMetrics;
}

// Extract editor activity metrics
function extractEditorActivity(logs) {
    const editorMetrics = {
        openedFiles: [],
        fileTypes: {},
        cursorPositions: [],
        editorStates: [],
        recentEditors: []
    };

    logs.forEach(log => {
        if (log.key === 'history.entries') {
            try {
                const entries = JSON.parse(log.value);
                editorMetrics.openedFiles = entries.map((entry, index) => {
                    const path = entry.editor?.resource || '';
                    const fileName = path.split('/').pop() || path;
                    // Use logMtime as fallback
                    const fallbackTimestamp = entry.logMtime || Date.now();
                    return {
                        path: path,
                        fileName: fileName,
                        fileType: fileName.split('.').pop() || 'unknown',
                        timestamp: entry.timestamp || entry.unixMs || entry.createdAt || entry.date || entry.time || fallbackTimestamp,
                        lastModified: entry.lastModified || entry.timestamp || entry.unixMs || entry.createdAt || entry.date || entry.time || fallbackTimestamp
                    };
                });

                // Count file types
                editorMetrics.openedFiles.forEach(file => {
                    editorMetrics.fileTypes[file.fileType] = (editorMetrics.fileTypes[file.fileType] || 0) + 1;
                });
            } catch (e) {
                console.error('Error parsing editor history:', e);
            }
        }

        if (log.key === 'memento/workbench.editors.files.textFileEditor') {
            try {
                const editorState = JSON.parse(log.value);
                if (editorState.textEditorViewState) {
                    editorState.textEditorViewState.forEach(([filePath, state]) => {
                        if (state && state['0'] && state['0'].cursorState) {
                            const cursorState = state['0'].cursorState[0];
                            if (cursorState && cursorState.position) {
                                editorMetrics.cursorPositions.push({
                                    file: filePath,
                                    line: cursorState.position.lineNumber,
                                    column: cursorState.position.column
                                });
                            }
                        }
                    });
                }
            } catch (e) {
                console.error('Error parsing editor state:', e);
            }
        }
    });

    return editorMetrics;
}

// Extract workspace and UI settings
function extractWorkspaceSettings(logs) {
    const workspaceMetrics = {
        workspaceOpenedDate: null,
        uiSettings: {},
        panelStates: {},
        sidebarStates: {},
        zenMode: false,
        activityBarHidden: false,
        statusBarHidden: false
    };

    logs.forEach(log => {
        if (log.key === 'cursorAuth/workspaceOpenedDate') {
            workspaceMetrics.workspaceOpenedDate = log.value;
        }

        if (log.key === 'workbench.zenMode.active') {
            workspaceMetrics.zenMode = log.value === 'true';
        }

        if (log.key === 'workbench.activityBar.hidden') {
            workspaceMetrics.activityBarHidden = log.value === 'true';
        }

        if (log.key === 'workbench.statusBar.hidden') {
            workspaceMetrics.statusBarHidden = log.value === 'true';
        }

        if (log.key === 'workbench.sideBar.position') {
            workspaceMetrics.uiSettings.sidebarPosition = log.value;
        }

        if (log.key === 'workbench.panel.position') {
            workspaceMetrics.uiSettings.panelPosition = log.value;
        }

        if (log.key === 'workbench.explorer.views.state') {
            try {
                workspaceMetrics.sidebarStates.explorer = JSON.parse(log.value);
            } catch (e) {
                console.error('Error parsing explorer state:', e);
            }
        }

        if (log.key === 'workbench.panel.viewContainersWorkspaceState') {
            try {
                workspaceMetrics.panelStates = JSON.parse(log.value);
            } catch (e) {
                console.error('Error parsing panel state:', e);
            }
        }
    });

    return workspaceMetrics;
}

// Extract development environment information
function extractDevEnvironment(logs) {
    const devMetrics = {
        debugConfig: null,
        terminalInfo: {},
        gitInfo: {},
        extensions: {},
        languageDetection: []
    };

    logs.forEach(log => {
        if (log.key === 'debug.selectedroot') {
            devMetrics.debugConfig = log.value;
        }

        if (log.key === 'terminal.numberOfVisibleViews') {
            devMetrics.terminalInfo.visibleViews = parseInt(log.value) || 0;
        }

        if (log.key === 'vscode.git') {
            try {
                devMetrics.gitInfo = JSON.parse(log.value);
            } catch (e) {
                console.error('Error parsing git info:', e);
            }
        }

        if (log.key === 'workbench.editor.languageDetectionOpenedLanguages.workspace') {
            try {
                devMetrics.languageDetection = JSON.parse(log.value);
            } catch (e) {
                console.error('Error parsing language detection:', e);
            }
        }

        // Extract extension information
        if (log.key.includes('extension') || log.key.includes('vscode.')) {
            const extensionName = log.key.split('.').pop();
            if (extensionName && extensionName !== 'state') {
                devMetrics.extensions[extensionName] = log.value;
            }
        }
    });

    return devMetrics;
}

// Extract composer and chat session data
function extractComposerData(logs) {
    const composerMetrics = {
        composers: [],
        activeComposer: null,
        chatSessions: [],
        composerStates: {}
    };

    logs.forEach(log => {
        if (log.key === 'composer.composerData') {
            try {
                const composerData = JSON.parse(log.value);
                composerMetrics.composers = composerData.allComposers || [];
                composerMetrics.activeComposer = composerData.selectedComposerIds?.[0] || null;
            } catch (e) {
                console.error('Error parsing composer data:', e);
            }
        }

        if (log.key === 'interactive.sessions') {
            try {
                composerMetrics.chatSessions = JSON.parse(log.value);
            } catch (e) {
                console.error('Error parsing interactive sessions:', e);
            }
        }

        if (log.key === 'workbench.panel.composerChatViewPane') {
            try {
                composerMetrics.composerStates = JSON.parse(log.value);
            } catch (e) {
                console.error('Error parsing composer states:', e);
            }
        }
    });

    return composerMetrics;
}

// Function to load logs from cursorlogs directory
function loadLogs() {
    const logsDir = path.join(process.cwd(), 'cursorlogs');
    const logs = [];
    
    if (!fs.existsSync(logsDir)) {
        logger.warn('Logs directory does not exist');
        return logs;
    }
    
    try {
        const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.json'));
        
        for (const file of files) {
            const filePath = path.join(logsDir, file);
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const logData = JSON.parse(fileContent);
            const mtime = fs.statSync(filePath).mtime.getTime();
            
            if (Array.isArray(logData)) {
                logData.forEach(entry => {
                  if (entry && typeof entry === 'object') entry.logMtime = mtime;
                  logs.push(entry);
                });
            } else if (logData && typeof logData === 'object') {
                // Handle different log formats
                if (logData.ItemTable && Array.isArray(logData.ItemTable)) {
                    logData.ItemTable.forEach(entry => {
                      if (entry && typeof entry === 'object') entry.logMtime = mtime;
                      logs.push(entry);
                    });
                } else {
                    logData.logMtime = mtime;
                    logs.push(logData);
                }
            }
        }
        
        logger.info(`Loaded ${logs.length} log entries from ${files.length} files`);
    } catch (error) {
        logger.error('Error loading logs:', error);
    }
    
    return logs;
}

// Function to filter logs by date range
function filterLogsByDateRange(logs, startDate, endDate) {
    if (!startDate || !endDate) {
        return logs;
    }
    
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    
    return logs.filter(log => {
        // Try to extract timestamp from various fields
        let timestamp = null;
        
        // Check for timestamp fields in the log data
        if (log.timestamp) {
            timestamp = new Date(log.timestamp).getTime();
        } else if (log.createdAt) {
            timestamp = new Date(log.createdAt).getTime();
        } else if (log.date) {
            timestamp = new Date(log.date).getTime();
        } else if (log.time) {
            timestamp = new Date(log.time).getTime();
        } else if (log.unixMs) {
            timestamp = log.unixMs;
        }
        
        // If no timestamp found in log data, use file modification time
        if (!timestamp && log.logMtime) {
            timestamp = log.logMtime;
        }
        
        // If still no timestamp, include the log (don't filter it out)
        if (!timestamp) {
            return true;
        }
        
        return timestamp >= start && timestamp <= end;
    });
}

// Function to extract process logs (placeholder for now)
function extractProcessLogs(logs) {
    return {
        totalProcesses: 0,
        processList: [],
        memoryUsage: [],
        cpuUsage: []
    };
}

// Enhanced function to get all metrics with new categories
function getAllMetrics(startDate, endDate) {
    const logs = loadLogs();
    const filteredLogs = filterLogsByDateRange(logs, startDate, endDate);

    // Extract all metrics
    const allMetrics = {
        systemInfo: extractSystemInfo(filteredLogs),
        networkInfo: extractNetworkInfo(filteredLogs),
        performanceMetrics: extractPerformanceMetrics(filteredLogs),
        processLogs: extractProcessLogs(filteredLogs),
        aiServiceMetrics: extractAIServiceMetrics(filteredLogs),
        editorActivity: extractEditorActivity(filteredLogs),
        workspaceSettings: extractWorkspaceSettings(filteredLogs),
        devEnvironment: extractDevEnvironment(filteredLogs),
        composerData: extractComposerData(filteredLogs)
    };

    // Sensitive info scan (always include)
    const { results: sensitiveResults, keywordCounts: sensitiveKeywordCounts } = scanLogsForSensitiveInfo();

    // Gather prompts, generations, historyEntries from logs
    let prompts = [], generations = [], historyEntries = [];
    filteredLogs.forEach(entry => {
        if (entry.key === 'aiService.prompts') {
            try {
                const val = JSON.parse(entry.value);
                if (Array.isArray(val)) prompts = prompts.concat(val);
            } catch {}
        }
        if (entry.key === 'aiService.generations') {
            try {
                const val = JSON.parse(entry.value);
                if (Array.isArray(val)) generations = generations.concat(val);
            } catch {}
        }
        if (entry.key === 'history.entries') {
            try {
                const val = JSON.parse(entry.value);
                if (Array.isArray(val)) historyEntries = historyEntries.concat(val);
            } catch {}
        }
    });

    // Filter out empty or meaningless metrics
    const filteredMetrics = {};

    // Helper function to check if a metric has meaningful data
    const hasMeaningfulData = (data, type) => {
        if (!data) return false;
        
        switch (type) {
            case 'aiServiceMetrics':
                return data.totalPrompts > 0 || data.totalGenerations > 0 || 
                       (data.recentPrompts && data.recentPrompts.length > 0) ||
                       (data.recentGenerations && data.recentGenerations.length > 0);
            
            case 'editorActivity':
                return (data.openedFiles && data.openedFiles.length > 0) ||
                       (data.cursorPositions && data.cursorPositions.length > 0) ||
                       (data.editorStates && data.editorStates.length > 0);
            
            case 'performanceMetrics':
                return (data.responseTimes && data.responseTimes.length > 0) ||
                       (data.errorRates && data.errorRates.length > 0) ||
                       (data.fileOperations && data.fileOperations.length > 0) ||
                       (data.workspaceActivity && Object.keys(data.workspaceActivity).length > 0 && 
                        (data.workspaceActivity.totalFiles > 0 || data.workspaceActivity.uniqueFileTypes > 0 || data.workspaceActivity.editorStates > 0)) ||
                       (data.searchActivity && Object.keys(data.searchActivity).length > 0 && 
                        (data.searchActivity.searchQueries > 0 || data.searchActivity.findHistory > 0)) ||
                       (data.terminalActivity && Object.keys(data.terminalActivity).length > 0 && 
                        data.terminalActivity.terminalSessions > 0) ||
                       (data.composerActivity && Object.keys(data.composerActivity).length > 0 && 
                        (data.composerActivity.totalComposers > 0 || data.composerActivity.activeComposers > 0));
            
            case 'systemInfo':
                return (data.searchHistory && data.searchHistory.length > 0) ||
                       (data.editorHistory && data.editorHistory.length > 0) ||
                       (data.languageUsage && data.languageUsage.length > 0) ||
                       (data.activityTimeline && data.activityTimeline.length > 0) ||
                       data.workspaceOpenedDate ||
                       data.userAgent ||
                       data.platform ||
                       data.os ||
                       data.cursorVersion ||
                       data.workspaceId ||
                       data.machineId ||
                       data.ipAddress;
            
            case 'networkInfo':
                return data.userAgent || data.ipAddress || 
                       (data.remoteConnections && data.remoteConnections.length > 0) ||
                       (data.connectionHistory && data.connectionHistory.length > 0);
            
            case 'devEnvironment':
                return data.debugConfig ||
                       (data.terminalInfo && Object.keys(data.terminalInfo).length > 0) ||
                       (data.gitInfo && Object.keys(data.gitInfo).length > 0) ||
                       (data.extensions && Object.keys(data.extensions).length > 0) ||
                       (data.languageDetection && data.languageDetection.length > 0);
            
            case 'composerData':
                return (data.composers && data.composers.length > 0) ||
                       data.activeComposer ||
                       (data.chatSessions && data.chatSessions.length > 0) ||
                       (data.composerStates && Object.keys(data.composerStates).length > 0);
            
            case 'workspaceSettings':
                return data.workspaceOpenedDate ||
                       (data.uiSettings && Object.keys(data.uiSettings).length > 0) ||
                       (data.panelStates && Object.keys(data.panelStates).length > 0) ||
                       (data.sidebarStates && Object.keys(data.sidebarStates).length > 0) ||
                       data.zenMode !== null ||
                       data.activityBarHidden !== null ||
                       data.statusBarHidden !== null;
            
            case 'processLogs':
                return data.totalProcesses > 0 ||
                       (data.processList && data.processList.length > 0) ||
                       (data.memoryUsage && data.memoryUsage.length > 0) ||
                       (data.cpuUsage && data.cpuUsage.length > 0);
            
            default:
                return false;
        }
    };

    // Only include metrics that have meaningful data
    Object.keys(allMetrics).forEach(key => {
        if (hasMeaningfulData(allMetrics[key], key)) {
            filteredMetrics[key] = allMetrics[key];
        }
    });

    // Always include sensitiveResults and sensitiveKeywordCounts
    filteredMetrics.sensitiveResults = sensitiveResults;
    filteredMetrics.sensitiveKeywordCounts = sensitiveKeywordCounts;
    // Always include prompts, generations, historyEntries (even if empty)
    filteredMetrics.prompts = prompts;
    filteredMetrics.generations = generations;
    filteredMetrics.historyEntries = historyEntries;

    return filteredMetrics;
}

// --- Sensitive Info Scan ---
const SENSITIVE_KEYWORDS = [
  'username', 'user', 'password', 'pass', 'database', 'db', 'token', 'jwt', 'secret', 'key', 'credential', 'auth', 'security', 'access', 'apikey', 'api_key', 'refresh', 'session', 'cookie', 'bearer'
];

function scanLogsForSensitiveInfo() {
  const logs = loadLogs();
  const results = [];
  const keywordCounts = {};
  SENSITIVE_KEYWORDS.forEach(k => keywordCounts[k] = 0);

  logs.forEach((entry) => {
    const entryStr = JSON.stringify(entry).toLowerCase();
    SENSITIVE_KEYWORDS.forEach(keyword => {
      if (entryStr.includes(keyword)) {
        keywordCounts[keyword]++;
        // Find context (show a snippet around the keyword)
        const idx = entryStr.indexOf(keyword);
        const context = entryStr.substring(Math.max(0, idx - 30), idx + keyword.length + 30);
        results.push({
          keyword,
          context,
          entry: entry.key || '',
          file: entry.logFile || '',
        });
      }
    });
  });

  // Log the keywordCounts to a file for debugging
  try {
    fs.writeFileSync('debug_sensitive_counts.json', JSON.stringify(keywordCounts, null, 2));
  } catch (e) {
    // Ignore file write errors
  }

  return { results, keywordCounts };
}

// Export the enhanced function
module.exports = {
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
  scanLogsForSensitiveInfo
}; 