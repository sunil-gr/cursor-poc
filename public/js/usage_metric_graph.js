// Usage Metrics Graph JavaScript
// Handles chart rendering and data visualization

// Global variable to store metrics data
let metricsData = {};

document.addEventListener('DOMContentLoaded', function() {
    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
        alert('Chart.js is not loaded. Please refresh the page.');
        return;
    }

    // Load metricsData from the DOM element
    try {
        const metricsElement = document.getElementById('metricsData');
        if (metricsElement && metricsElement.dataset.json) {
            metricsData = JSON.parse(decodeURIComponent(metricsElement.dataset.json));
        } else {
            console.warn('No metrics data found in DOM');
            metricsData = {};
        }
    } catch (error) {
        console.error('Failed to parse metrics data:', error);
        metricsData = {};
    }

    // Check if metricsData is available
    if (!metricsData || Object.keys(metricsData).length === 0) {
        console.warn('No metrics data available');
        return;
    }

    // Initialize all charts
    initializeCharts();
});

/**
 * Initialize all charts on the page
 */
function initializeCharts() {
    // Render the heatmap if data is available
    if (metricsData && metricsData.generations && metricsData.generations.length > 0) {
        createGenerationHeatmap(metricsData.generations);
    }

    // Render the performance chart if data is available
    if (metricsData && metricsData.performanceMetrics) {
        createPerformanceChart(metricsData.performanceMetrics);
    }

    // Render the sensitive data chart if data is available
    if (metricsData && metricsData.sensitiveKeywordCounts) {
        createSensitiveDataChart(metricsData.sensitiveKeywordCounts);
    }

    // Render the section pie chart if data is available
    if (metricsData) {
        createSectionPieChart(metricsData);
    }

    // Render the languages chart if data is available
    if (metricsData && metricsData.devEnvironment && metricsData.devEnvironment.languageDetection) {
        createLanguagesChart(metricsData.devEnvironment.languageDetection);
    }

    // Initialize the new line charts
    createLineChangesChart();
    createTabAcceptanceChart();
}

function createGenerationHeatmap(generations) {
    const warningDiv = document.getElementById('generationHeatmapWarning');
    if (!generations || generations.length === 0) {
        if (warningDiv) {
            warningDiv.textContent = 'No generation data available.';
            warningDiv.style.display = '';
        }
        return;
    }
    if (!window.Chart) {
        if (warningDiv) {
            warningDiv.textContent = 'Chart.js is not loaded.';
            warningDiv.style.display = '';
        }
        return;
    }
    if (!document.getElementById('generationHeatmap')) {
        if (warningDiv) {
            warningDiv.textContent = 'generationHeatmap canvas not found.';
            warningDiv.style.display = '';
        }
        return;
    }
    // Prepare data: group by day and hour
    const heatmapData = {};
    generations.forEach((g, index) => {
        // Try different date fields
        let date = null;
        if (g.timestamp) {
            date = new Date(g.timestamp);
        } else if (g.createdAt) {
            date = new Date(g.createdAt);
        } else if (g.unixMs) {
            date = new Date(g.unixMs);
        } else if (g.date) {
            date = new Date(g.date);
        }
        
        if (!date || isNaN(date.getTime())) {
            return;
        }
        
        const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
        const hour = date.getHours();
        if (!heatmapData[day]) heatmapData[day] = Array(24).fill(0);
        heatmapData[day][hour]++;
    });
    const days = Object.keys(heatmapData).sort();
    const dataMatrix = days.map(day => heatmapData[day]);
    // Check if matrix chart type is available (Chart.js v4+)
    let matrixController;
    try {
        matrixController = Chart.registry.getController('matrix');
    } catch (e) {
        matrixController = undefined;
    }
    if (!matrixController) {
        if (warningDiv) {
            warningDiv.textContent = 'Chart.js Matrix chart type is not available. Please check the plugin load order. Available types: ' + Object.keys(Chart.registry.controllers).join(', ');
            warningDiv.style.display = '';
        }
        return;
    } else if (warningDiv) {
        warningDiv.style.display = 'none';
    }
    // Destroy existing chart if it exists
    if (window.generationHeatmapInstance) {
        window.generationHeatmapInstance.destroy();
    }
    try {
        window.generationHeatmapInstance = new Chart(document.getElementById('generationHeatmap').getContext('2d'), {
            type: 'matrix',
            data: {
                datasets: [{
                    label: 'Generations Heatmap',
                    data: days.flatMap((day, y) => heatmapData[day].map((value, x) => ({ x, y, v: value }))),
                    backgroundColor: ctx => {
                        const v = ctx.raw.v;
                        const max = Math.max(...dataMatrix.flat());
                        return v === 0 ? '#f0f0f0' : `rgba(78, 115, 223, ${0.2 + 0.8 * (max ? v / max : 0)})`;
                    },
                    width: ({chart}) => (chart.chartArea || {}).width / 24 - 2,
                    height: ({chart}) => (chart.chartArea || {}).height / days.length - 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: ctx => `Day: ${days[ctx[0].raw.y]}, Hour: ${ctx[0].raw.x}`,
                            label: ctx => `Generations: ${ctx.raw.v}`
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: 0,
                        max: 23,
                        ticks: { callback: v => `${v}:00` }
                    },
                    y: {
                        type: 'linear',
                        min: 0,
                        max: days.length - 1,
                        ticks: { callback: v => days[v] }
                    }
                }
            }
        });
    } catch (e) {
        if (warningDiv) {
            warningDiv.textContent = 'Failed to render heatmap: ' + e.message;
            warningDiv.style.display = '';
        }
    }
}

