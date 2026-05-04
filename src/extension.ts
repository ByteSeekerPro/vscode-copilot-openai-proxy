import * as vscode from 'vscode';
import { LmBridge } from './lmBridge';
import { Server } from './server';
import { SidebarProvider } from './webview/provider';

interface State {
  port: number;
  verboseLogging: boolean;
  selectedModel: string;
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('LM API Bridge');
  context.subscriptions.push(outputChannel);

  const state: State = {
    port: context.workspaceState.get<number>('port', 9090),
    verboseLogging: context.workspaceState.get<boolean>('verboseLogging', false),
    selectedModel: context.workspaceState.get<string>('selectedModel', ''),
  };

  const lmBridge = new LmBridge(outputChannel);
  const server = new Server(lmBridge, outputChannel);
  
  const sidebarProvider = new SidebarProvider(context.extensionUri, state, server, lmBridge, outputChannel);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'vsc-lm-api-bridge-webview',
      sidebarProvider,
      // Retain the webview JS context across panel switches so the UI state
      // is preserved and statusUpdate messages can be received at any time.
      { webviewOptions: { retainContextWhenHidden: true } }
    )
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

  outputChannel.appendLine('LM API Bridge Activated');
}

export function deactivate() {
  // Any cleanup logic should be handled here
}
