// State management
let state = {
    currentView: 'home',
    videos: [],
    selectedVideoId: null,
    ingestTab: 'url',
    billingCycle: 'monthly',
    webhookTargetUrl: '',
    playerTimer: null,
    isPlaying: false,
    playerCurrentTime: 0,
    playerTotalDuration: 0,
    pollingInterval: null
};

// Snippet templates
const snippets = {
    curl: `curl -X POST http://127.0.0.1:8000/api/analyze/url \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://www.youtube.com/watch?v=attio-gtm",
    "webhook_url": "https://yoursite.com/webhooks/video"
  }'`,
    python: `import requests

payload = {
    "url": "https://www.youtube.com/watch?v=attio-gtm",
    "webhook_url": "https://yoursite.com/webhooks/video"
}

response = requests.post(
    "http://127.0.0.1:8000/api/analyze/url",
    json=payload
)
print(response.json())`,
    js: `const axios = require('axios');

const payload = {
  url: 'https://www.youtube.com/watch?v=attio-gtm',
  webhook_url: 'https://yoursite.com/webhooks/video'
};

axios.post('http://127.0.0.1:8000/api/analyze/url', payload)
  .then(res => console.log(res.data))
  .catch(err => console.error(err));`
};

// Initial setup
window.addEventListener('DOMContentLoaded', () => {
    // Router handling
    const hash = window.location.hash.substring(1);
    if (hash) {
        navigateTo(hash);
    } else {
        navigateTo('home');
    }

    // Load active logs
    fetchVideosList();
    fetchWebhookLogs();

    // Start background webhook stream updates
    setInterval(fetchWebhookLogs, 2000);

    // Setup drag & drop handlers
    setupDragDropZone();
});