function createPerformanceChart(performanceMetrics) {
    if (!window.Chart || !document.getElementById('performanceChart') || !performanceMetrics) {
        return;
    }

    try {
        const ctx = document.getElementById('performanceChart').getContext('2d');
        
        // Use the original performance metrics structure
        const perf = performanceMetrics;
        const labels = [
            'Issues Detected',
            'File Activity',
            'Workspace Files',
            'Search Queries',
            'Terminal Sessions',
            'Composer Sessions',
            'Editor States'
        ];
        const perfData = [
            perf.errorRates ? perf.errorRates.length : 0,
            perf.fileOperations ? perf.fileOperations.length : 0,
            perf.workspaceActivity && perf.workspaceActivity.totalFiles ? perf.workspaceActivity.totalFiles : 0,
            perf.searchActivity && perf.searchActivity.searchQueries ? perf.searchActivity.searchQueries : 0,
            perf.terminalActivity && perf.terminalActivity.terminalSessions ? perf.terminalActivity.terminalSessions : 0,
            perf.composerActivity && perf.composerActivity.totalComposers ? perf.composerActivity.totalComposers : 0,
            perf.workspaceActivity && perf.workspaceActivity.editorStates ? perf.workspaceActivity.editorStates : 0
        ];

        // Destroy existing chart if it exists
        if (window.performanceChartInstance) {
            window.performanceChartInstance.destroy();
        }

        window.performanceChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Count',
                    data: perfData,
                    backgroundColor: [
                        '#4e73df','#1cc88a','#36b9cc','#f6c23e','#e74a3b','#858796','#5a5c69','#ff6384'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Performance Metrics' }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });
    } catch (e) {
        // Handle chart creation errors silently
    }
}

function createSensitiveDataChart(sensitiveKeywordCounts) {
    if (!window.Chart || !document.getElementById('sensitiveChart') || !sensitiveKeywordCounts) {
        return;
    }

    const labels = Object.keys(sensitiveKeywordCounts).filter(k => sensitiveKeywordCounts[k] > 0);
    const chartData = labels.map(k => sensitiveKeywordCounts[k]);

    // Destroy existing chart if it exists
    if (window.sensitiveChartInstance) {
        window.sensitiveChartInstance.destroy();
    }

    if (labels.length > 0) {
        try {
            window.sensitiveChartInstance = new Chart(document.getElementById('sensitiveChart').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Sensitive Keyword Count',
                        data: chartData,
                        backgroundColor: 'rgba(255, 99, 132, 0.5)',
                        borderColor: 'rgba(255, 99, 132, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        title: { display: true, text: 'Sensitive Keyword Distribution' }
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } }
                    }
                }
            });
        } catch (e) {
            // Handle chart creation errors silently
        }
    } else {
        // If all values are zero, clear the canvas
        const ctx = document.getElementById('sensitiveChart').getContext('2d');
        ctx.clearRect(0, 0, 500, 300);
    }
}

