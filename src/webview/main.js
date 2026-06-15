const vscode = acquireVsCodeApi();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const modelSelect            = document.getElementById('model');
const refreshModelsBtn       = document.getElementById('refreshModels');
const verboseLoggingCheckbox = document.getElementById('verboseLogging');
const toggleBtn              = document.getElementById('toggleBtn');
const statusDot              = document.getElementById('statusDot');
const statusText             = document.getElementById('statusText');

// Status detail elements
const detailPort             = document.getElementById('detailPort');
const detailBaseUrl          = document.getElementById('detailBaseUrl');
const detailAutostart        = document.getElementById('detailAutostart');

// URL display
const serverUrl              = document.getElementById('serverUrl');
const copyUrlBtn             = document.getElementById('copyUrl');

// Settings
const openSettingsBtn        = document.getElementById('openSettings');

// Quick copy buttons
const copyBaseUrlBtn         = document.getElementById('copyBaseUrl');
const copyModelsUrlBtn       = document.getElementById('copyModelsUrl');
const copyCurlBtn            = document.getElementById('copyCurl');

// Model metadata
const modelMetadataSection   = document.getElementById('modelMetadataSection');
const metaId                 = document.getElementById('metaId');
const metaName               = document.getElementById('metaName');
const metaVendor             = document.getElementById('metaVendor');
const metaFamily             = document.getElementById('metaFamily');
const metaVersion            = document.getElementById('metaVersion');
const metaMaxTokens          = document.getElementById('metaMaxTokens');

// Pricing elements
const pricingNoData          = document.getElementById('pricingNoData');
const pricingInputCost       = document.getElementById('pricingInputCost');
const pricingCacheCost       = document.getElementById('pricingCacheCost');
const pricingOutputCost      = document.getElementById('pricingOutputCost');
const pricingCategory        = document.getElementById('pricingCategory');
const pricingRaw             = document.getElementById('pricingRaw');
const metaInputCost          = document.getElementById('metaInputCost');
const metaCacheCost          = document.getElementById('metaCacheCost');
const metaOutputCost         = document.getElementById('metaOutputCost');
const metaPriceCategory      = document.getElementById('metaPriceCategory');
const metaPricingRaw         = document.getElementById('metaPricingRaw');

// Capability elements
const capImageInput          = document.getElementById('capImageInput');
const metaCapImageInput      = document.getElementById('metaCapImageInput');
const capToolCalling         = document.getElementById('capToolCalling');
const metaCapToolCalling     = document.getElementById('metaCapToolCalling');

// Raw metadata
const rawMetadataSection     = document.getElementById('rawMetadataSection');
const rawMetadataNoModel     = document.getElementById('rawMetadataNoModel');
const rawMetadataJson        = document.getElementById('rawMetadataJson');
const rawMetadataContent     = document.getElementById('rawMetadataContent');
const copyRawMetadataBtn     = document.getElementById('copyRawMetadata');
const toggleRawMetadataBtn   = document.getElementById('toggleRawMetadata');
const rawMetaToggleIcon      = document.getElementById('rawMetaToggleIcon');

// Session metrics
const mSessionStarted        = document.getElementById('mSessionStarted');
const mServerStatus          = document.getElementById('mServerStatus');
const mActiveModel           = document.getElementById('mActiveModel');
const mTotalReqs             = document.getElementById('mTotalReqs');
const mSuccessReqs           = document.getElementById('mSuccessReqs');
const mFailedReqs            = document.getElementById('mFailedReqs');
const mModelsReqs            = document.getElementById('mModelsReqs');
const mChatReqs              = document.getElementById('mChatReqs');
const mStreamingReqs         = document.getElementById('mStreamingReqs');
const mNonStreamingReqs      = document.getElementById('mNonStreamingReqs');
const mPromptTokens          = document.getElementById('mPromptTokens');
const mCompletionTokens      = document.getElementById('mCompletionTokens');
const mTotalTokens           = document.getElementById('mTotalTokens');
const mAvgLatency            = document.getElementById('mAvgLatency');
const mLastRequest           = document.getElementById('mLastRequest');
const mLastModel             = document.getElementById('mLastModel');
const mLastError             = document.getElementById('mLastError');
const refreshMetricsBtn      = document.getElementById('refreshMetrics');
const resetMetricsBtn        = document.getElementById('resetMetrics');
const perModelMetricsSection = document.getElementById('perModelMetricsSection');
const perModelMetricsList    = document.getElementById('perModelMetricsList');

