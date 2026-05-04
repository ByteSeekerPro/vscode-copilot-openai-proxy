const vscode = acquireVsCodeApi();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const portInput              = document.getElementById('port');
const modelSelect            = document.getElementById('model');
const refreshModelsBtn       = document.getElementById('refreshModels');
const verboseLoggingCheckbox = document.getElementById('verboseLogging');
const toggleBtn              = document.getElementById('toggleBtn');
const statusDot              = document.getElementById('statusDot');
const statusText             = document.getElementById('statusText');

// ── State — initialized from data attributes stamped by the extension host  ───
// These are the single source of truth for validation; updated on user input.
let isRunning    = document.body.dataset.isRunning === 'true';
let currentPort  = parseInt(document.body.dataset.port  || '0', 10);
let currentModel = document.body.dataset.selectedModel  || '';

// ── Toggle button validation ──────────────────────────────────────────────────
// When stopped: Start requires both a valid port and a selected model.
// When running: Stop is always available.
function validateToggleBtn() {
    if (!toggleBtn) { return; }
    if (isRunning) {
        toggleBtn.removeAttribute('disabled');
        return;
    }
    const canStart = currentPort > 0 && currentModel !== '';
    if (canStart) {
        toggleBtn.removeAttribute('disabled');
    } else {
        toggleBtn.setAttribute('disabled', 'disabled');
    }
}

// ── Status update (called by 'statusUpdate' messages) ────────────────────────
function updateStatus(running) {
    isRunning = running;

    if (toggleBtn) {
        toggleBtn.textContent = running ? 'Stop Server' : 'Start Server';
        toggleBtn.setAttribute('appearance', running ? 'secondary' : 'primary');
    }
    if (statusDot) {
        statusDot.className = running ? 'status-dot running' : 'status-dot';
    }
    if (statusText) {
        statusText.textContent = running ? 'Running' : 'Stopped';
    }

    // Disable config inputs while the server is running
    const configInputs = [portInput, modelSelect, refreshModelsBtn, verboseLoggingCheckbox];
    for (const el of configInputs) {
        if (!el) { continue; }
        if (running) {
            el.setAttribute('disabled', 'disabled');
        } else {
            el.removeAttribute('disabled');
        }
    }

    validateToggleBtn();
}

// ── Model list update (called by 'models' messages) ───────────────────────────
// payload: { models: string[], selectedModel: string }
function updateModels({ models, selectedModel }) {
    if (!modelSelect) { return; }

    currentModel = selectedModel || '';

    modelSelect.innerHTML = '<vscode-option value="">Select a model...</vscode-option>';
    models.forEach(modelId => {
        const option = document.createElement('vscode-option');
        option.value = modelId;
        option.textContent = modelId;
        if (modelId === currentModel) {
            option.setAttribute('selected', 'selected');
        }
        modelSelect.appendChild(option);
    });

    validateToggleBtn();
}

// ── Messages from the extension host ─────────────────────────────────────────
window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
        case 'statusUpdate':
            updateStatus(message.payload.isRunning);
            break;
        case 'models':
            updateModels(message.payload);
            break;
        case 'error':
            console.error('[LM Bridge]', message.payload);
            break;
    }
});

// ── UI event listeners ────────────────────────────────────────────────────────
toggleBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: isRunning ? 'stop' : 'start' });
});

refreshModelsBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshModels' });
});

portInput?.addEventListener('change', (e) => {
    currentPort = parseInt(e.target.value, 10) || 0;
    vscode.postMessage({ type: 'updateState', payload: { port: currentPort } });
    validateToggleBtn();
});

modelSelect?.addEventListener('change', (e) => {
    currentModel = e.target.value || '';
    vscode.postMessage({ type: 'updateState', payload: { selectedModel: currentModel } });
    validateToggleBtn();
});

verboseLoggingCheckbox?.addEventListener('change', (e) => {
    vscode.postMessage({ type: 'updateState', payload: { verboseLogging: e.target.checked } });
});

// ── Initial validation ─────────────────────────────────────────────────────────
// Catches the case where the extension was reloaded with no model pre-selected.
validateToggleBtn();