function createSectionPieChart(data) {
    if (!window.Chart || !document.getElementById('sectionPieChart')) {
        return;
    }

    // Gather counts for each section
    const sectionLabels = [
        'Sensitive Data Report',
        'Most Common Prompts',
        'Recent Prompts',
        'Recent Generations',
        'Recent Files Opened/Edited'
    ];
    const sensitiveCount = data.sensitiveResults ? data.sensitiveResults.length : 0;
    const commonPromptsCount = data.prompts ? (Array.isArray(data.prompts) ? data.prompts.reduce((acc, p) => {
        if (p.text) acc[p.text] = (acc[p.text]||0)+1; return acc;
    }, {}) : {}) : {};
    const mostCommonPromptsCount = Object.keys(commonPromptsCount).length;
    const recentPromptsCount = data.prompts ? data.prompts.length : 0;
    const recentGenerationsCount = data.generations ? data.generations.length : 0;
    const recentFilesCount = data.historyEntries ? data.historyEntries.length : 0;
    const sectionData = [
        sensitiveCount,
        mostCommonPromptsCount,
        recentPromptsCount,
        recentGenerationsCount,
        recentFilesCount
    ];

    // Destroy existing chart if it exists
    if (window.sectionPieChartInstance) {
        window.sectionPieChartInstance.destroy();
    }

    if (sectionData.some(v => v > 0)) {
        try {
            window.sectionPieChartInstance = new Chart(document.getElementById('sectionPieChart').getContext('2d'), {
                type: 'pie',
                data: {
                    labels: sectionLabels,
                    datasets: [{
                        data: sectionData,
                        backgroundColor: ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b'],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            align: 'start',
                            labels: {
                                padding: 15,
                                usePointStyle: true,
                                font: {
                                    size: 12
                                }
                            }
                        }
                    },
                    layout: {
                        padding: {
                            right: 20
                        }
                    }
                }
            });
        } catch (e) {
            // Handle chart creation errors silently
        }
    }
}

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
        
        try {
            window.languagesChartInstance = new Chart(document.getElementById('languagesChart').getContext('2d'), {
                type: 'doughnut',
                data: { 
                    labels: langLabels, 
                    datasets: [{ 
                        label: 'Languages', 
                        data: langData, 
                        backgroundColor: [
                            '#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', 
                            '#e74a3b', '#858796', '#5a5c69', '#6f42c1',
                            '#fd7e14', '#20c997', '#e83e8c', '#6c757d'
                        ],
                        borderWidth: 3,
                        borderColor: '#fff',
                        hoverBorderWidth: 4,
                        hoverBorderColor: '#fff',
                        // 3D effect with shadows
                        shadowOffsetX: 3,
                        shadowOffsetY: 3,
                        shadowBlur: 10,
                        shadowColor: 'rgba(0, 0, 0, 0.3)'
                    }] 
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '60%', // Creates the donut hole
                    plugins: {
                        legend: {
                            position: 'left',
                            align: 'start',
                            labels: {
                                padding: 15,
                                usePointStyle: true,
                                font: {
                                    size: 12,
                                    weight: 'bold'
                                },
                                generateLabels: function(chart) {
                                    const data = chart.data;
                                    if (data.labels.length && data.datasets.length) {
                                        return data.labels.map((label, i) => {
                                            const dataset = data.datasets[0];
                                            const value = dataset.data[i];
                                            const total = dataset.data.reduce((a, b) => a + b, 0);
                                            const percentage = ((value / total) * 100).toFixed(1);
                                            return {
                                                text: `${label} (${percentage}%)`,
                                                fillStyle: dataset.backgroundColor[i],
                                                strokeStyle: dataset.backgroundColor[i],
                                                lineWidth: 0,
                                                pointStyle: 'circle',
                                                hidden: false,
                                                index: i
                                            };
                                        });
                                    }
                                    return [];
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${label}: ${value} (${percentage}%)`;
                                }
                            }
                        }
                    },
                    layout: {
                        padding: {
                            left: 20,
                            right: 20
                        }
                    },
                    // Enhanced 3D effect
                    elements: {
                        arc: {
                            borderWidth: 3,
                            borderColor: '#fff',
                            backgroundColor: function(context) {
                                const colors = [
                                    '#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', 
                                    '#e74a3b', '#858796', '#5a5c69', '#6f42c1',
                                    '#fd7e14', '#20c997', '#e83e8c', '#6c757d'
                                ];
                                return colors[context.dataIndex % colors.length];
                            }
                        }
                    },
                    animation: {
                        animateRotate: true,
                        animateScale: true,
                        duration: 1000,
                        easing: 'easeOutQuart'
                    }
                }
            });
        } catch (e) {
            // Handle chart creation errors silently
        }
    }
}

/**
 * Create line chart for Total Line Changes from Chat
 */
function createLineChangesChart() {
    const ctx = document.getElementById('lineChangesChart');
    if (!ctx) {
        return;
    }

    // Fetch data from API
    fetch('/api/metrics/line-changes')
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                return;
            }

            const chartData = data.data;
            
            // Prepare data for chart
            const dates = Object.keys(chartData.lineChangesByDate).sort();
            const values = dates.map(date => chartData.lineChangesByDate[date]);

            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: dates,
                    datasets: [{
                        label: 'Line Changes from Chat',
                        data: values,
                        borderColor: 'rgb(75, 192, 192)',
                        backgroundColor: 'rgba(75, 192, 192, 0.2)',
                        tension: 0.1,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Total Line Changes from Chat Over Time',
                            font: {
                                size: 16,
                                weight: 'bold'
                            }
                        },
                        legend: {
                            display: true,
                            position: 'top'
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of Line Changes'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Date'
                            }
                        }
                    }
                }
            });
        })
        .catch(error => {
        });
}

/**
 * Create line chart for Total Tabs Accepted
 */
function createTabAcceptanceChart() {
    const ctx = document.getElementById('tabAcceptanceChart');
    if (!ctx) {
        return;
    }

    // Fetch data from API
    fetch('/api/metrics/tab-acceptance')
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                return;
            }

            const chartData = data.data;
            
            // Prepare data for chart
            const dates = Object.keys(chartData.tabsAcceptedByDate).sort();
            const values = dates.map(date => chartData.tabsAcceptedByDate[date]);

            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: dates,
                    datasets: [{
                        label: 'Tabs Accepted',
                        data: values,
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        tension: 0.1,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Total Tabs Accepted Over Time',
                            font: {
                                size: 16,
                                weight: 'bold'
                            }
                        },
                        legend: {
                            display: true,
                            position: 'top'
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of Tabs Accepted'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Date'
                            }
                        }
                    }
                }
            });
        })
        .catch(error => {
        });
} 