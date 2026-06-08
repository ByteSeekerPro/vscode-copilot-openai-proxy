import * as vscode from 'vscode';
import { LmBridge } from './lmBridge';
import { Server } from './server';
import { SidebarProvider } from './webview/provider';
import { getPort, getAutoStart } from './config';
import { CallHistoryStore } from './callHistory';

interface State {
  port: number;
  verboseLogging: boolean;
  selectedModel: string;
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Copilot OpenAI Proxy');
  context.subscriptions.push(outputChannel);

  // Read the effective port from configuration (validated with fallback).
  const effectivePort = getPort();

  const state: State = {
    port: context.workspaceState.get<number>('port', effectivePort),
    verboseLogging: context.workspaceState.get<boolean>('verboseLogging', false),
    selectedModel: context.workspaceState.get<string>('selectedModel', ''),
  };

  const lmBridge = new LmBridge(outputChannel);
  const callHistoryStore = new CallHistoryStore(context, outputChannel);
  const server = new Server(lmBridge, outputChannel, callHistoryStore);

  const sidebarProvider = new SidebarProvider(context.extensionUri, state, server, lmBridge, outputChannel);

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

  // Ensure the HTTP server is stopped when the extension is deactivated
  // (e.g. VS Code closes) so the port is always released cleanly.
  context.subscriptions.push({
    dispose: () => { server.stop().catch(() => {}); },
  });

  // Sync state changes back to workspaceState
  sidebarProvider.onStateChange((newState: Partial<State>) => {
    if (newState.port !== undefined) {
      context.workspaceState.update('port', newState.port);
    }
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

  outputChannel.appendLine('Copilot OpenAI Proxy Activated');
}

export function deactivate() {
  // Any cleanup logic should be handled here
}