// Navigation / Router
function navigateTo(viewId) {
    // Sanitize view name
    const validViews = ['home', 'platform', 'workflows', 'developers', 'remotion', 'customers', 'pricing', 'security', 'dashboard'];
    let target = viewId.toLowerCase();
    if (!validViews.includes(target)) target = 'home';

    state.currentView = target;

    // Toggle active state for elements
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });

    const targetSection = document.getElementById(`${target}-view`);
    if (targetSection) {
        targetSection.classList.add('active');
    }

    // Update active nav items
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${target}`) {
            link.classList.add('active');
        }
    });

    // Handle initial state loads
    if (target === 'dashboard') {
        fetchVideosList();
    }
}

// Ingest tab toggle
function setIngestTab(tabName) {
    state.ingestTab = tabName;
    document.querySelectorAll('.tab-select').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.ingest-form').forEach(form => form.classList.remove('active'));

    document.getElementById(`tab-${tabName}-btn`).classList.add('active');
    document.getElementById(`ingest-${tabName}-form`).classList.add('active');
}

// Developer Snippet tab toggle
function switchSnippet(language) {
    document.querySelectorAll('.snippet-tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    const block = document.getElementById('snippet-code-block');
    if (block) {
        block.innerHTML = `<code>${escapeHTML(snippets[language])}</code>`;
    }
}

// Pricing billing cycle toggle
function toggleBillingCycle() {
    const btn = document.getElementById('billing-cycle-toggle');
    if (state.billingCycle === 'monthly') {
        state.billingCycle = 'yearly';
        btn.classList.add('active');
        // Update prices with annual discounts
        document.getElementById('price-pro').innerText = '39';
        document.getElementById('price-starter').innerText = '0';
    } else {
        state.billingCycle = 'monthly';
        btn.classList.remove('active');
        document.getElementById('price-pro').innerText = '49';
        document.getElementById('price-starter').innerText = '0';
    }
}

// Webhook destination registration
function saveWebhookTarget() {
    const input = document.getElementById('webhook-target-input');
    const status = document.getElementById('webhook-save-status');
    if (input && input.value.trim()) {
        state.webhookTargetUrl = input.value.trim();
        status.innerText = `Registered: ${state.webhookTargetUrl}`;
        setTimeout(() => status.innerText = '', 3000);
    }
}

// Fetch dashboard videos list
async function fetchVideosList() {
    try {
        const response = await fetch('/api/videos');
        const videos = await response.json();
        state.videos = videos;
        renderVideosList();
        renderDashboardStats();
        
        // If there's an active processing video, enable polling
        const hasProcessing = videos.some(v => ['queued', 'extracting', 'transcribing', 'summarizing'].includes(v.status));
        if (hasProcessing && !state.pollingInterval) {
            state.pollingInterval = setInterval(fetchVideosList, 3000);
        } else if (!hasProcessing && state.pollingInterval) {
            clearInterval(state.pollingInterval);
            state.pollingInterval = null;
        }

        // Update details panel if a video is currently open
        if (state.selectedVideoId) {
            const openVideo = videos.find(v => v.id === state.selectedVideoId);
            if (openVideo) {
                renderVideoDetail(openVideo);
            }
        }
    } catch (err) {
        console.error("Failed to fetch videos list:", err);
    }
}

// Render the list of past analyses in sidebar
function renderVideosList() {
    const container = document.getElementById('dashboard-videos-list');
    if (!container) return;

    if (state.videos.length === 0) {
        container.innerHTML = '<div class="list-spinner">No videos analyzed. Add one above!</div>';
        return;
    }

    container.innerHTML = '';
    state.videos.forEach(video => {
        const item = document.createElement('div');
        item.className = `video-item ${state.selectedVideoId === video.id ? 'active' : ''}`;
        item.onclick = () => selectVideo(video.id);

        let statusClass = 'pill-process';
        let statusText = video.status;
        if (video.status === 'done') {
            statusClass = 'pill-done';
            statusText = 'Completed';
        } else if (video.status === 'failed') {
            statusClass = 'pill-failed';
            statusText = 'Failed';
        }

        item.innerHTML = `
            <h4>${escapeHTML(video.title)}</h4>
            <div class="video-item-meta">
                <span>${formatDuration(video.duration_seconds)}</span>
                <span class="pill ${statusClass}">${statusText}</span>
            </div>
        `;
        container.appendChild(item);
    });
}

// Render Dashboard bento cards counters
function renderDashboardStats() {
    const totalSpan = document.getElementById('stat-total-count');
    const doneSpan = document.getElementById('stat-done-count');
    const processSpan = document.getElementById('stat-processing-count');
    const failedSpan = document.getElementById('stat-failed-count');

    if (!totalSpan) return;

    const total = state.videos.length;
    const done = state.videos.filter(v => v.status === 'done').length;
    const failed = state.videos.filter(v => v.status === 'failed').length;
    const processing = total - done - failed;

    totalSpan.innerText = total;
    doneSpan.innerText = done;
    processSpan.innerText = processing;
    failedSpan.innerText = failed;
}

// Select video to view details
function selectVideo(videoId) {
    state.selectedVideoId = videoId;
    
    // Toggle active classes on sidebar items
    document.querySelectorAll('.video-item').forEach(item => item.classList.remove('active'));
    renderVideosList();

    // Show detail panel
    document.getElementById('dashboard-grid-view').classList.remove('active');
    document.getElementById('dashboard-detail-view').classList.add('active');

    // Retrieve full video details
    const video = state.videos.find(v => v.id === videoId);
    if (video) {
        renderVideoDetail(video);
    }
}

// Close detail view, return to bento grid
function closeVideoDetail() {
    state.selectedVideoId = null;
    stopMockPlayer();
    
    document.getElementById('dashboard-detail-view').classList.remove('active');
    document.getElementById('dashboard-grid-view').classList.add('active');
    renderVideosList();
}

// Render complete details pane
function renderVideoDetail(video) {
    document.getElementById('detail-video-title').innerText = video.title;
    const sourceBadge = document.getElementById('detail-video-source');
    sourceBadge.innerText = video.source_type;
    sourceBadge.className = `video-source-badge ${video.source_type}`;

    const playerStatus = document.getElementById('player-status-text');
    const totalDurationLabel = document.getElementById('player-total-duration');
    totalDurationLabel.innerText = formatDuration(video.duration_seconds);
    state.playerTotalDuration = video.duration_seconds;

    // Reset components depending on status
    if (video.status !== 'done') {
        // Still processing or failed
        playerStatus.innerText = video.status === 'failed' ? `Pipeline Failed: ${video.error_message}` : `Pipeline Running: In state [${video.status}]`;
        document.getElementById('detail-transcript-sentences').innerHTML = `<div class="list-spinner">Processing transcript assets. Please wait...</div>`;
        document.getElementById('detail-tldr-text').innerText = 'Summarization queuing...';
        document.getElementById('detail-quotes-list').innerHTML = '';
        document.getElementById('detail-steps-list').innerHTML = '';
        document.getElementById('detail-chapters-timeline').innerHTML = '';
        return;
    }

    // Done status - load full content
    playerStatus.innerText = `Playback Simulation — '${video.title}'`;
    
    // Load summary & quotes
    const summary = video.summary;
    document.getElementById('detail-tldr-text').innerText = summary.tldr;
    
    const quotesList = document.getElementById('detail-quotes-list');
    quotesList.innerHTML = '';
    summary.key_quotes.forEach(quote => {
        const li = document.createElement('li');
        li.innerText = quote;
        quotesList.appendChild(li);
    });

    // Load steps list
    const stepsList = document.getElementById('detail-steps-list');
    stepsList.innerHTML = '';
    summary.steps.forEach(step => {
        const item = document.createElement('div');
        item.className = 'step-row-item';
        item.innerHTML = `
            <div class="step-order-badge">${step.order}</div>
            <div class="step-content">
                <p>${escapeHTML(step.instruction)}</p>
                <span>Timestamp: ${step.timestamp}</span>
            </div>
        `;
        stepsList.appendChild(item);
    });

    // Load chapters timeline
    const chaptersTimeline = document.getElementById('detail-chapters-timeline');
    chaptersTimeline.innerHTML = '';
    summary.chapters.forEach(chapter => {
        const item = document.createElement('div');
        item.className = 'chapter-timeline-item';
        item.innerHTML = `
            <div class="chapter-ts-title">
                <span class="chapter-ts">${chapter.start_ts}</span>
                <h4>${escapeHTML(chapter.title)}</h4>
            </div>
            <p>${escapeHTML(chapter.summary)}</p>
        `;
        chaptersTimeline.appendChild(item);
    });

    // Mock transcript loaded from details
    renderMockTranscriptLines(video);
}

// Generate mock sentences for transcripts
function renderMockTranscriptLines(video) {
    const container = document.getElementById('detail-transcript-sentences');
    if (!container) return;

    container.innerHTML = '';
    const sentences = [
        { ts: 0, text: "Alright, welcome back. Today, we're talking about automating GTM pipelines." },
        { ts: 10, text: "The primary challenge developers face is scaling outreach without losing personalisation." },
        { ts: 25, text: "Intelligent GTM agents don't just log details; they operate active pipelines while you sleep." },
        { ts: 45, text: "Here is how you initialize your workspace custom structures programmatically." },
        { ts: 70, text: "Next, we define our transition routers to detect deal value changes on DB rows." },
        { ts: 110, text: "Our serverless workflows evaluate the opportunity and invoke secondary fallback loops." },
        { ts: 145, text: "Finally, we trigger outbound webhooks to alert developers of success events." },
        { ts: 170, text: "Let's run a test query to confirm Neon DB connection states." }
    ];

    sentences.forEach((line, index) => {
        // filter duration
        if (line.ts > video.duration_seconds) return;

        const row = document.createElement('div');
        row.className = 'transcript-line';
        row.id = `line-${line.ts}`;
        row.onclick = () => seekPlayerToSeconds(line.ts);
        row.innerHTML = `
            <span class="line-ts">${formatTimestampSeconds(line.ts)}</span>
            <span class="line-text">${escapeHTML(line.text)}</span>
        `;
        container.appendChild(row);
    });
}

// Tab switcher in Video Detail view
function switchDetailTab(tabId) {
    const detailPanel = document.getElementById('dashboard-detail-view');
    detailPanel.querySelectorAll('.detail-tab-btn').forEach(btn => btn.classList.remove('active'));
    detailPanel.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    event.target.classList.add('active');
    document.getElementById(`tab-content-${tabId}`).classList.add('active');
}

// Submit YouTube url form
async function submitURLForAnalysis() {
    const input = document.getElementById('ingest-video-url');
    if (!input || !input.value.trim()) return;

    const url = input.value.trim();
    input.value = '';

    try {
        const payload = {
            url: url,
            webhook_url: state.webhookTargetUrl || null
        };
        const response = await fetch('/api/analyze/url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const res = await response.json();
        
        // Refresh videos list
        fetchVideosList();
        
        // Select the newly queued video
        if (res.video_id) {
            setTimeout(() => selectVideo(res.video_id), 500);
        }
    } catch (err) {
        console.error("URL Ingestion submission failed:", err);
    }
}

// Setup drag drop upload zone
function setupDragDropZone() {
    const zone = document.getElementById('drag-drop-zone');
    if (!zone) return;

    // Trigger file chooser on click
    zone.onclick = () => {
        const fileInput = document.getElementById('file-uploader-input');
        if (fileInput) fileInput.click();
    };

    const input = document.getElementById('file-uploader-input');
    if (input) {
        input.onchange = (e) => {
            if (e.target.files.length > 0) {
                simulateFileIngestion(e.target.files[0]);
            }
        };
    }

    zone.ondragover = (e) => {
        e.preventDefault();
        zone.classList.add('drag-active');
    };

    zone.ondragleave = () => {
        zone.classList.remove('drag-active');
    };

    zone.ondrop = (e) => {
        e.preventDefault();
        zone.classList.remove('drag-active');
        if (e.dataTransfer.files.length > 0) {
            simulateFileIngestion(e.dataTransfer.files[0]);
        }
    };
}

// Simulates client-side compression before API submission
function simulateFileIngestion(file) {
    const zone = document.getElementById('drag-drop-zone');
    if (!zone) return;

    zone.innerHTML = `
        <div class="render-progress-container" style="width: 100%;">
            <span class="render-status-text" style="color: var(--text-primary); font-weight:600;">ffmpeg.wasm Audio Extraction</span>
            <div class="render-bar-outer"><div class="render-bar-inner" id="wasm-progress-fill"></div></div>
            <span class="render-status-text" id="wasm-status-text">Compressing to MP3 (128kbps)...</span>
        </div>
    `;

    let progress = 0;
    const interval = setInterval(async () => {
        progress += 15;
        const fill = document.getElementById('wasm-progress-fill');
        if (fill) fill.style.width = `${Math.min(progress, 100)}%`;

        if (progress >= 100) {
            clearInterval(interval);
            // Submit metadata to backend
            try {
                const response = await fetch('/api/analyze/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: file.name,
                        file_size_bytes: file.size,
                        webhook_url: state.webhookTargetUrl || null
                    })
                });
                const res = await response.json();
                
                // Restore zones
                zone.innerHTML = `
                    <span class="drag-icon">📥</span>
                    <span class="drag-text">Drag .mp4 here or click</span>
                    <input type="file" id="file-uploader-input" accept="video/mp4" style="display: none;">
                `;
                setupDragDropZone();

                fetchVideosList();
                if (res.video_id) {
                    setTimeout(() => selectVideo(res.video_id), 500);
                }
            } catch (err) {
                console.error("Upload initialization failed:", err);
            }
        }
    }, 300);
}

// Retrieve real webhook logs from server
async function fetchWebhookLogs() {
    try {
        const response = await fetch('/api/webhooks/logs');
        const logs = await response.json();
        renderWebhookLogs(logs);
    } catch (err) {
        console.error("Failed to fetch webhook logs:", err);
    }
}

// Render webhook logs inside terminal logger
function renderWebhookLogs(logs) {
    const container = document.getElementById('webhook-stream-container');
    if (!container) return;

    if (logs.length === 0) {
        container.innerHTML = '<div class="stream-placeholder">Waiting for simulation triggers... Submit a video in the Dashboard to stream events in real time.</div>';
        return;
    }

    container.innerHTML = '';
    logs.forEach(log => {
        const row = document.createElement('div');
        row.className = 'webhook-log-row';

        let tagClass = 'info';
        if (log.event === 'job.completed') tagClass = 'success';
        if (log.event === 'job.failed') tagClass = 'failed';

        row.innerHTML = `
            <div class="log-meta">
                <span class="log-event-tag ${tagClass}">${escapeHTML(log.event)}</span>
                <span>${new Date(log.timestamp * 1000).toLocaleTimeString()}</span>
            </div>
            <pre class="log-payload-json"><code>${escapeHTML(JSON.stringify(log.data, null, 2))}</code></pre>
        `;
        container.appendChild(row);
    });
}

// Clear webhook stream logs
async function clearWebhookStreamLogs() {
    try {
        await fetch('/api/webhooks/clear');
        fetchWebhookLogs();
    } catch (err) {
        console.error("Failed to clear webhooks log:", err);
    }
}

// Remotion highlight clip renderer simulator
function triggerRemotionRender() {
    const btn = document.getElementById('btn-start-render');
    const progressWrapper = document.getElementById('render-progress-bar-wrapper');
    const fill = document.getElementById('render-bar-fill');
    const msg = document.getElementById('render-status-message');
    const outputCard = document.getElementById('rendered-output-video-card');

    if (!btn || !progressWrapper) return;

    btn.style.display = 'none';
    progressWrapper.style.display = 'block';
    outputCard.style.display = 'none';

    const stages = [
        { prg: 10, text: "Ranking transcript segments..." },
        { prg: 30, text: "Extracting vertical crop dimensions..." },
        { prg: 50, text: "Generating captions overlays..." },
        { prg: 75, text: "Compositing video sequences..." },
        { prg: 90, text: "Encoding highlights output..." },
        { prg: 100, text: "Done!" }
    ];

    let currentStage = 0;
    const interval = setInterval(() => {
        if (currentStage >= stages.length) {
            clearInterval(interval);
            progressWrapper.style.display = 'none';
            outputCard.style.display = 'block';
            return;
        }

        const stage = stages[currentStage];
        if (fill) fill.style.width = `${stage.prg}%`;
        if (msg) msg.innerText = stage.text;
        
        currentStage++;
    }, 1200);
}

// Player simulation control
function togglePlayerPlayback() {
    const btn = document.getElementById('btn-player-play');
    if (state.isPlaying) {
        stopMockPlayer();
        if (btn) btn.innerText = 'Play';
    } else {
        startMockPlayer();
        if (btn) btn.innerText = 'Pause';
    }
}

function startMockPlayer() {
    state.isPlaying = true;
    const fill = document.getElementById('player-progress-fill');
    const label = document.getElementById('player-current-time');

    state.playerTimer = setInterval(() => {
        state.playerCurrentTime++;
        if (state.playerCurrentTime > state.playerTotalDuration) {
            stopMockPlayer();
            state.playerCurrentTime = 0;
            const btn = document.getElementById('btn-player-play');
            if (btn) btn.innerText = 'Play';
            return;
        }

        // Update fill bar
        const percentage = (state.playerCurrentTime / state.playerTotalDuration) * 100;
        if (fill) fill.style.width = `${percentage}%`;
        if (label) label.innerText = formatTimestampSeconds(state.playerCurrentTime);

        // Highlight transcripts lines
        highlightActiveTranscriptLine(state.playerCurrentTime);
    }, 1000);
}

function stopMockPlayer() {
    state.isPlaying = false;
    if (state.playerTimer) {
        clearInterval(state.playerTimer);
        state.playerTimer = null;
    }
}

function seekPlayer(event) {
    const bar = document.getElementById('player-progress-bar');
    if (!bar) return;

    const rect = bar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const width = rect.width;
    const percentage = clickX / width;
    
    const targetSeconds = Math.floor(percentage * state.playerTotalDuration);
    seekPlayerToSeconds(targetSeconds);
}

function seekPlayerToSeconds(seconds) {
    state.playerCurrentTime = seconds;
    const fill = document.getElementById('player-progress-fill');
    const label = document.getElementById('player-current-time');

    if (fill) fill.style.width = `${(seconds / state.playerTotalDuration) * 100}%`;
    if (label) label.innerText = formatTimestampSeconds(seconds);

    highlightActiveTranscriptLine(seconds);
}

function highlightActiveTranscriptLine(currentTime) {
    const lines = [0, 10, 25, 45, 70, 110, 145, 170];
    
    // Find active line matching current timestamp
    let activeLineTs = 0;
    for (let i = 0; i < lines.length; i++) {
        if (currentTime >= lines[i]) {
            activeLineTs = lines[i];
        }
    }

    // Toggle highlighted classes
    document.querySelectorAll('.transcript-line').forEach(line => {
        line.classList.remove('highlight');
    });

    const activeRow = document.getElementById(`line-${activeLineTs}`);
    if (activeRow) {
        activeRow.classList.add('highlight');
        activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Transcript filtering search
function filterTranscript() {
    const input = document.getElementById('transcript-search-input');
    if (!input) return;

    const filter = input.value.toLowerCase();
    document.querySelectorAll('.transcript-line').forEach(line => {
        const text = line.querySelector('.line-text').innerText.toLowerCase();
        if (text.includes(filter)) {
            line.style.display = 'flex';
        } else {
            line.style.display = 'none';
        }
    });
}

// Helpers formats
function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

function formatTimestampSeconds(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