// Cost elements
const costSection            = document.getElementById('costSection');
const mInputCost             = document.getElementById('mInputCost');
const mOutputCost            = document.getElementById('mOutputCost');
const mTotalCost             = document.getElementById('mTotalCost');
const costNoteRow            = document.getElementById('costNoteRow');
const mCostSource            = document.getElementById('mCostSource');
const costUnavailable        = document.getElementById('costUnavailable');

// Call history
const callHistoryList        = document.getElementById('callHistoryList');
const refreshCallHistoryBtn  = document.getElementById('refreshCallHistory');
const showFullHistoryBtn     = document.getElementById('showFullHistory');
const clearHistoryBtn        = document.getElementById('clearHistory');

// ── State — initialized from data attributes stamped by the extension host  ───
let isRunning    = document.body.dataset.isRunning === 'true';
let currentModel = document.body.dataset.selectedModel  || 'auto';
let baseUrl      = document.body.dataset.baseUrl  || '';
let modelsUrl    = document.body.dataset.modelsUrl || '';
let curlCmd      = document.body.dataset.curlCmd   || '';

// Raw metadata collapsed state
let rawMetaCollapsed = false;
// Store raw metadata text for copy
let rawMetadataText = '';

// ── Toggle button validation ──────────────────────────────────────────────────
function validateToggleBtn() {
    if (!toggleBtn) { return; }
    if (isRunning) {
        toggleBtn.removeAttribute('disabled');
        return;
    }
    const canStart = currentModel !== '';
    if (canStart) {
        toggleBtn.removeAttribute('disabled');
    } else {
        toggleBtn.setAttribute('disabled', 'disabled');
    }
}

// ── Status update (called by 'statusUpdate' messages) ────────────────────────
function updateStatus(payload) {
    isRunning = payload.isRunning;

    // Update status indicator
    if (toggleBtn) {
        toggleBtn.textContent = isRunning ? 'Stop Server' : 'Start Server';
        toggleBtn.setAttribute('appearance', isRunning ? 'secondary' : 'primary');
    }
    if (statusDot) {
        statusDot.className = isRunning ? 'status-dot running' : 'status-dot';
    }
    if (statusText) {
        statusText.textContent = isRunning ? 'RUNNING' : 'STOPPED';
    }

    // Update status details
    if (detailPort && payload.port != null) {
        detailPort.textContent = payload.port;
    }
    if (detailBaseUrl && payload.baseUrl) {
        detailBaseUrl.textContent = payload.baseUrl;
    }
    if (detailAutostart) {
        detailAutostart.textContent = payload.autoStart ? 'Enabled' : 'Disabled';
    }

    // Update URL displays
    if (payload.baseUrl) {
        baseUrl = payload.baseUrl;
        modelsUrl = baseUrl.replace('/v1', '/v1/models');
        curlCmd = 'curl ' + modelsUrl;

        if (serverUrl) { serverUrl.textContent = baseUrl; }

        const copyBaseUrlLabel = document.getElementById('copyBaseUrlLabel');
        const copyModelsUrlLabel = document.getElementById('copyModelsUrlLabel');
        const copyCurlLabel = document.getElementById('copyCurlLabel');
        if (copyBaseUrlLabel) { copyBaseUrlLabel.textContent = baseUrl; }
        if (copyModelsUrlLabel) { copyModelsUrlLabel.textContent = modelsUrl; }
        if (copyCurlLabel) { copyCurlLabel.textContent = curlCmd; }
    }

    // Update server status in metrics
    if (mServerStatus) {
        mServerStatus.textContent = isRunning ? 'Running' : 'Stopped';
    }

    // Disable config inputs while the server is running
    const configInputs = [modelSelect, refreshModelsBtn, verboseLoggingCheckbox];
    for (const el of configInputs) {
        if (!el) { continue; }
        if (isRunning) {
            el.setAttribute('disabled', 'disabled');
        } else {
            el.removeAttribute('disabled');
        }
    }

    validateToggleBtn();
}

