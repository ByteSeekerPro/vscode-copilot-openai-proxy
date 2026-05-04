import * as vscode from 'vscode';
import { Server } from '../server';
import { LmBridge } from '../lmBridge';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _onStateChange = new vscode.EventEmitter<any>();
  public readonly onStateChange = this._onStateChange.event;
  
  private _isRefreshing = false;
  private _cachedModelIds: string[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private _state: any,
    private _server: Server,
    private _lmBridge: LmBridge,
    private _outputChannel: vscode.OutputChannel
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
        this._postStatusUpdate();
        if (this._cachedModelIds.length > 0) {
          this._view?.webview.postMessage({
            type: 'models',
            payload: { models: this._cachedModelIds, selectedModel: this._state.selectedModel },
          });
        }
      }
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'start':
          try {
            await this._server.start(this._state.port);
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
      }
    });
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
        return;
    }

    this._isRefreshing = true;
    try {
        this._outputChannel.appendLine('Discovering VS Code Language Models...');
        const startTime = Date.now();
        const models = await this._lmBridge.getModels();
        const duration = Date.now() - startTime;
        
        this._cachedModelIds = models.map(m => m.id);
        this._outputChannel.appendLine(`Found ${this._cachedModelIds.length} models in ${duration}ms.`);
        
        this._view?.webview.postMessage({
            type: 'models',
            payload: { models: this._cachedModelIds, selectedModel: this._state.selectedModel }
        });
    } catch (error: any) {
        this._outputChannel.appendLine(`Error refreshing models: ${error.message}`);
    } finally {
        this._isRefreshing = false;
    }
  }

  /** Post the current server running state to the webview. */
  private _postStatusUpdate() {
    this._view?.webview.postMessage({
      type: 'statusUpdate',
      payload: { isRunning: this._server.isStarted() },
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

    // Compute dynamic UI attributes
    const disabledAttr      = isRunning ? 'disabled="disabled"' : '';
    const buttonText        = isRunning ? 'Stop Server' : 'Start Server';
    const buttonApp         = isRunning ? 'secondary' : 'primary';
    const statusText        = isRunning ? 'Running' : 'Stopped';
    const statusDotClass    = isRunning ? 'status-dot running' : 'status-dot';
    // Start is gated on port + model being set; Stop is always available.
    const startDisabledAttr = (!isRunning && (!this._state.port || !this._state.selectedModel))
                              ? 'disabled="disabled"' : '';

    // Compute models — preserve selection
    const modelOptions = this._cachedModelIds.map(id =>
      `<vscode-option value="${id}" ${id === this._state.selectedModel ? 'selected' : ''}>${id}</vscode-option>`
    ).join('') || '<vscode-option value="">Select a model...</vscode-option>';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <link href="${codiconsUri}" rel="stylesheet">
        <script type="module" src="${toolkitUri}"></script>
        <title>LM API Bridge</title>
      </head>
      <body data-is-running="${isRunning}"
            data-port="${this._state.port || ''}"
            data-selected-model="${this._state.selectedModel || ''}">
        <div id="app">
          <div class="control-group">
            <vscode-label for="port">Local Proxy Port:</vscode-label>
            <vscode-textfield id="port" value="${this._state.port}" type="number" placeholder="9090" ${disabledAttr}></vscode-textfield>
          </div>
          <div class="control-group">
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
          <div class="control-group">
            <vscode-checkbox id="verboseLogging" ${this._state.verboseLogging ? 'checked' : ''} ${disabledAttr}>
              Enable Verbose Logging
            </vscode-checkbox>
          </div>

          <div class="status-section">
            <div class="status-info">
              <div id="statusDot" class="${statusDotClass}"></div>
              <div id="statusText" class="status-label">${statusText}</div>
            </div>
          </div>

          <div class="button-group">
            <vscode-button id="toggleBtn" appearance="${buttonApp}" ${startDisabledAttr}>${buttonText}</vscode-button>
          </div>
        </div>
        <script type="module" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }
}
