// public/js/dashboard.js
// Dashboard client-side logic for Usage Metrics Dashboard
// Handles fetching data, rendering charts, tables, and pagination

document.addEventListener('DOMContentLoaded', function() {
  // Generate Logs Functionality
  const generateLogsBtn = document.getElementById('generateLogsBtn');
  const refreshPageBtn = document.getElementById('refreshPageBtn');
  const generateLogsStatus = document.getElementById('generateLogsStatus');
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  const userSelect = document.getElementById('userSelect');
  const reloadPageBtn = document.getElementById('reloadPageBtn');
  
  if (generateLogsBtn) {
    generateLogsBtn.addEventListener('click', async function() {
      const startDate = startDateInput.value;
      const endDate = endDateInput.value;
      const user = userSelect ? userSelect.value : '';
      
      if (!startDate || !endDate) {
        generateLogsStatus.innerHTML = '<div class="error-message">Please select both start and end dates.</div>';
        return;
      }
      
      // Show loading state
      generateLogsBtn.disabled = true;
      generateLogsBtn.querySelector('.btn-text').style.display = 'none';
      generateLogsBtn.querySelector('.btn-loading').style.display = 'inline';
      generateLogsStatus.innerHTML = '<div class="info-message">Generating logs...</div>';
      
      try {
        const response = await fetch('/usage-metrics/generate-logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ startDate, endDate, user })
        });
        
        const result = await response.json();
        
        if (response.ok) {
          generateLogsStatus.innerHTML = `<div class="success-message">${result.message}</div>`;
          refreshPageBtn.style.display = 'inline-block';
        } else {
          generateLogsStatus.innerHTML = `<div class="error-message">Error: ${result.message || result.error}</div>`;
        }
      } catch (error) {
        generateLogsStatus.innerHTML = `<div class="error-message">Network error: ${error.message}</div>`;
      } finally {
        // Reset button state
        generateLogsBtn.disabled = false;
        generateLogsBtn.querySelector('.btn-text').style.display = 'inline';
        generateLogsBtn.querySelector('.btn-loading').style.display = 'none';
      }
    });
  }
  
  if (refreshPageBtn) {
    refreshPageBtn.addEventListener('click', function() {
      const startDate = startDateInput.value;
      const endDate = endDateInput.value;
      const url = new URL(window.location);
      if (startDate) url.searchParams.set('startDate', startDate);
      if (endDate) url.searchParams.set('endDate', endDate);
      window.location.href = url.toString();
    });
  }
  
  if (reloadPageBtn) {
    reloadPageBtn.addEventListener('click', function() {
      const startDate = startDateInput.value;
      const endDate = endDateInput.value;
      const user = userSelect ? userSelect.value : '';
      const url = new URL(window.location.origin + window.location.pathname);
      if (startDate) url.searchParams.set('startDate', startDate);
      if (endDate) url.searchParams.set('endDate', endDate);
      if (user) url.searchParams.set('user', user);
      window.location.href = url.toString();
    });
  }
  
  // Track if DataTables have been initialized to prevent reinitialization
  const initializedTables = new Set();
  let dashboardPopulated = false;
  
  // Function to check if DataTables is available
  function isDataTablesAvailable() {
    return typeof $ !== 'undefined' && $.fn.DataTable;
  }

  // Function to safely initialize DataTables
  function initializeDataTable(selector, options) {
    if (!isDataTablesAvailable()) {
      return null;
    }
    
    // Check if table exists
    const table = $(selector);
    if (table.length === 0) {
      return null;
    }
    
    // Check if table has content
    const tbody = table.find('tbody');
    if (tbody.length === 0 || tbody.find('tr').length === 0) {
      return null;
    }
    
    // Check if already initialized
    if (initializedTables.has(selector)) {
      return null;
    }
    
    try {
      // Always destroy existing DataTable first
      if ($.fn.DataTable.isDataTable(selector)) {
        $(selector).DataTable().destroy();
      }
      
      // Note: "View More" buttons are now added after DataTable initialization
      
      // Initialize immediately without setTimeout
      try {
        const dataTable = $(selector).DataTable(options);
        initializedTables.add(selector);
        return dataTable;
      } catch (error) {
        return null;
      }
      
    } catch (error) {
      return null;
    }
  }

  // Function to categorize prompts
  function categorizePrompt(promptText) {
    if (!promptText) return 'Other';
    const text = promptText.toLowerCase();
    
    if (/code|function|class|method|variable|refactor|bug|fix|error|exception/.test(text)) return 'Code';
    if (/test|unit test|integration test|coverage/.test(text)) return 'Testing';
    if (/doc|documentation|comment|explain|describe/.test(text)) return 'Documentation';
    if (/install|setup|config|configuration|env|environment|dependency|package/.test(text)) return 'Setup';
    if (/deploy|build|release|pipeline|ci|cd/.test(text)) return 'DevOps';
    if (/performance|optimi[sz]e|speed|slow|fast/.test(text)) return 'Performance';
    if (/ui|ux|interface|design|layout|style|css|html/.test(text)) return 'UI/UX';
    if (/database|sql|query|schema|migration/.test(text)) return 'Database';
    if (/api|endpoint|request|response|http|rest|graphql/.test(text)) return 'API';
    if (/ai|ml|machine learning|model|data science/.test(text)) return 'AI/ML';
    if (/project|task|ticket|issue|story|epic/.test(text)) return 'Project Mgmt';
    
    return 'Other';
  }

  // Function to populate prompts table
  function populatePromptsTable(prompts) {
    const table = document.querySelector('#promptsTable');
    
    if (!table) {
      return;
    }
    
    // Create section header with "View All" button if needed
    const sectionCard = table.closest('.section-card');
    if (sectionCard) {
      const existingHeader = sectionCard.querySelector('.section-header');
      if (existingHeader) {
        existingHeader.remove();
      }
      
      // Always create the header, add "View All" button if there are any items
      const headerDiv = document.createElement('div');
      headerDiv.className = 'section-header';
      headerDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1em;';
      
      if (prompts && prompts.length > 0) {
        headerDiv.innerHTML = `
          <h2>Recent Prompts</h2>
          <a href="/usage-metrics/prompts" class="view-more-btn">View All</a>
        `;
      } else {
        headerDiv.innerHTML = `
          <h2>Recent Prompts</h2>
        `;
      }
      sectionCard.insertBefore(headerDiv, sectionCard.firstChild);
    }
    
    // Clear the entire table and rebuild structure
    table.innerHTML = `
      <thead>
        <tr>
          <th>#</th>
          <th>Prompt</th>
          <th>Category</th>
          <th>Type</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    
    const tbody = table.querySelector('tbody');
    
    if (!prompts || prompts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No prompts found</td></tr>';
      return;
    }
    
    // Use all prompts since API already provides the last 10 (most recent)
    const recentPrompts = prompts;
    
    // Add recent prompts to table
    recentPrompts.forEach((prompt, index) => {
      const row = document.createElement('tr');
      const category = categorizePrompt(prompt.text || prompt);
      const promptText = prompt.text || prompt || 'No text';
      const commandType = prompt.commandType || 'Unknown';
      
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${promptText}</td>
        <td>${category}</td>
        <td>${commandType}</td>
      `;
      tbody.appendChild(row);
    });
    
    // Initialize DataTable for prompts (without pagination since we're showing limited data)
    initializeDataTable('#promptsTable', {
      paging: false,
      searching: true,
      ordering: true,
      responsive: true,
      language: {
        search: "Search prompts:",
        info: "Showing _TOTAL_ recent prompts"
      }
    });
  }

  // Function to populate prompt acceptance report table
  function populatePromptAcceptanceTable(report) {
    const table = document.querySelector('#promptAcceptanceTable');
    if (!table) return;
    // Attach event listeners for 'View' buttons (re-attach every time table is rendered)
    setTimeout(() => {
      const viewBtns = table.querySelectorAll('.view-response-btn');
      viewBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const responseRaw = btn.getAttribute('data-response');
          let responseObj = {};
          try {
            responseObj = JSON.parse(responseRaw);
          } catch (e) {
            responseObj = responseRaw;
          }
          const modal = document.getElementById('responseModal');
          const modalContent = document.getElementById('modalResponseContent');
          if (modal && modalContent) {
            // Show all relevant fields in a readable format
            if (typeof responseObj === 'object' && responseObj !== null) {
              let html = '';
              if (responseObj.textDescription) {
                html += `<div><b>AI Suggestion:</b><pre style="white-space:pre-wrap;">${responseObj.textDescription}</pre></div>`;
              }
              if (responseObj.description && responseObj.description !== responseObj.textDescription) {
                html += `<div><b>Description:</b><pre style="white-space:pre-wrap;">${responseObj.description}</pre></div>`;
              }
              if (responseObj.code) {
                html += `<div><b>Code:</b><pre style="background:#f0f0f0;">${responseObj.code}</pre></div>`;
              }
              // Show all other fields
              const skip = ['textDescription','description','code'];
              Object.keys(responseObj).forEach(key => {
                if (!skip.includes(key)) {
                  html += `<div><b>${key}:</b> <pre style="white-space:pre-wrap;">${JSON.stringify(responseObj[key], null, 2)}</pre></div>`;
                }
              });
              if (!html) html = '<i>No additional response data.</i>';
              modalContent.innerHTML = html;
            } else {
              modalContent.textContent = responseObj;
            }
            modal.style.display = 'flex';
          }
        });
      });
    }, 0);
    // Close modal logic
    const closeModalBtn = document.getElementById('closeModalBtn');
    const modal = document.getElementById('responseModal');
    if (closeModalBtn && modal) {
      closeModalBtn.onclick = function() { modal.style.display = 'none'; };
    }
    if (modal) {
      modal.addEventListener('click', function(event) {
        if (event.target === modal) {
          modal.style.display = 'none';
        }
      });
    }
  }

  // Function to populate generations table
  function populateGenerationsTable(generations) {
    const table = document.querySelector('#generationsTable');
    
    if (!table) {
      return;
    }
    
    // Create section header with "View All" button if needed
    const sectionCard = table.closest('.section-card');
    if (sectionCard) {
      const existingHeader = sectionCard.querySelector('.section-header');
      if (existingHeader) {
        existingHeader.remove();
      }
      
      // Always create the header, add "View All" button if there are any items
      const headerDiv = document.createElement('div');
      headerDiv.className = 'section-header';
      headerDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1em;';
      
      if (generations && generations.length > 0) {
        headerDiv.innerHTML = `
          <h2>Recent Generations</h2>
          <a href="/usage-metrics/generations" class="view-more-btn">View All</a>
        `;
      } else {
        headerDiv.innerHTML = `
          <h2>Recent Generations</h2>
        `;
      }
      sectionCard.insertBefore(headerDiv, sectionCard.firstChild);
    }
    
    // Clear the entire table and rebuild structure
    table.innerHTML = `
      <thead>
        <tr>
          <th>#</th>
          <th>Description</th>
          <th>Type</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    
    const tbody = table.querySelector('tbody');
    
    if (!generations || generations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No generations found</td></tr>';
      return;
    }
    
    // Use all generations since API already provides the last 10 (most recent)
    const recentGenerations = generations;
    
    // Add recent generations to table
    recentGenerations.forEach((generation, index) => {
      const row = document.createElement('tr');
      const timestamp = generation.timestamp || (generation.unixMs ? new Date(generation.unixMs).toLocaleString() : 'Unknown');
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${generation.description || generation.textDescription || 'No description'}</td>
        <td>${generation.type || 'Unknown'}</td>
        <td>${timestamp}</td>
      `;
      tbody.appendChild(row);
    });
    
    // Initialize DataTable for generations (without pagination since we're showing limited data)
    initializeDataTable('#generationsTable', {
      paging: false,
      searching: true,
      ordering: true,
      responsive: true,
      language: {
        search: "Search generations:",
        info: "Showing _TOTAL_ recent generations"
      }
    });
  }

  // Function to populate files table
  function populateFilesTable(files) {
    const table = document.querySelector('#filesTable');
    
    if (!table) {
      return;
    }
    
    // Create section header with "View All" button if needed
    const sectionCard = table.closest('.section-card');
    if (sectionCard) {
      const existingHeader = sectionCard.querySelector('.section-header');
      if (existingHeader) {
        existingHeader.remove();
      }
      
      // Always create the header, add "View All" button if there are any items
      const headerDiv = document.createElement('div');
      headerDiv.className = 'section-header';
      headerDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1em;';
      
      if (files && files.length > 0) {
        headerDiv.innerHTML = `
          <h2>Recent Files Opened/Edited</h2>
          <a href="/usage-metrics/files" class="view-more-btn">View All</a>
        `;
      } else {
        headerDiv.innerHTML = `
          <h2>Recent Files Opened/Edited</h2>
        `;
      }
      sectionCard.insertBefore(headerDiv, sectionCard.firstChild);
    }
    
    // Clear the entire table and rebuild structure
    table.innerHTML = `
      <thead>
        <tr>
          <th>#</th>
          <th>File</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    
    const tbody = table.querySelector('tbody');
    
    if (!files || files.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" class="text-center">No files found</td></tr>';
      return;
    }
    
    // Use all files since API already provides the last 10 (most recent)
    const recentFiles = files;
    
    // Add recent files to table
    recentFiles.forEach((file, index) => {
      const row = document.createElement('tr');
      // Handle different file object structures
      let fileName = 'Unknown file';
      if (typeof file === 'string') {
        fileName = file;
      } else if (file && typeof file === 'object') {
        if (file.fileName) {
          fileName = file.fileName;
        } else if (file.path) {
          fileName = file.path.split('/').pop() || file.path;
        } else if (file.editor && file.editor.resource) {
          fileName = file.editor.resource;
        } else {
          fileName = JSON.stringify(file);
        }
      }
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${fileName}</td>
      `;
      tbody.appendChild(row);
    });
    
    // Initialize DataTable for files (without pagination since we're showing limited data)
    initializeDataTable('#filesTable', {
      paging: false,
      searching: true,
      ordering: true,
      responsive: true,
      language: {
        search: "Search files:",
        info: "Showing _TOTAL_ recent files"
      }
    });
  }

  // Function to populate search queries
  function populateSearchQueries(queries) {
    const container = document.getElementById('searchQueries');
    if (!container) {
      return;
    }
    
    container.innerHTML = '';
    
    if (!queries || queries.length === 0) {
      container.innerHTML = '<p class="text-muted">No search queries found</p>';
      return;
    }
    
    queries.slice(0, 100).forEach(query => {
      const span = document.createElement('span');
      span.className = 'search-tag';
      span.textContent = query;
      container.appendChild(span);
    });
  }

  // Function to populate common prompts
  function populateCommonPrompts(prompts) {
    const container = document.getElementById('commonPrompts');
    if (!container) {
      return;
    }
    
    container.innerHTML = '';
    
    if (!prompts || prompts.length === 0) {
      container.innerHTML = '<p class="text-muted">No prompts found</p>';
      return;
    }
    
    // Count prompt occurrences
    const promptCounts = {};
    prompts.forEach(p => {
      if (p.text) {
        promptCounts[p.text] = (promptCounts[p.text] || 0) + 1;
      }
    });
    
    // Sort by count and take top 5
    const sortedPrompts = Object.entries(promptCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    sortedPrompts.forEach(([text, count]) => {
      const span = document.createElement('span');
      span.className = 'common-prompt-tag';
      span.textContent = `${text} (${count})`;
      container.appendChild(span);
    });
  }

  // Function to create languages chart
  function createLanguagesChart(languages) {
    if (!languages || languages.length === 0) {
      return;
    }
    
    const langLabels = languages.map(l => l[0]); // First element is language name
    const langData = languages.map(l => l[1] || 0); // Second element is count
    
    if (langLabels.length > 0 && window.Chart && document.getElementById('languagesChart')) {
      // Destroy existing chart if it exists
      const existingChart = window.languagesChartInstance;
      if (existingChart) {
        existingChart.destroy();
      }
      
      window.languagesChartInstance = new Chart(document.getElementById('languagesChart').getContext('2d'), {
        type: 'pie',
        data: { 
          labels: langLabels, 
          datasets: [{ 
            label: 'Languages', 
            data: langData, 
            backgroundColor: ['#4e73df','#1cc88a','#36b9cc','#f6c23e','#e74a3b','#858796','#5a5c69'],
            borderWidth: 2,
            borderColor: '#fff'
          }] 
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                padding: 20,
                usePointStyle: true
              }
            }
          }
        }
      });
    }
  }

  // Function to create generation timeline chart
  function createGenerationTimeline(generations) {
    if (!generations || generations.length === 0) {
      return;
    }
    
    // Sort generations by timestamp
    const sortedGenerations = generations
      .filter(g => g.timestamp || g.createdAt)
      .sort((a, b) => {
        const timeA = new Date(a.timestamp || a.createdAt).getTime();
        const timeB = new Date(b.timestamp || b.createdAt).getTime();
        return timeA - timeB;
      });
    
    if (sortedGenerations.length > 0 && window.Chart && document.getElementById('generationTimeline')) {
      // Destroy existing chart if it exists
      const existingChart = window.generationTimelineInstance;
      if (existingChart) {
        existingChart.destroy();
      }
      
      const labels = sortedGenerations.map(g => {
        const date = new Date(g.timestamp || g.createdAt);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      });
      const data = sortedGenerations.map((g, i) => i + 1);
      
      window.generationTimelineInstance = new Chart(document.getElementById('generationTimeline').getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Generations',
            data: data,
            borderColor: '#4e73df',
            backgroundColor: 'rgba(78, 115, 223, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                stepSize: 1
              }
            }
          }
        }
      });
    }
  }

  // Function to populate system and network information
  function populateSystemNetworkInfo(systemNetworkInfo) {
    if (systemNetworkInfo) {
      // Populate system information
      const systemContainer = document.getElementById('systemInfo');
      if (systemContainer) {
        // Build system info HTML dynamically based on available data
        let systemInfoHTML = '';
        
        // Only show workspace ID if it's meaningful
        const workspaceId = systemNetworkInfo.workspaceId;
        if (workspaceId && workspaceId !== 'Local Workspace' && workspaceId !== '-') {
          systemInfoHTML += `
            <div class="info-item">
              <span class="info-label">Workspace ID:</span>
              <span class="info-value">${workspaceId}</span>
            </div>
          `;
        }
        
        // Only show workspace opened date if it's meaningful
        const workspaceOpened = systemNetworkInfo.workspaceOpenedDate;
        if (workspaceOpened && workspaceOpened !== 'Recent' && workspaceOpened !== '-') {
          systemInfoHTML += `
            <div class="info-item">
              <span class="info-label">Workspace Opened:</span>
              <span class="info-value">${workspaceOpened}</span>
            </div>
          `;
        }
        
        // Only show IP address if it's meaningful
        const ipAddress = systemNetworkInfo.ipAddress;
        if (ipAddress && ipAddress !== 'Local Development' && ipAddress !== '-') {
          systemInfoHTML += `
            <div class="info-item">
              <span class="info-label">IP Address:</span>
              <span class="info-value">${ipAddress}</span>
            </div>
          `;
        }
        
        // Only show total sessions if it's meaningful (greater than 0)
        const sessionCount = systemNetworkInfo.totalSessions || 0;
        if (sessionCount > 0) {
          systemInfoHTML += `
            <div class="info-item">
              <span class="info-label">Total Sessions:</span>
              <span class="info-value">${sessionCount}</span>
            </div>
          `;
        }
        
        systemContainer.innerHTML = systemInfoHTML;
      }
      
      // Populate network information
      const networkContainer = document.getElementById('networkInfo');
      if (networkContainer) {
        const userAgent = systemNetworkInfo.userAgent || 'Cursor IDE (Electron-based)';
        const remoteConnections = systemNetworkInfo.remoteConnectionsCount || 0;
        const gitIntegration = systemNetworkInfo.gitIntegration || 'Not detected';
        
        networkContainer.innerHTML = `
          <div class="info-item">
            <span class="info-label">User Agent:</span>
            <span class="info-value">${userAgent}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Remote Connections:</span>
            <span class="info-value">
              ${remoteConnections > 0 ? 
                `<a href="/usage-metrics/remote-connections" class="connection-link">${remoteConnections} connections</a>` : 
                `${remoteConnections} connections`
              }
            </span>
          </div>
          <div class="info-item">
            <span class="info-label">Git Integration:</span>
            <span class="info-value">${gitIntegration}</span>
          </div>
        `;
      }
    }
  }

  // Function to hide sections that don't have meaningful data
  function hideEmptySections(data) {
    // Hide sections based on available data
    const sectionsToHide = [];
    
    // Check AI Service Metrics
    if (!data.aiServiceMetrics || 
        (!data.aiServiceMetrics.recentPrompts || data.aiServiceMetrics.recentPrompts.length === 0) &&
        (!data.aiServiceMetrics.recentGenerations || data.aiServiceMetrics.recentGenerations.length === 0)) {
      sectionsToHide.push('Recent Prompts', 'Recent Generations', 'Most Common Prompts');
    }
    
    // Check Editor Activity
    if (!data.editorActivity || 
        (!data.editorActivity.openedFiles || data.editorActivity.openedFiles.length === 0)) {
      sectionsToHide.push('Recent Files Opened/Edited');
    }
    
    // Check System & Network Info
    if (!data.systemNetworkInfo || 
        ((!data.systemNetworkInfo.workspaceId || data.systemNetworkInfo.workspaceId === 'Local Workspace') &&
         (!data.systemNetworkInfo.workspaceOpenedDate || data.systemNetworkInfo.workspaceOpenedDate === 'Recent') &&
         (!data.systemNetworkInfo.ipAddress || data.systemNetworkInfo.ipAddress === 'Local Development') &&
         (!data.systemNetworkInfo.totalSessions || data.systemNetworkInfo.totalSessions === 0) &&
         (!data.systemNetworkInfo.userAgent || data.systemNetworkInfo.userAgent === 'Cursor IDE (Electron-based)') &&
         (!data.systemNetworkInfo.remoteConnectionsCount || data.systemNetworkInfo.remoteConnectionsCount === 0) &&
         (!data.systemNetworkInfo.gitIntegration || data.systemNetworkInfo.gitIntegration === 'Not detected'))) {
      sectionsToHide.push('System & Network Information');
    }
    
    // Check Performance Metrics - hide if no meaningful data
    if (!data.performanceMetrics || 
        ((!data.performanceMetrics.responseTimes || data.performanceMetrics.responseTimes.length === 0) &&
         (!data.performanceMetrics.errorRates || data.performanceMetrics.errorRates.length === 0) &&
         (!data.performanceMetrics.fileOperations || data.performanceMetrics.fileOperations.length === 0) &&
         (!data.performanceMetrics.workspaceActivity || 
          (Object.keys(data.performanceMetrics.workspaceActivity).length === 0 ||
           (data.performanceMetrics.workspaceActivity.totalFiles === 0 && 
            data.performanceMetrics.workspaceActivity.uniqueFileTypes === 0 && 
            data.performanceMetrics.workspaceActivity.editorStates === 0))) &&
         (!data.performanceMetrics.searchActivity || 
          (Object.keys(data.performanceMetrics.searchActivity).length === 0 ||
           (data.performanceMetrics.searchActivity.searchQueries === 0 && 
            data.performanceMetrics.searchActivity.findHistory === 0))) &&
         (!data.performanceMetrics.terminalActivity || 
          (Object.keys(data.performanceMetrics.terminalActivity).length === 0 ||
           data.performanceMetrics.terminalActivity.terminalSessions === 0)) &&
         (!data.performanceMetrics.composerActivity || 
          (Object.keys(data.performanceMetrics.composerActivity).length === 0 ||
           (data.performanceMetrics.composerActivity.totalComposers === 0 && 
            data.performanceMetrics.composerActivity.activeComposers === 0))))) {
      sectionsToHide.push('Performance Metrics');
    }
    
    // Hide the sections
    sectionsToHide.forEach(sectionTitle => {
      const sectionHeaders = document.querySelectorAll('h2');
      sectionHeaders.forEach(header => {
        if (header.textContent === sectionTitle) {
          const sectionCard = header.closest('.section-card');
          if (sectionCard) {
            sectionCard.style.display = 'none';
          }
        }
      });
    });
  }

  // Function to show a message when no data is available
  function showNoDataMessage() {
    const dashboardContainer = document.querySelector('.dashboard-container');
    if (dashboardContainer) {
      const noDataMessage = document.createElement('div');
      noDataMessage.className = 'section-card no-data-message';
      noDataMessage.innerHTML = `
        <h2>No Metrics Data Available</h2>
        <p>No meaningful metrics data was found for the selected time period. This could be because:</p>
        <ul>
          <li>No log files were found for the specified date range</li>
          <li>The log files don't contain the expected metrics data</li>
          <li>The data format has changed and needs to be updated</li>
        </ul>
        <p>Please try selecting a different date range or check if log files exist in the cursorlogs directory.</p>
      `;
      
      // Insert the message after the header
      const header = dashboardContainer.querySelector('.dashboard-header-row');
      if (header) {
        header.insertAdjacentElement('afterend', noDataMessage);
      }
    }
  }

  // Main function to populate dashboard
  async function populateDashboard() {
    // Prevent multiple calls
    if (dashboardPopulated) {
      return;
    }
    
    try {
      dashboardPopulated = true;
      
      // Reset initialization tracking for fresh start
      initializedTables.clear();
      
      // Get days parameter from URL
      const urlParams = new URLSearchParams(window.location.search);
      const days = urlParams.get('days') || 5;
      const startDate = urlParams.get('startDate');
      const endDate = urlParams.get('endDate');
      
      // Build API URL with appropriate parameters
      let apiUrl = `/api/metrics?days=${days}`;
      if (startDate && endDate) {
        apiUrl = `/api/metrics?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
        
        // Show loading message for date range processing
        const dashboardContainer = document.querySelector('.dashboard-container');
        if (dashboardContainer) {
          const loadingMessage = document.createElement('div');
          loadingMessage.className = 'section-card loading-message';
          loadingMessage.innerHTML = `
            <h2>Processing Logs</h2>
            <p>Processing logs for date range: ${startDate} to ${endDate}</p>
            <p>This may take a moment...</p>
          `;
          
          // Insert the loading message after the header
          const header = dashboardContainer.querySelector('.dashboard-header-row');
          if (header) {
            header.insertAdjacentElement('afterend', loadingMessage);
          }
        }
      }
      
      // Fetch data from the metrics endpoint
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Remove loading message if it exists
      const loadingMessage = document.querySelector('.loading-message');
      if (loadingMessage) {
        loadingMessage.remove();
      }
      
      // Check if there's any meaningful data at all
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
        showNoDataMessage();
        return;
      }
      
      // Hide empty sections first
      hideEmptySections(data);
      
      // Populate tables with DataTables - using the correct data structure
      if (data.aiServiceMetrics && data.aiServiceMetrics.recentPrompts && data.aiServiceMetrics.recentPrompts.length > 0) {
        populatePromptsTable(data.aiServiceMetrics.recentPrompts);
      }
      
      if (data.aiServiceMetrics && data.aiServiceMetrics.recentGenerations && data.aiServiceMetrics.recentGenerations.length > 0) {
        populateGenerationsTable(data.aiServiceMetrics.recentGenerations);
      }
      
      if (data.editorActivity && data.editorActivity.openedFiles && data.editorActivity.openedFiles.length > 0) {
        populateFilesTable(data.editorActivity.openedFiles);
      }
      
      if (data.aiServiceMetrics && data.aiServiceMetrics.recentPrompts && data.aiServiceMetrics.recentPrompts.length > 0) {
        populateCommonPrompts(data.aiServiceMetrics.recentPrompts);
      }
      
      // Create charts only if they have meaningful data
      if (data.devEnvironment && data.devEnvironment.languageDetection && data.devEnvironment.languageDetection.length > 0) {

      }
      
      if (data.aiServiceMetrics && data.aiServiceMetrics.recentGenerations && data.aiServiceMetrics.recentGenerations.length > 0) {
        createGenerationTimeline(data.aiServiceMetrics.recentGenerations);
      }
      
      // Populate system and network information if available and has meaningful data
      if (data.systemNetworkInfo && (
          (data.systemNetworkInfo.workspaceId && data.systemNetworkInfo.workspaceId !== 'Local Workspace') ||
          (data.systemNetworkInfo.workspaceOpenedDate && data.systemNetworkInfo.workspaceOpenedDate !== 'Recent') ||
          (data.systemNetworkInfo.ipAddress && data.systemNetworkInfo.ipAddress !== 'Local Development') ||
          (data.systemNetworkInfo.totalSessions && data.systemNetworkInfo.totalSessions > 0)
      )) {
        populateSystemNetworkInfo(data.systemNetworkInfo);
      }
      
      // Populate performance metrics if available and has meaningful data
      if (data.performanceMetrics && (
          (data.performanceMetrics.responseTimesCount && data.performanceMetrics.responseTimesCount > 0) ||
          (data.performanceMetrics.errorRatesCount && data.performanceMetrics.errorRatesCount > 0) ||
          (data.performanceMetrics.fileOperationsCount && data.performanceMetrics.fileOperationsCount > 0) ||
          (data.performanceMetrics.workspaceActivity && 
           (data.performanceMetrics.workspaceActivity.totalFiles > 0 || 
            data.performanceMetrics.workspaceActivity.uniqueFileTypes > 0 || 
            data.performanceMetrics.workspaceActivity.editorStates > 0)) ||
          (data.performanceMetrics.searchActivity && 
           (data.performanceMetrics.searchActivity.searchQueries > 0 || 
            data.performanceMetrics.searchActivity.findHistory > 0)) ||
          (data.performanceMetrics.terminalActivity && 
           data.performanceMetrics.terminalActivity.terminalSessions > 0) ||
          (data.performanceMetrics.composerActivity && 
           (data.performanceMetrics.composerActivity.totalComposers > 0 || 
            data.performanceMetrics.composerActivity.activeComposers > 0))
      )) {
        // Update individual metric elements instead of replacing entire container
        const responseTimesElement = document.getElementById('responseTimes');
        const errorRateElement = document.getElementById('errorRate');
        const fileOperationsElement = document.getElementById('fileOperations');
        const workspaceFilesElement = document.getElementById('workspaceFiles');
        const searchQueriesElement = document.getElementById('searchQueries');
        const terminalSessionsElement = document.getElementById('terminalSessions');
        const composerSessionsElement = document.getElementById('composerSessions');
        const editorStatesElement = document.getElementById('editorStates');
        
        if (responseTimesElement) {
          const responseTimesCount = data.performanceMetrics.responseTimesCount || 0;
          responseTimesElement.textContent = responseTimesCount > 0 ? 
            `${responseTimesCount} AI interactions tracked` : 'No AI interactions tracked';
        }
        
        if (errorRateElement) {
          const errorRatesCount = data.performanceMetrics.errorRatesCount || 0;
          errorRateElement.textContent = errorRatesCount > 0 ? 
            `${errorRatesCount} issues detected` : 'No issues detected';
        }
        
        if (fileOperationsElement) {
          const fileOpsCount = data.performanceMetrics.fileOperationsCount || 0;
          fileOperationsElement.textContent = fileOpsCount > 0 ? 
            `${fileOpsCount} files accessed` : 'No file activity tracked';
        }
        
        if (workspaceFilesElement) {
          const workspaceActivity = data.performanceMetrics.workspaceActivity || {};
          const totalFiles = workspaceActivity.totalFiles || 0;
          const uniqueFileTypes = workspaceActivity.uniqueFileTypes || 0;
          workspaceFilesElement.textContent = totalFiles > 0 ? 
            `${totalFiles} files (${uniqueFileTypes} types)` : 'No workspace files tracked';
        }
        
        if (searchQueriesElement) {
          const searchActivity = data.performanceMetrics.searchActivity || {};
          const searchQueries = searchActivity.searchQueries || 0;
          const findHistory = searchActivity.findHistory || 0;
          const totalSearches = searchQueries + findHistory;
          searchQueriesElement.textContent = totalSearches > 0 ? 
            `${totalSearches} queries performed` : 'No search activity tracked';
        }
        
        if (terminalSessionsElement) {
          const terminalActivity = data.performanceMetrics.terminalActivity || {};
          const terminalSessions = terminalActivity.terminalSessions || 0;
          terminalSessionsElement.textContent = terminalSessions > 0 ? 
            `${terminalSessions} sessions active` : 'No terminal activity tracked';
        }
        
        if (composerSessionsElement) {
          const composerActivity = data.performanceMetrics.composerActivity || {};
          const totalComposers = composerActivity.totalComposers || 0;
          const activeComposers = composerActivity.activeComposers || 0;
          composerSessionsElement.textContent = totalComposers > 0 ? 
            `${totalComposers} total (${activeComposers} active)` : 'No composer activity tracked';
        }
        
        if (editorStatesElement) {
          const workspaceActivity = data.performanceMetrics.workspaceActivity || {};
          const editorStates = workspaceActivity.editorStates || 0;
          editorStatesElement.textContent = editorStates > 0 ? 
            `${editorStates} editor states` : 'No editor states tracked';
        }
      }
      
      if (data.promptAcceptanceReport && data.promptAcceptanceReport.length > 0) {
        populatePromptAcceptanceTable(data.promptAcceptanceReport);
      }
      
    } catch (error) {
      // Show error message to user
      const errorContainer = document.createElement('div');
      errorContainer.className = 'alert alert-danger';
      errorContainer.innerHTML = `
        <h4>Error Loading Dashboard</h4>
        <p>There was an error loading the dashboard data: ${error.message}</p>
        <p>Please try refreshing the page or contact support if the problem persists.</p>
      `;
      
      // Insert error message at the top of the dashboard
      const dashboard = document.querySelector('.container-fluid');
      if (dashboard) {
        dashboard.insertBefore(errorContainer, dashboard.firstChild);
      }
    }
  }

  // Call populateDashboard when the page loads (only once)
  populateDashboard();

  // Add CSS for .btn and .btn-view if not present
  (function addPromptAcceptanceBtnStyles() {
    if (!document.getElementById('prompt-acceptance-btn-styles')) {
      const style = document.createElement('style');
      style.id = 'prompt-acceptance-btn-styles';
      style.innerHTML = `
        .btn {
          padding: 0.4em 1.1em;
          border: none;
          border-radius: 4px;
          background: #4e73df;
          color: #fff;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
          font-size: 1em;
        }
        .btn-view {
          background: #36b9cc;
          color: #fff;
          margin: 0 0.2em;
        }
        .btn-view:hover {
          background: #259fae;
        }
        .view-more-btn {
          display: inline-block;
          padding: 0.4em 1.1em;
          background: #1cc88a;
          color: #fff;
          border-radius: 4px;
          text-decoration: none;
          font-weight: 500;
          margin-top: 0.5em;
          transition: background 0.2s;
          font-size: 0.9em;
        }
        .view-more-btn:hover {
          background: #17a673;
          color: #fff;
          text-decoration: none;
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1em;
        }
        .section-header h2 {
          margin: 0;
          font-size: 1.5em;
          font-weight: 600;
        }
        .section-header .view-more-btn {
          margin-top: 0;
          padding: 0.3em 0.8em;
          font-size: 0.85em;
        }
      `;
      document.head.appendChild(style);
    }
  })();

  // Ensure modal logic for Prompt Acceptance Report is attached on page load (for SSR table)
  const promptAcceptanceTable = document.getElementById('promptAcceptanceTable');
  if (promptAcceptanceTable) {
    // Call with empty array to attach listeners to existing buttons
    populatePromptAcceptanceTable([]);
  }

  // Initialize DataTables for Sensitive Data Report and Prompt Acceptance Report
  if (window.$ && $.fn.DataTable) {
    if (document.getElementById('sensitiveTable')) {
      $('#sensitiveTable').DataTable({
        paging: true,
        searching: true,
        ordering: true,
        responsive: true,
        pageLength: 10,
        language: {
          search: "Search sensitive data:",
          info: "Showing _TOTAL_ sensitive entries"
        }
      });
    }
    if (document.getElementById('promptAcceptanceTable')) {
      $('#promptAcceptanceTable').DataTable({
        paging: true,
        searching: true,
        ordering: true,
        responsive: true,
        pageLength: 10,
        language: {
          search: "Search prompts:",
          info: "Showing _TOTAL_ prompt acceptance records"
        }
      });
    }
  }
});

// End of dashboard.js

 