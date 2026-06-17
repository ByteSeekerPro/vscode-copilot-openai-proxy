import * as vscode from 'vscode';
import * as os from 'os';

/** Extension configuration namespace matching package.json contributes.configuration. */
const SECTION = 'vscode-copilot-openai-proxy';

/** Default port used when the configured value is invalid or unset. */
export const DEFAULT_PORT = 9090;

/** Default host used when the configured value is invalid or unset. */
export const DEFAULT_HOST = '127.0.0.1';

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

// ---------------------------------------------------------------------------
// Host configuration
// ---------------------------------------------------------------------------

/** Regex pattern that matches valid IPv4 and IPv6 addresses, plus localhost. */
const HOST_PATTERN = /^(localhost|(\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+)$/;

/**
 * Validate a host string.
 *
 * Accepts `localhost`, valid IPv4 addresses, and valid IPv6 addresses.
 * Returns `true` if the value is a usable host string.
 */
export function isValidHost(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return HOST_PATTERN.test(trimmed);
}

/**
 * Get the effective server host from VS Code settings.
 *
 * Validates the value. Invalid values fall back to {@link DEFAULT_HOST}
 * and a warning is logged.
 */
export function getHost(): string {
  const config = vscode.workspace.getConfiguration(SECTION);
  const raw = config.get<string>('host', DEFAULT_HOST);

  if (!isValidHost(raw)) {
    vscode.window.showWarningMessage(
      `[Copilot OpenAI Proxy] Invalid host "${raw}". Falling back to default host ${DEFAULT_HOST}.`
    );
    return DEFAULT_HOST;
  }

  return raw.trim();
}

// ---------------------------------------------------------------------------
// API-key authentication configuration
// ---------------------------------------------------------------------------

/** Default requireApiKey value when the setting is missing. */
const DEFAULT_REQUIRE_API_KEY = false;

/**
 * Get whether API-key authentication is required for protected endpoints.
 */
export function getRequireApiKey(): boolean {
  const config = vscode.workspace.getConfiguration(SECTION);
  return config.get<boolean>('requireApiKey', DEFAULT_REQUIRE_API_KEY);
}

/**
 * Get the configured API key, trimmed.
 *
 * Returns empty string when unset. Never logs the value.
 */
export function getApiKey(): string {
  const config = vscode.workspace.getConfiguration(SECTION);
  const raw = config.get<string>('apiKey', '');
  return typeof raw === 'string' ? raw.trim() : '';
}

// ---------------------------------------------------------------------------
// Host classification
// ---------------------------------------------------------------------------

/** Local-only hosts that do not expose the bridge to the network. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Returns `true` when the given host is a local-only bind address.
 */
export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}

/**
 * Return the first non-internal IPv4 address found on this machine, or null.
 *
 * Safe — returns null if no suitable interface is found.
 */
export function getLanIPv4(): string | null {
  try {
    const interfaces = os.networkInterfaces();
    for (const entries of Object.values(interfaces)) {
      if (!entries) { continue; }
      for (const entry of entries) {
        if (entry.family === 'IPv4' && !entry.internal) {
          return entry.address;
        }
      }
    }
  } catch {
    // Non-fatal — LAN IP detection is best-effort.
  }
  return null;
}