// ── Model list update (called by 'models' messages) ───────────────────────────
function updateModels({ models, selectedModel }) {
    if (!modelSelect) { return; }

    currentModel = selectedModel || 'auto';

    modelSelect.innerHTML = '';
    models.forEach(modelId => {
        const option = document.createElement('vscode-option');
        option.value = modelId;
        option.textContent = modelId === 'auto' ? 'Auto' : modelId;
        if (modelId === currentModel) {
            option.setAttribute('selected', 'selected');
        }
        modelSelect.appendChild(option);
    });

    // Update active model in metrics
    if (mActiveModel) {
        mActiveModel.textContent = currentModel === 'auto' ? 'Auto' : (currentModel || '\u2014');
    }

    validateToggleBtn();
}

// ── Model metadata update (called by 'modelMetadata' messages) ────────────────
function updateModelMetadata(metadata) {
    if (!modelMetadataSection) { return; }

    if (!metadata) {
        modelMetadataSection.style.display = 'none';
        return;
    }

    modelMetadataSection.style.display = '';
    if (metaId) { metaId.textContent = metadata.id || '\u2014'; }
    if (metaName) { metaName.textContent = metadata.name || '\u2014'; }
    if (metaVendor) { metaVendor.textContent = metadata.vendor || '\u2014'; }
    if (metaFamily) { metaFamily.textContent = metadata.family || '\u2014'; }
    if (metaVersion) { metaVersion.textContent = metadata.version || '\u2014'; }
    if (metaMaxTokens) {
        // For 'auto', show a descriptive note instead of a misleading number.
        if (metadata.isAuto) {
            metaMaxTokens.textContent = 'Uses automatic model selection where supported.';
        } else {
            metaMaxTokens.textContent = metadata.maxInputTokens != null
                ? metadata.maxInputTokens.toLocaleString()
                : '\u2014';
        }
    }

    // Pricing display — only show rows when raw model metadata provides pricing fields.
    // For 'auto' selection, hide all pricing to avoid misleading information.
    const pricing = metadata.pricing;
    const hasPricing = !metadata.isAuto && pricing && (
        typeof pricing.inputCost === 'number' ||
        typeof pricing.outputCost === 'number' ||
        typeof pricing.cacheCost === 'number' ||
        typeof pricing.priceCategory === 'string' ||
        typeof pricing.raw === 'string'
    );

    if (pricingNoData) { pricingNoData.style.display = (hasPricing || metadata.isAuto) ? 'none' : ''; }
    if (pricingInputCost) {
        if (hasPricing && typeof pricing.inputCost === 'number') {
            pricingInputCost.style.display = '';
            if (metaInputCost) { metaInputCost.textContent = pricing.inputCost + ' AICs/1M tokens'; }
        } else {
            pricingInputCost.style.display = 'none';
        }
    }
    if (pricingCacheCost) {
        if (hasPricing && typeof pricing.cacheCost === 'number') {
            pricingCacheCost.style.display = '';
            if (metaCacheCost) { metaCacheCost.textContent = pricing.cacheCost + ' AICs/1M tokens'; }
        } else {
            pricingCacheCost.style.display = 'none';
        }
    }
    if (pricingOutputCost) {
        if (hasPricing && typeof pricing.outputCost === 'number') {
            pricingOutputCost.style.display = '';
            if (metaOutputCost) { metaOutputCost.textContent = pricing.outputCost + ' AICs/1M tokens'; }
        } else {
            pricingOutputCost.style.display = 'none';
        }
    }
    if (pricingCategory) {
        if (hasPricing && typeof pricing.priceCategory === 'string') {
            pricingCategory.style.display = '';
            if (metaPriceCategory) { metaPriceCategory.textContent = pricing.priceCategory; }
        } else {
            pricingCategory.style.display = 'none';
        }
    }
    if (pricingRaw) {
        if (hasPricing && typeof pricing.raw === 'string') {
            pricingRaw.style.display = '';
            if (metaPricingRaw) { metaPricingRaw.textContent = pricing.raw; }
        } else {
            pricingRaw.style.display = 'none';
        }
    }

    // Capability display — hide for 'auto' since the actual model is unknown.
    const caps = metadata.capabilities;
    if (capImageInput && metaCapImageInput) {
        if (metadata.isAuto) {
            capImageInput.style.display = 'none';
        } else if (caps && typeof caps.supportsImageToText === 'boolean') {
            capImageInput.style.display = '';
            metaCapImageInput.textContent = caps.supportsImageToText ? 'Supported' : 'Not supported';
            metaCapImageInput.style.color = caps.supportsImageToText
                ? 'var(--vscode-charts-green)'
                : 'var(--vscode-charts-red)';
        } else {
            capImageInput.style.display = 'none';
        }
    }
    if (capToolCalling && metaCapToolCalling) {
        if (metadata.isAuto) {
            capToolCalling.style.display = 'none';
        } else if (caps && typeof caps.supportsToolCalling === 'boolean') {
            capToolCalling.style.display = '';
            metaCapToolCalling.textContent = caps.supportsToolCalling ? 'Supported' : 'Not supported';
            metaCapToolCalling.style.color = caps.supportsToolCalling
                ? 'var(--vscode-charts-green)'
                : 'var(--vscode-charts-red)';
        } else {
            capToolCalling.style.display = 'none';
        }
    }
}

