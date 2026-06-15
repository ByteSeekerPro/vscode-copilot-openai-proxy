import * as vscode from 'vscode';
import { LmBridge } from './lmBridge';
import { Server } from './server';
import { SidebarProvider } from './webview/provider';
import { getPort, getAutoStart } from './config';
import { CallHistoryStore } from './callHistory';
import { SessionMetricsStore } from './sessionMetrics';
import { formatCostUsd } from './pricing';

interface State {
  port: number;
  verboseLogging: boolean;
  selectedModel: string;
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Copilot OpenAI Proxy');
  context.subscriptions.push(outputChannel);

  // Read the effective port from configuration (validated with fallback).
  // Port is always config-driven; no sidebar editing of port.
  const effectivePort = getPort();

  const state: State = {
    port: effectivePort,
    verboseLogging: context.workspaceState.get<boolean>('verboseLogging', false),
    selectedModel: context.workspaceState.get<string>('selectedModel', 'auto'),
  };

  const lmBridge = new LmBridge(outputChannel);
  const callHistoryStore = new CallHistoryStore(context, outputChannel);
  const sessionMetricsStore = new SessionMetricsStore();
  const server = new Server(lmBridge, outputChannel, callHistoryStore, sessionMetricsStore);

  const sidebarProvider = new SidebarProvider(
    context.extensionUri, state, server, lmBridge, outputChannel, callHistoryStore, sessionMetricsStore
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'vscode-copilot-openai-proxy-webview',
      sidebarProvider,
      // Retain the webview JS context across panel switches so the UI state
      // is preserved and statusUpdate messages can be received at any time.
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Register the openSettings command.
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-copilot-openai-proxy.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ByteSeekerPro.vscode-copilot-openai-proxy');
    })
  );

  // Cleanup expired call history entries on activation.
  callHistoryStore.cleanupExpiredEntries().catch((err) => {
    outputChannel.appendLine(`[CallHistory] Startup cleanup failed: ${err.message ?? err}`);
  });

  // Register the showCallHistory command.
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-copilot-openai-proxy.showCallHistory', async () => {
      const entries = await callHistoryStore.read();
      const sorted = [...entries].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

      const channel = vscode.window.createOutputChannel('Copilot OpenAI Proxy — Call History');
      if (sorted.length === 0) {
        channel.appendLine('No call history recorded.');
      } else {
        channel.appendLine(`Call History (${sorted.length} entries, newest first):`);
        channel.appendLine('');
        for (const e of sorted) {
          const line = [
            `${e.timestamp}`,
            `${e.method} ${e.endpoint}`,
            e.model ? `model=${e.model}` : '',
            e.statusCode != null ? `status=${e.statusCode}` : '',
            e.success ? 'OK' : 'FAILED',
            e.latencyMs != null ? `${e.latencyMs}ms` : '',
            e.streaming != null ? (e.streaming ? 'streaming' : 'non-streaming') : '',
            e.promptTokens != null || e.completionTokens != null || e.totalTokens != null
              ? `tokens=[${e.promptTokens ?? '-'}/${e.completionTokens ?? '-'}/${e.totalTokens ?? '-'}]`
              : '',
            e.error ? `error="${e.error}"` : '',
          ].filter(Boolean).join('  ');
          channel.appendLine(line);
        }
      }
      channel.show();
    })
  );

  // Register the clearCallHistory command.
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-copilot-openai-proxy.clearCallHistory', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Are you sure you want to clear the Copilot OpenAI Proxy call history?',
        'Clear',
        'Cancel'
      );
      if (confirm === 'Clear') {
        await callHistoryStore.clear();
        vscode.window.showInformationMessage('Copilot OpenAI Proxy call history cleared.');
      }
    })
  );

  // Register the showSessionMetrics command.
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-copilot-openai-proxy.showSessionMetrics', () => {
      const snapshot = sessionMetricsStore.getSnapshot();
      const channel = vscode.window.createOutputChannel('Copilot OpenAI Proxy — Session Metrics');
      channel.appendLine('=== Current Session Metrics ===');
      channel.appendLine('');
      channel.appendLine(`Session started: ${snapshot.sessionStarted}`);
      channel.appendLine(`Total requests: ${snapshot.totalRequests}`);
      channel.appendLine(`Successful: ${snapshot.successfulRequests}`);
      channel.appendLine(`Failed: ${snapshot.failedRequests}`);
      channel.appendLine(`GET /v1/models: ${snapshot.modelsEndpointCount}`);
      channel.appendLine(`POST /v1/chat/completions: ${snapshot.chatCompletionsEndpointCount}`);
      channel.appendLine(`Streaming: ${snapshot.streamingRequestCount}`);
      channel.appendLine(`Non-streaming: ${snapshot.nonStreamingRequestCount}`);
      channel.appendLine(`Total prompt tokens: ${snapshot.totalPromptTokens}`);
      channel.appendLine(`Total completion tokens: ${snapshot.totalCompletionTokens}`);
      channel.appendLine(`Total tokens: ${snapshot.totalTokens}`);
      channel.appendLine(`Average latency: ${snapshot.averageLatencyMs}ms`);
      channel.appendLine(`Last request: ${snapshot.lastRequestTimestamp ?? 'None'}`);
      channel.appendLine(`Last model: ${snapshot.lastUsedModel ?? 'None'}`);
      if (snapshot.lastErrorSummary) {
        channel.appendLine(`Last error: ${snapshot.lastErrorSummary}`);
      }
      // Cost summary
      if (snapshot.totalEstimatedCostUsd > 0) {
        channel.appendLine('');
        channel.appendLine('--- Cost Estimate ---');
        channel.appendLine(`Estimated input cost: ${formatCostUsd(snapshot.totalInputCostUsd)}`);
        channel.appendLine(`Estimated output cost: ${formatCostUsd(snapshot.totalOutputCostUsd)}`);
        channel.appendLine(`Estimated total cost: ${formatCostUsd(snapshot.totalEstimatedCostUsd)}`);
        if (snapshot.lastPricingModel) {
          channel.appendLine(`Pricing source: ${snapshot.lastPricingModel} metadata`);
        }
      } else if (snapshot.unknownPricingRequests > 0) {
        channel.appendLine('');
        channel.appendLine('Estimated cost: Not available (pricing metadata not available for used model)');
      }
      if (snapshot.modelMetrics.length > 0) {
        channel.appendLine('');
        channel.appendLine('--- Per-Model Metrics ---');
        for (const mm of snapshot.modelMetrics) {
          const avgLat = mm.latencyCount > 0 ? Math.round(mm.latencySum / mm.latencyCount) : 0;
          let line = `  ${mm.modelId}: reqs=${mm.requestCount} ok=${mm.successCount} fail=${mm.failureCount} prompt_tokens=${mm.promptTokens} completion_tokens=${mm.completionTokens} total_tokens=${mm.totalTokens} avg_latency=${avgLat}ms`;
          if (mm.totalCostUsd > 0) {
            line += ` estimated_cost=${formatCostUsd(mm.totalCostUsd)}`;
          } else if (mm.unknownPricingRequests > 0) {
            line += ' estimated_cost=N/A';
          }
          if (mm.inputUsdPer1M != null && mm.outputUsdPer1M != null) {
            line += ` rate=$${mm.inputUsdPer1M.toFixed(2)}/$${mm.outputUsdPer1M.toFixed(2)} per 1M`;
          }
          channel.appendLine(line);
        }
      }
      channel.appendLine('');
      channel.appendLine('Note: Cost estimates are derived from model metadata. They are estimates only.');
      channel.show();
    })
  );

  // Ensure the HTTP server is stopped when the extension is deactivated
  // (e.g. VS Code closes) so the port is always released cleanly.
  context.subscriptions.push({
    dispose: () => { server.stop().catch(() => {}); },
  });

  // Sync state changes back to workspaceState (port is no longer persisted here)
  sidebarProvider.onStateChange((newState: Partial<State>) => {
    if (newState.verboseLogging !== undefined) {
      context.workspaceState.update('verboseLogging', newState.verboseLogging);
    }
    if (newState.selectedModel !== undefined) {
      context.workspaceState.update('selectedModel', newState.selectedModel);
    }
  });

  // Autostart: start the server automatically if autoStart is enabled.
  if (getAutoStart()) {
    outputChannel.appendLine('Auto-start enabled — starting server…');
    server.start(effectivePort).catch((err) => {
      outputChannel.appendLine(`Auto-start failed: ${err.message ?? err}`);
    });
  }

  // Load models eagerly during activation so the sidebar has model data,
  // selected model, and metadata available immediately — even before the
  // sidebar panel is opened for the first time.
  sidebarProvider.loadModels().catch((err) => {
    outputChannel.appendLine(`Model loading failed: ${err.message ?? err}`);
  });

  outputChannel.appendLine('Copilot OpenAI Proxy Activated');
}

export function deactivate() {
  // Any cleanup logic should be handled here
}
