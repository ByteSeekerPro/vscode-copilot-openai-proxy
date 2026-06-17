import * as vscode from 'vscode';

/** Extension configuration namespace matching package.json contributes.configuration. */
const SECTION = 'vscode-copilot-openai-proxy';

/** Default port used when the configured value is invalid or unset. */
export const DEFAULT_PORT = 9090;

/** Default call-history retention in days. */
export const DEFAULT_RETENTION_DAYS = 10;

/** Allowed values for the tool choice policy setting. */
export type ToolChoicePolicy = 'bestEffort' | 'strictPreflight' | 'strictAfterResponse';

/** Default tool choice policy when the setting is missing or invalid. */
export const DEFAULT_TOOL_CHOICE_POLICY: ToolChoicePolicy = 'bestEffort';

/** All valid tool choice policy values. */
const VALID_TOOL_CHOICE_POLICIES: ReadonlySet<string> = new Set<ToolChoicePolicy>([
  'bestEffort',
  'strictPreflight',
  'strictAfterResponse',
]);

/**
 * Get the effective server port from VS Code settings.
 *
 * Validates the range 1–65535. Invalid values fall back to {@link DEFAULT_PORT}
 * and a warning is logged.
 */
export function getPort(): number {
  const config = vscode.workspace.getConfiguration(SECTION);
  const raw = config.get<number>('port', DEFAULT_PORT);

  if (!Number.isInteger(raw) || raw < 1 || raw > 65535) {
    vscode.window.showWarningMessage(
      `[Copilot OpenAI Proxy] Invalid port "${raw}". Falling back to default port ${DEFAULT_PORT}.`
    );
    return DEFAULT_PORT;
  }

  return raw;
}

/**
 * Get the configured call-history retention days.
 *
 * Valid values are positive integers. Invalid values fall back to
 * {@link DEFAULT_RETENTION_DAYS} and a warning is logged.
 */
export function getCallHistoryRetentionDays(): number {
  const config = vscode.workspace.getConfiguration(SECTION);
  const raw = config.get<number>('callHistoryRetentionDays', DEFAULT_RETENTION_DAYS);

  if (!Number.isInteger(raw) || raw < 1) {
    vscode.window.showWarningMessage(
      `[Copilot OpenAI Proxy] Invalid callHistoryRetentionDays "${raw}". Falling back to ${DEFAULT_RETENTION_DAYS}.`
    );
    return DEFAULT_RETENTION_DAYS;
  }

  return raw;
}

/**
 * Whether the proxy server should start automatically on extension activation.
 */
export function getAutoStart(): boolean {
  const config = vscode.workspace.getConfiguration(SECTION);
  return config.get<boolean>('autoStart', true);
}

/**
 * Get the configured tool choice policy.
 *
 * Returns one of "bestEffort", "strictPreflight", or "strictAfterResponse".
 * Invalid values fall back to {@link DEFAULT_TOOL_CHOICE_POLICY} without throwing.
 */
export function getToolChoicePolicy(): ToolChoicePolicy {
  const config = vscode.workspace.getConfiguration(SECTION);
  const raw = config.get<string>('toolChoicePolicy', DEFAULT_TOOL_CHOICE_POLICY);

  if (typeof raw === 'string' && VALID_TOOL_CHOICE_POLICIES.has(raw)) {
    return raw as ToolChoicePolicy;
  }

  return DEFAULT_TOOL_CHOICE_POLICY;
}