// ── Raw model metadata update (called by 'rawModelMetadata' messages) ─────────
function updateRawModelMetadata(rawData) {
    if (!rawMetadataSection || !rawMetadataNoModel) { return; }

    if (!rawData) {
        rawMetadataSection.style.display = 'none';
        rawMetadataNoModel.style.display = currentModel ? 'none' : '';
        return;
    }

    rawMetadataSection.style.display = '';
    rawMetadataNoModel.style.display = 'none';

    try {
        rawMetadataText = JSON.stringify(rawData, null, 2);
        if (rawMetadataJson) {
            rawMetadataJson.textContent = rawMetadataText;
        }
    } catch {
        rawMetadataText = String(rawData);
        if (rawMetadataJson) {
            rawMetadataJson.textContent = rawMetadataText;
        }
    }

    // Apply collapsed state
    if (rawMetadataContent) {
        rawMetadataContent.style.display = rawMetaCollapsed ? 'none' : '';
    }
    if (rawMetaToggleIcon) {
        rawMetaToggleIcon.className = rawMetaCollapsed
            ? 'codicon codicon-chevron-right'
            : 'codicon codicon-chevron-down';
    }
}

// ── Session metrics update (called by 'sessionMetrics' messages) ──────────────
function updateSessionMetrics(metrics) {
    if (!metrics) { return; }

    if (mSessionStarted) {
        mSessionStarted.textContent = formatTimestamp(metrics.sessionStarted) || '\u2014';
    }
    if (mTotalReqs) { mTotalReqs.textContent = metrics.totalRequests; }
    if (mSuccessReqs) { mSuccessReqs.textContent = metrics.successfulRequests; }
    if (mFailedReqs) { mFailedReqs.textContent = metrics.failedRequests; }
    if (mModelsReqs) { mModelsReqs.textContent = metrics.modelsEndpointCount; }
    if (mChatReqs) { mChatReqs.textContent = metrics.chatCompletionsEndpointCount; }
    if (mStreamingReqs) { mStreamingReqs.textContent = metrics.streamingRequestCount; }
    if (mNonStreamingReqs) { mNonStreamingReqs.textContent = metrics.nonStreamingRequestCount; }
    if (mPromptTokens) {
        mPromptTokens.textContent = metrics.totalPromptTokens > 0
            ? metrics.totalPromptTokens.toLocaleString()
            : 'Unknown';
    }
    if (mCompletionTokens) {
        mCompletionTokens.textContent = metrics.totalCompletionTokens > 0
            ? metrics.totalCompletionTokens.toLocaleString()
            : 'Unknown';
    }
    if (mTotalTokens) {
        mTotalTokens.textContent = metrics.totalTokens > 0
            ? metrics.totalTokens.toLocaleString()
            : 'Unknown';
    }
    if (mAvgLatency) {
        mAvgLatency.textContent = metrics.averageLatencyMs > 0
            ? metrics.averageLatencyMs + 'ms'
            : '\u2014';
    }
    if (mLastRequest) {
        mLastRequest.textContent = metrics.lastRequestTimestamp
            ? formatTimestamp(metrics.lastRequestTimestamp)
            : '\u2014';
    }
    if (mLastModel) {
        // Show effective model with requested model annotation when they differ.
        var effectiveModel = metrics.lastEffectiveModel || metrics.lastUsedModel;
        var requestedModel = metrics.lastRequestedModel;
        if (effectiveModel && requestedModel && effectiveModel !== requestedModel) {
            mLastModel.textContent = effectiveModel + ' (requested: ' + requestedModel + ')';
        } else if (effectiveModel) {
            mLastModel.textContent = effectiveModel;
        } else {
            mLastModel.textContent = metrics.lastUsedModel || '\u2014';
        }
    }
    if (mLastError) {
        mLastError.textContent = metrics.lastErrorSummary || 'None';
        mLastError.style.color = metrics.lastErrorSummary
            ? 'var(--vscode-charts-red)'
            : '';
    }

    // Session cost display
    var hasAnyCost = metrics.totalEstimatedCostUsd > 0;
    var hasAnyUnknown = metrics.unknownPricingRequests > 0;

    if (costSection) {
        costSection.style.display = (hasAnyCost) ? '' : 'none';
    }
    if (hasAnyCost) {
        if (mInputCost) { mInputCost.textContent = formatCost(metrics.totalInputCostUsd); }
        if (mOutputCost) { mOutputCost.textContent = formatCost(metrics.totalOutputCostUsd); }
        if (mTotalCost) { mTotalCost.textContent = formatCost(metrics.totalEstimatedCostUsd); }
    }
    if (costNoteRow && mCostSource) {
        if (metrics.lastPricingModel) {
            costNoteRow.style.display = '';
            mCostSource.textContent = metrics.lastPricingModel + ' metadata';
        } else {
            costNoteRow.style.display = 'none';
        }
    }
    if (costUnavailable) {
        // Show "not available" only if there are unknown-price requests AND no cost data at all
        costUnavailable.style.display = (!hasAnyCost && hasAnyUnknown) ? '' : 'none';
    }

    // Per-model breakdown
    if (metrics.modelMetrics && metrics.modelMetrics.length > 0 && perModelMetricsSection && perModelMetricsList) {
        perModelMetricsSection.style.display = '';
        perModelMetricsList.innerHTML = metrics.modelMetrics.map(mm => {
            const avgLat = mm.latencyCount > 0 ? Math.round(mm.latencySum / mm.latencyCount) : 0;
            const promptTok = mm.promptTokens > 0 ? mm.promptTokens.toLocaleString() : 'Unknown';
            const compTok = mm.completionTokens > 0 ? mm.completionTokens.toLocaleString() : 'Unknown';
            const totalTok = mm.totalTokens > 0 ? mm.totalTokens.toLocaleString() : 'Unknown';

            var rateLine = '';
            if (mm.inputUsdPer1M != null && mm.outputUsdPer1M != null) {
                rateLine = '<div class="per-model-rate">Rate: $' +
                    mm.inputUsdPer1M.toFixed(2) + ' input / $' +
                    mm.outputUsdPer1M.toFixed(2) + ' output per 1M tokens</div>';
            }

            var costLine = '';
            if (mm.totalCostUsd > 0) {
                costLine = '<div class="per-model-cost">Estimated cost: ' + formatCost(mm.totalCostUsd) + '</div>';
            } else if (mm.unknownPricingRequests > 0) {
                costLine = '<div class="per-model-cost per-model-cost-unknown">Cost: pricing unavailable</div>';
            }

            // Show "requested as: auto" when the effective model differs from the request.
            var requestedAsLine = '';
            if (mm.requestedAs && mm.requestedAs.length > 0) {
                var differs = mm.requestedAs.some(function(r) { return r !== mm.modelId; });
                if (differs) {
                    requestedAsLine = '<div class="per-model-requested-as">requested as: ' +
                        escapeHtml(mm.requestedAs.join(', ')) + '</div>';
                }
            }

            return '<div class="per-model-entry">' +
                '<div class="per-model-header">' +
                    '<span class="per-model-name">' + escapeHtml(mm.modelId) + '</span>' +
                    '<span class="per-model-reqs">' + mm.requestCount + ' req' + (mm.requestCount !== 1 ? 's' : '') + '</span>' +
                '</div>' +
                '<div class="per-model-details">' +
                    '<span>ok: ' + mm.successCount + '</span>' +
                    ' \u00b7 <span>fail: ' + mm.failureCount + '</span>' +
                    ' \u00b7 <span>tokens: ' + promptTok + '/' + compTok + '/' + totalTok + '</span>' +
                    ' \u00b7 <span>avg: ' + avgLat + 'ms</span>' +
                '</div>' +
                requestedAsLine +
                rateLine +
                costLine +
            '</div>';
        }).join('');
    } else if (perModelMetricsSection) {
        perModelMetricsSection.style.display = 'none';
    }
}

