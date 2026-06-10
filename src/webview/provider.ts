import * as vscode from 'vscode';
import { Server } from '../server';
import { LmBridge } from '../lmBridge';
import { CallHistoryStore } from '../callHistory';
import { SessionMetricsStore, safeSerialize } from '../sessionMetrics';
import { getPort, getAutoStart } from '../config';

/** Serializable model metadata sent to the webview. */
interface ModelMetadata {
  id: string;
  name: string;
  vendor: string;
  family: string;
  version: string;
  maxInputTokens: number;
  /** Pricing extracted from raw model metadata, if available. */
  pricing?: {
    inputCost?: number;
    outputCost?: number;
    cacheCost?: number;
    priceCategory?: string;
    raw?: string;
  };
  /** Model capabilities extracted from raw metadata, if available. */
  capabilities?: {
    supportsImageToText?: boolean;
    supportsToolCalling?: boolean;
  };
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _onStateChange = new vscode.EventEmitter<any>();
  public readonly onStateChange = this._onStateChange.event;

  private _isRefreshing = false;
  private _cachedModelIds: string[] = [];
  private _cachedModels: vscode.LanguageModelChat[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private _state: any,
    private _server: Server,
    private _lmBridge: LmBridge,
    private _outputChannel: vscode.OutputChannel,
    private _callHistoryStore: CallHistoryStore,
    private _sessionMetricsStore: SessionMetricsStore
  ) {
    this._server.setVerbose(this._state.verboseLogging);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // When the panel re-appears after switching to another extension,
    // the server keeps running uninterrupted (it lives in the extension host).
    // We just need to re-sync the UI to the current state via messages.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._syncAllState();
      }
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'start':
          try {
            const port = getPort();
            await this._server.start(port);
          } catch (err: any) {
            this._outputChannel.appendLine(`Failed to start server: ${err.message}`);
            this._view?.webview.postMessage({ type: 'error', payload: err.message });
          }
          this._postStatusUpdate();
          break;
        case 'stop':
          try {
            await this._server.stop();
          } catch (err: any) {
            this._outputChannel.appendLine(`Failed to stop server: ${err.message}`);
            this._view?.webview.postMessage({ type: 'error', payload: err.message });
          }
          this._postStatusUpdate();
          break;
        case 'updateState':
          this._state = { ...this._state, ...data.payload };
          if (data.payload.verboseLogging !== undefined) {
            this._server.setVerbose(data.payload.verboseLogging);
          }
          this._onStateChange.fire(data.payload);
          break;
        case 'refreshModels':
          this._refreshModels(true);
          break;
        case 'selectModel':
          this._state.selectedModel = data.payload.selectedModel || 'auto';
          this._onStateChange.fire({ selectedModel: this._state.selectedModel });
          this._postModelMetadata();
          this._postRawModelMetadata();
          break;
        case 'refreshCallHistory':
          this._postCallHistory();
          break;
        case 'refreshMetrics':
          this._postSessionMetrics();
          break;
        case 'resetSessionMetrics':
          this._sessionMetricsStore.reset();
          this._postSessionMetrics();
          break;
        case 'copyRawMetadata':
          if (data.payload?.text) {
            await vscode.env.clipboard.writeText(data.payload.text);
          }
          break;
        case 'copyToClipboard':
          if (data.payload?.text) {
            await vscode.env.clipboard.writeText(data.payload.text);
          }
          break;
        case 'openSettings':
          vscode.commands.executeCommand('vscode-copilot-openai-proxy.openSettings');
          break;
        case 'showCallHistory':
          vscode.commands.executeCommand('vscode-copilot-openai-proxy.showCallHistory');
          break;
        case 'clearCallHistory':
          await vscode.commands.executeCommand('vscode-copilot-openai-proxy.clearCallHistory');
          this._postCallHistory();
          break;
      }
    });

    // Initial sync on resolve
    this._syncAllState();
  }

  /** Sync all state to the webview: status, models, metadata, call history, metrics. */
  private async _syncAllState() {
    this._postStatusUpdate();
    // Always send models list (includes 'auto'). If no real models discovered
    // yet, send just ['auto'] so the dropdown always has a valid default.
    const modelsToSend = this._cachedModelIds.length > 0
      ? this._cachedModelIds
      : ['auto'];
    this._view?.webview.postMessage({
      type: 'models',
      payload: { models: modelsToSend, selectedModel: this._state.selectedModel },
    });
    this._postModelMetadata();
    this._postRawModelMetadata();
    this._postCallHistory();
    this._postSessionMetrics();
  }

  private async _refreshModels(force = false) {
    if (this._isRefreshing) {
        return;
    }

    if (!force && this._cachedModelIds.length > 0) {
        this._view?.webview.postMessage({
            type: 'models',
            payload: { models: this._cachedModelIds, selectedModel: this._state.selectedModel }
        });
        this._postModelMetadata();
        this._postRawModelMetadata();
        return;
    }

    this._isRefreshing = true;
    try {
        this._outputChannel.appendLine('Discovering VS Code Language Models...');
        const startTime = Date.now();
        const models = await this._lmBridge.getModels();
        const duration = Date.now() - startTime;

        this._cachedModels = models;
        this._cachedModelIds = ['auto', ...models.map(m => m.id)];
        this._outputChannel.appendLine(`Found ${models.length} models in ${duration}ms.`);

        // If the stored selected model is no longer available, fall back to 'auto'.
        if (
          this._state.selectedModel &&
          this._state.selectedModel !== 'auto' &&
          !models.some(m => m.id === this._state.selectedModel)
        ) {
          this._outputChannel.appendLine(
            `Selected model "${this._state.selectedModel}" no longer available — falling back to auto.`
          );
          this._state.selectedModel = 'auto';
          this._onStateChange.fire({ selectedModel: 'auto' });
        }

        this._view?.webview.postMessage({
            type: 'models',
            payload: { models: this._cachedModelIds, selectedModel: this._state.selectedModel }
        });
        this._postModelMetadata();
        this._postRawModelMetadata();
    } catch (error: any) {
        this._outputChannel.appendLine(`Error refreshing models: ${error.message}`);
    } finally {
        this._isRefreshing = false;
    }
  }

  /** Extract serializable metadata from a LanguageModelChat object. */
  private _extractModelMetadata(model: vscode.LanguageModelChat): ModelMetadata {
    const metadata: ModelMetadata = {
      id: model.id,
      name: model.name,
      vendor: model.vendor,
      family: model.family,
      version: model.version,
      maxInputTokens: model.maxInputTokens,
    };

    // Extract pricing fields from raw model properties if present.
    // These may be added by VS Code's LM API for models that expose
    // cost metadata (e.g. AICs per million tokens).
    const raw = model as any;
    const pricing: ModelMetadata['pricing'] = {};
    let hasPricing = false;

    if (typeof raw.inputCost === 'number') {
      pricing.inputCost = raw.inputCost;
      hasPricing = true;
    }
    if (typeof raw.outputCost === 'number') {
      pricing.outputCost = raw.outputCost;
      hasPricing = true;
    }
    if (typeof raw.cacheCost === 'number') {
      pricing.cacheCost = raw.cacheCost;
      hasPricing = true;
    }
    if (typeof raw.priceCategory === 'string') {
      pricing.priceCategory = raw.priceCategory;
      hasPricing = true;
    }
    if (typeof raw.pricing === 'string') {
      pricing.raw = raw.pricing;
      hasPricing = true;
    }

    if (hasPricing) {
      metadata.pricing = pricing;
    }

    // Extract capability flags from raw model metadata.
    const caps = raw?.capabilities;
    if (caps && typeof caps === 'object') {
      const capabilities: ModelMetadata['capabilities'] = {};
      if (typeof caps.supportsImageToText === 'boolean') {
        capabilities.supportsImageToText = caps.supportsImageToText;
      }
      if (typeof caps.supportsToolCalling === 'boolean') {
        capabilities.supportsToolCalling = caps.supportsToolCalling;
      }
      if (capabilities.supportsImageToText !== undefined || capabilities.supportsToolCalling !== undefined) {
        metadata.capabilities = capabilities;
      }
    }

    return metadata;
  }

  /** Extract raw metadata from a LanguageModelChat by enumerating all own properties. */
  private _extractRawModelMetadata(model: vscode.LanguageModelChat): Record<string, unknown> {
    const raw: Record<string, unknown> = {};

    // Start with known fields
    raw.id = model.id;
    raw.name = model.name;
    raw.vendor = model.vendor;
    raw.family = model.family;
    raw.version = model.version;
    raw.maxInputTokens = model.maxInputTokens;

    // Enumerate additional own properties on the object
    try {
      for (const key of Object.getOwnPropertyNames(model)) {
        if (raw[key] !== undefined) { continue; }
        try {
          const value = (model as any)[key];
          raw[key] = safeSerialize(value);
        } catch {
          raw[key] = '[unreadable]';
        }
      }
    } catch {
      // If enumeration fails, at least return known fields
    }

    return raw;
  }

  /** Post model metadata for the currently selected model. */
  private _postModelMetadata() {
    if (!this._state.selectedModel) {
      this._view?.webview.postMessage({ type: 'modelMetadata', payload: null });
      return;
    }

    // 'auto' selection — send synthetic metadata so the sidebar never shows
    // a completely empty metadata section.
    if (this._state.selectedModel === 'auto') {
      this._view?.webview.postMessage({
        type: 'modelMetadata',
        payload: {
          id: 'auto',
          name: 'Auto',
          vendor: 'VS Code / GitHub Copilot',
          family: 'automatic',
          version: '',
          maxInputTokens: 0,
          isAuto: true,
        },
      });
      return;
    }

    if (this._cachedModels.length === 0) {
      this._view?.webview.postMessage({ type: 'modelMetadata', payload: null });
      return;
    }
    const model = this._cachedModels.find(m => m.id === this._state.selectedModel);
    if (model) {
      const metadata = this._extractModelMetadata(model);
      this._view?.webview.postMessage({ type: 'modelMetadata', payload: metadata });
    } else {
      this._view?.webview.postMessage({ type: 'modelMetadata', payload: null });
    }
  }

  /** Post raw model metadata for the currently selected model. */
  private _postRawModelMetadata() {
    if (!this._state.selectedModel) {
      this._view?.webview.postMessage({ type: 'rawModelMetadata', payload: null });
      return;
    }

    // 'auto' selection — send a synthetic raw metadata note.
    if (this._state.selectedModel === 'auto') {
      this._view?.webview.postMessage({
        type: 'rawModelMetadata',
        payload: {
          id: 'auto',
          name: 'Auto',
          description: 'Automatically selected by VS Code / GitHub Copilot.',
          note: 'Uses automatic model selection where supported. The first available model is used at request time.',
        },
      });
      return;
    }

    if (this._cachedModels.length === 0) {
      this._view?.webview.postMessage({ type: 'rawModelMetadata', payload: null });
      return;
    }
    const model = this._cachedModels.find(m => m.id === this._state.selectedModel);
    if (model) {
      const raw = this._extractRawModelMetadata(model);
      this._view?.webview.postMessage({ type: 'rawModelMetadata', payload: raw });
    } else {
      this._view?.webview.postMessage({ type: 'rawModelMetadata', payload: null });
    }
  }

  /** Post current session metrics to the webview. */
  private _postSessionMetrics() {
    const snapshot = this._sessionMetricsStore.getSnapshot();
    this._view?.webview.postMessage({ type: 'sessionMetrics', payload: snapshot });
  }

  /** Post the most recent call history entries to the webview. */
  private async _postCallHistory() {
    try {
      const entries = await this._callHistoryStore.read();
      const sorted = [...entries].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      const recent = sorted.slice(0, 10);
      this._view?.webview.postMessage({ type: 'callHistory', payload: { entries: recent } });
    } catch (err: any) {
      this._outputChannel.appendLine(`Failed to post call history: ${err.message}`);
    }
  }

  /** Post the current server running state and config to the webview. */
  private _postStatusUpdate() {
    const port = getPort();
    const autoStart = getAutoStart();
    this._view?.webview.postMessage({
      type: 'statusUpdate',
      payload: {
        isRunning: this._server.isStarted(),
        port,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        autoStart,
        verboseLogging: this._state.verboseLogging,
      },
    });
  }

  /** Escape HTML special characters for safe embedding in HTML strings. */
  private _esc(value: string | undefined | null): string {
    if (value == null) { return ''; }
    return String(value).replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&': return '\x26amp;';
        case '<': return '\x26lt;';
        case '>': return '\x26gt;';
        case '"': return '\x26quot;';
        case "'": return '\x26apos;';
        default: return ch;
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'style.css')
    );
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
    );
    const toolkitUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode-elements/elements', 'dist', 'bundled.js')
    );

    const isRunning = this._server.isStarted();
    const port = getPort();
    const autoStart = getAutoStart();
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    const modelsUrl = `http://127.0.0.1:${port}/v1/models`;
    const curlCmd = `curl http://127.0.0.1:${port}/v1/models`;

    const statusText = isRunning ? 'RUNNING' : 'STOPPED';
    const statusDotClass = isRunning ? 'status-dot running' : 'status-dot';
    const buttonText = isRunning ? 'Stop Server' : 'Start Server';
    const buttonApp = isRunning ? 'secondary' : 'primary';
    const startDisabledAttr = (!isRunning && !this._state.selectedModel)
                              ? 'disabled="disabled"' : '';
    const disabledAttr = isRunning ? 'disabled="disabled"' : '';
    const autoStartLabel = autoStart ? 'Enabled' : 'Disabled';

    // Always include 'auto' as the first option. If real models have been
    // discovered they follow; otherwise only 'auto' is shown.
    const modelIds = this._cachedModelIds.length > 0
      ? this._cachedModelIds
      : ['auto'];
    const modelOptions = modelIds.map(id => {
      const label = id === 'auto' ? 'Auto' : this._esc(id);
      return `<vscode-option value="${this._esc(id)}" ${id === this._state.selectedModel ? 'selected' : ''}>${label}</vscode-option>`;
    }).join('');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <link href="${codiconsUri}" rel="stylesheet">
        <script type="module" src="${toolkitUri}"></script>
        <title>Copilot OpenAI Proxy</title>
      </head>
      <body data-is-running="${isRunning}"
            data-port="${port}"
            data-base-url="${this._esc(baseUrl)}"
            data-models-url="${this._esc(modelsUrl)}"
            data-curl-cmd="${this._esc(curlCmd)}"
            data-selected-model="${this._esc(this._state.selectedModel)}"
            data-auto-start="${autoStart}">

        <!-- Status Section -->
        <div class="section status-section">
          <div class="status-header">
            <div id="statusDot" class="${statusDotClass}"></div>
            <span id="statusText" class="status-label">${statusText}</span>
          </div>
          <div class="status-details">
            <div class="detail-row">
              <span class="detail-label">Port</span>
              <span id="detailPort" class="detail-value">${port}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Base URL</span>
              <span id="detailBaseUrl" class="detail-value url-value">${this._esc(baseUrl)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Autostart</span>
              <span id="detailAutostart" class="detail-value">${autoStartLabel}</span>
            </div>
          </div>
        </div>

        <!-- Server URL with copy -->
        <div class="section url-section">
          <div class="url-display">
            <code id="serverUrl">${this._esc(baseUrl)}</code>
            <vscode-button id="copyUrl" appearance="icon" title="Copy Base URL">
              <span class="codicon codicon-copy"></span>
            </vscode-button>
          </div>
          <p class="hint">Change the port in extension settings.</p>
        </div>

        <!-- Model Selection -->
        <div class="section">
          <vscode-label for="model">Active Language Model:</vscode-label>
          <div class="row">
            <vscode-single-select id="model" ${disabledAttr}>
                ${modelOptions}
            </vscode-single-select>
            <vscode-button id="refreshModels" appearance="icon" title="Refresh Model List" ${disabledAttr}>
              <span class="codicon codicon-refresh"></span>
            </vscode-button>
          </div>
        </div>

        <!-- Model Metadata -->
        <div id="modelMetadataSection" class="section metadata-section" style="display:none;">
          <vscode-label>Model Metadata</vscode-label>
          <div class="metadata-grid">
            <div class="meta-row"><span class="meta-label">ID</span><span id="metaId" class="meta-value"></span></div>
            <div class="meta-row"><span class="meta-label">Name</span><span id="metaName" class="meta-value"></span></div>
            <div class="meta-row"><span class="meta-label">Vendor</span><span id="metaVendor" class="meta-value"></span></div>
            <div class="meta-row"><span class="meta-label">Family</span><span id="metaFamily" class="meta-value"></span></div>
            <div class="meta-row"><span class="meta-label">Version</span><span id="metaVersion" class="meta-value"></span></div>
            <div class="meta-row"><span class="meta-label">Max Input Tokens</span><span id="metaMaxTokens" class="meta-value"></span></div>
            <div id="pricingNoData" class="meta-row"><span class="meta-label">Pricing</span><span class="meta-value">Not provided by available model metadata</span></div>
            <div id="pricingInputCost" class="meta-row" style="display:none;"><span class="meta-label">Input cost</span><span id="metaInputCost" class="meta-value"></span></div>
            <div id="pricingCacheCost" class="meta-row" style="display:none;"><span class="meta-label">Cached input cost</span><span id="metaCacheCost" class="meta-value"></span></div>
            <div id="pricingOutputCost" class="meta-row" style="display:none;"><span class="meta-label">Output cost</span><span id="metaOutputCost" class="meta-value"></span></div>
            <div id="pricingCategory" class="meta-row" style="display:none;"><span class="meta-label">Price category</span><span id="metaPriceCategory" class="meta-value"></span></div>
            <div id="pricingRaw" class="meta-row" style="display:none;"><span class="meta-label">Pricing (raw)</span><span id="metaPricingRaw" class="meta-value"></span></div>
            <div id="capImageInput" class="meta-row" style="display:none;"><span class="meta-label">Image input</span><span id="metaCapImageInput" class="meta-value"></span></div>
            <div id="capToolCalling" class="meta-row" style="display:none;"><span class="meta-label">Tool calling</span><span id="metaCapToolCalling" class="meta-value"></span></div>
          </div>
        </div>

        <!-- Raw Model Metadata -->
        <div id="rawMetadataSection" class="section metadata-section raw-metadata-section" style="display:none;">
          <div class="section-header">
            <vscode-label>Raw Model Metadata</vscode-label>
            <div class="section-header-actions">
              <vscode-button id="copyRawMetadata" appearance="icon" title="Copy Raw Metadata">
                <span class="codicon codicon-copy"></span>
              </vscode-button>
              <vscode-button id="toggleRawMetadata" appearance="icon" title="Collapse/Expand">
                <span id="rawMetaToggleIcon" class="codicon codicon-chevron-down"></span>
              </vscode-button>
            </div>
          </div>
          <div id="rawMetadataContent">
            <pre id="rawMetadataJson" class="raw-metadata-json"></pre>
          </div>
        </div>
        <div id="rawMetadataNoModel" class="section" style="display:none;">
          <p class="empty-state">Select a model to inspect raw metadata.</p>
        </div>

        <!-- Verbose Logging -->
        <div class="section">
          <vscode-checkbox id="verboseLogging" ${this._state.verboseLogging ? 'checked' : ''} ${disabledAttr}>
            Enable Verbose Logging
          </vscode-checkbox>
        </div>

        <!-- Action Buttons -->
        <div class="section button-group">
          <vscode-button id="toggleBtn" appearance="${buttonApp}" ${startDisabledAttr}>${buttonText}</vscode-button>
          <vscode-button id="openSettings" appearance="secondary">
            <span class="codicon codicon-settings-gear"></span>&nbsp;Open Settings
          </vscode-button>
        </div>

        <!-- Quick Copy Helpers -->
        <div class="section copy-section">
          <vscode-label>Quick Copy</vscode-label>
          <div class="copy-row">
            <span class="copy-label" id="copyBaseUrlLabel">${this._esc(baseUrl)}</span>
            <vscode-button id="copyBaseUrl" appearance="icon" title="Copy Base URL">
              <span class="codicon codicon-copy"></span>
            </vscode-button>
          </div>
          <div class="copy-row">
            <span class="copy-label" id="copyModelsUrlLabel">${this._esc(modelsUrl)}</span>
            <vscode-button id="copyModelsUrl" appearance="icon" title="Copy Models URL">
              <span class="codicon codicon-copy"></span>
            </vscode-button>
          </div>
          <div class="copy-row">
            <span class="copy-label" id="copyCurlLabel">curl ${this._esc(modelsUrl)}</span>
            <vscode-button id="copyCurl" appearance="icon" title="Copy cURL Command">
              <span class="codicon codicon-copy"></span>
            </vscode-button>
          </div>
        </div>

        <!-- Current Session Metrics -->
        <div class="section call-history-section">
          <div class="section-header">
            <vscode-label>Current Session Metrics</vscode-label>
            <vscode-button id="refreshMetrics" appearance="icon" title="Refresh Metrics">
              <span class="codicon codicon-refresh"></span>
            </vscode-button>
          </div>
          <div id="sessionMetricsContent" class="session-metrics-content">
            <div class="metadata-grid">
              <div class="meta-row"><span class="meta-label">Session started</span><span id="mSessionStarted" class="meta-value">—</span></div>
              <div class="meta-row"><span class="meta-label">Server status</span><span id="mServerStatus" class="meta-value">—</span></div>
              <div class="meta-row"><span class="meta-label">Active model</span><span id="mActiveModel" class="meta-value">—</span></div>
              <div class="meta-row"><span class="meta-label">Total requests</span><span id="mTotalReqs" class="meta-value">0</span></div>
              <div class="meta-row"><span class="meta-label">Successful</span><span id="mSuccessReqs" class="meta-value">0</span></div>
              <div class="meta-row"><span class="meta-label">Failed</span><span id="mFailedReqs" class="meta-value">0</span></div>
              <div class="meta-row"><span class="meta-label">GET /v1/models</span><span id="mModelsReqs" class="meta-value">0</span></div>
              <div class="meta-row"><span class="meta-label">POST /v1/chat/completions</span><span id="mChatReqs" class="meta-value">0</span></div>
              <div class="meta-row"><span class="meta-label">Streaming</span><span id="mStreamingReqs" class="meta-value">0</span></div>
              <div class="meta-row"><span class="meta-label">Non-streaming</span><span id="mNonStreamingReqs" class="meta-value">0</span></div>
              <div class="meta-row"><span class="meta-label">Prompt tokens</span><span id="mPromptTokens" class="meta-value">0</span></div>
              <div class="meta-row"><span class="meta-label">Completion tokens</span><span id="mCompletionTokens" class="meta-value">0</span></div>
              <div class="meta-row"><span class="meta-label">Total tokens</span><span id="mTotalTokens" class="meta-value">0</span></div>
              <div class="meta-row"><span class="meta-label">Avg latency</span><span id="mAvgLatency" class="meta-value">0ms</span></div>
              <div class="meta-row"><span class="meta-label">Last request</span><span id="mLastRequest" class="meta-value">—</span></div>
              <div class="meta-row"><span class="meta-label">Last model</span><span id="mLastModel" class="meta-value">—</span></div>
              <div class="meta-row"><span class="meta-label">Last error</span><span id="mLastError" class="meta-value">None</span></div>
            </div>
          </div>
          <div id="perModelMetricsSection" style="display:none;">
            <vscode-label style="margin-top:8px;">Per-Model Metrics</vscode-label>
            <div id="perModelMetricsList" class="per-model-metrics-list"></div>
          </div>
          <div class="button-row" style="margin-top:8px;">
            <vscode-button id="resetMetrics" appearance="secondary" class="small-btn">Reset Session Metrics</vscode-button>
          </div>
        </div>

        <!-- Recent Calls -->
        <div class="section call-history-section">
          <div class="section-header">
            <vscode-label>Recent Calls</vscode-label>
            <vscode-button id="refreshCallHistory" appearance="icon" title="Refresh Call History">
              <span class="codicon codicon-refresh"></span>
            </vscode-button>
          </div>
          <div id="callHistoryList" class="call-history-list">
            <p class="empty-state">No recent calls.</p>
          </div>
          <div class="button-row">
            <vscode-button id="showFullHistory" appearance="secondary" class="small-btn">Show Full History</vscode-button>
            <vscode-button id="clearHistory" appearance="secondary" class="small-btn">Clear History</vscode-button>
          </div>
        </div>

        <script type="module" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }
}