// ── Call history update (called by 'callHistory' messages) ────────────────────
function updateCallHistory(data) {
    if (!callHistoryList) { return; }

    const entries = data.entries || [];
    if (entries.length === 0) {
        callHistoryList.innerHTML = '<p class="empty-state">No recent calls.</p>';
        return;
    }

    callHistoryList.innerHTML = entries.map(entry => {
        const time = entry.timestamp ? formatTimestamp(entry.timestamp) : '\u2014';
        const endpoint = entry.endpoint || '\u2014';
        const statusLabel = entry.success
            ? '<span class="call-ok">OK</span>'
            : '<span class="call-fail">FAIL</span>';
        const latency = entry.latencyMs != null ? entry.latencyMs + 'ms' : '\u2014';
        const streaming = entry.streaming != null ? (entry.streaming ? 'yes' : 'no') : '\u2014';
        const tokens = (entry.promptTokens != null || entry.completionTokens != null)
            ? (entry.promptTokens ?? '-') + '/' + (entry.completionTokens ?? '-')
            : '';
        const errorPart = entry.error ? '<div class="call-error">' + escapeHtml(truncate(entry.error, 60)) + '</div>' : '';
        const imagePart = entry.imageInput ? ' \u00b7 <span>image: yes</span>' : '';

        // Model display: show effective model with requested model annotation.
        const effectiveModel = entry.effectiveModel || entry.model;
        const requestedModel = entry.requestedModel || entry.model;
        var modelDisplay = '';
        if (effectiveModel && requestedModel && effectiveModel !== requestedModel) {
            modelDisplay = escapeHtml(effectiveModel) + ' <span class="call-model-requested">(requested: ' + escapeHtml(requestedModel) + ')</span>';
        } else {
            modelDisplay = escapeHtml(effectiveModel || entry.model || '\u2014');
        }

        // Cost display for recent calls
        var costPart = '';
        if (entry.pricingAvailable === true && entry.estimatedTotalCostUsd != null && entry.estimatedTotalCostUsd > 0) {
            costPart = ' \u00b7 <span class="call-cost">cost: ' + formatCost(entry.estimatedTotalCostUsd) + '</span>';
        } else if (entry.pricingAvailable === false) {
            costPart = ' \u00b7 <span class="call-cost-unknown">cost: unknown</span>';
        }

        return '<div class="call-entry">' +
            '<div class="call-header">' +
                '<span class="call-endpoint">' + escapeHtml(endpoint) + '</span>' +
                ' ' + statusLabel +
                ' <span class="call-latency">' + escapeHtml(latency) + '</span>' +
            '</div>' +
            '<div class="call-details">' +
                '<span>' + escapeHtml(time) + '</span>' +
                ' \u00b7 <span>model: ' + modelDisplay + '</span>' +
                ' \u00b7 <span>stream: ' + escapeHtml(streaming) + '</span>' +
                (tokens ? ' \u00b7 <span>tokens: ' + escapeHtml(tokens) + '</span>' : '') +
                imagePart +
                costPart +
            '</div>' +
            errorPart +
        '</div>';
    }).join('');
}

function formatTimestamp(iso) {
    try {
        const d = new Date(iso);
        const pad = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } catch {
        return iso;
    }
}

function truncate(str, max) {
    if (!str) { return ''; }
    return str.length > max ? str.slice(0, max) + '...' : str;
}

function escapeHtml(str) {
    if (!str) { return ''; }
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Format a USD cost value for display.
 * Uses 6 decimals for very small values, 4 for < $1, 2 for >= $1.
 */
function formatCost(amount) {
    if (amount === 0) { return '$0.00'; }
    if (amount < 0.01) { return '$' + amount.toFixed(6); }
    if (amount < 1) { return '$' + amount.toFixed(4); }
    return '$' + amount.toFixed(2);
}

// ── Messages from the extension host ─────────────────────────────────────────
window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
        case 'statusUpdate':
            updateStatus(message.payload);
            break;
        case 'models':
            updateModels(message.payload);
            break;
        case 'modelMetadata':
            updateModelMetadata(message.payload);
            break;
        case 'rawModelMetadata':
            updateRawModelMetadata(message.payload);
            break;
        case 'sessionMetrics':
            updateSessionMetrics(message.payload);
            break;
        case 'callHistory':
            updateCallHistory(message.payload);
            break;
        case 'error':
            console.error('[Copilot OpenAI Proxy]', message.payload);
            break;
    }
});

// ── UI event listeners ────────────────────────────────────────────────────────

// Start/Stop
toggleBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: isRunning ? 'stop' : 'start' });
});

// Refresh models
refreshModelsBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshModels' });
});

// Model selection
modelSelect?.addEventListener('change', (e) => {
    currentModel = e.target.value || '';
    vscode.postMessage({ type: 'selectModel', payload: { selectedModel: currentModel } });
    validateToggleBtn();
});

// Verbose logging
verboseLoggingCheckbox?.addEventListener('change', (e) => {
    vscode.postMessage({ type: 'updateState', payload: { verboseLogging: e.target.checked } });
});

// Copy base URL (header copy button)
copyUrlBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyToClipboard', payload: { text: baseUrl } });
});

// Open settings
openSettingsBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettings' });
});

// Quick copy buttons
copyBaseUrlBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyToClipboard', payload: { text: baseUrl } });
});

copyModelsUrlBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyToClipboard', payload: { text: modelsUrl } });
});

copyCurlBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyToClipboard', payload: { text: curlCmd } });
});

// Copy raw metadata
copyRawMetadataBtn?.addEventListener('click', () => {
    if (rawMetadataText) {
        vscode.postMessage({ type: 'copyRawMetadata', payload: { text: rawMetadataText } });
    }
});

// Toggle raw metadata collapse/expand
toggleRawMetadataBtn?.addEventListener('click', () => {
    rawMetaCollapsed = !rawMetaCollapsed;
    if (rawMetadataContent) {
        rawMetadataContent.style.display = rawMetaCollapsed ? 'none' : '';
    }
    if (rawMetaToggleIcon) {
        rawMetaToggleIcon.className = rawMetaCollapsed
            ? 'codicon codicon-chevron-right'
            : 'codicon codicon-chevron-down';
    }
});

// Refresh metrics
refreshMetricsBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshMetrics' });
});

// Reset metrics
resetMetricsBtn?.addEventListener('click', () => {
    if (confirm('Reset all current session metrics? This will not affect persistent call history.')) {
        vscode.postMessage({ type: 'resetSessionMetrics' });
    }
});

// Call history buttons
refreshCallHistoryBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshCallHistory' });
});

showFullHistoryBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'showCallHistory' });
});

clearHistoryBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearCallHistory' });
});

// ── Initial validation ─────────────────────────────────────────────────────────
validateToggleBtn();
