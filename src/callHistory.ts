import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getCallHistoryRetentionDays } from './config';

/**
 * Metadata-only call history entry.
 *
 * No full request bodies, response bodies, prompts, completions,
 * or API keys are stored.
 */
export interface CallHistoryEntry {
  /** Unique identifier for this entry. */
  id: string;
  /** ISO 8601 timestamp when the request was received. */
  timestamp: string;
  /** HTTP method (GET, POST). */
  method: string;
  /** Endpoint path (e.g. /v1/models, /v1/chat/completions). */
  endpoint: string;
  /** Model name if available, otherwise null. */
  model: string | null;
  /** HTTP status code if available, otherwise null. */
  statusCode: number | null;
  /** Whether the request succeeded (status 2xx). */
  success: boolean;
  /** Latency in milliseconds if measured, otherwise null. */
  latencyMs: number | null;
  /** Whether the request used streaming, otherwise null. */
  streaming: boolean | null;
  /** Prompt token count if available, otherwise null. */
  promptTokens: number | null;
  /** Completion token count if available, otherwise null. */
  completionTokens: number | null;
  /** Total token count if available, otherwise null. */
  totalTokens: number | null;
  /** Short error message if the request failed, otherwise null. */
  error: string | null;
  /** Whether the request included image content parts, if detected. */
  imageInput?: boolean | null;
}

/** Filename for persisted call history in global storage. */
const HISTORY_FILENAME = 'call-history.json';

/** Hard cap on total stored entries to prevent unbounded growth. */
const MAX_ENTRIES = 1000;

/**
 * Manages persistent metadata-only call history storage
 * in VS Code global storage as a JSON file.
 */
export class CallHistoryStore {
  private filePath: string;

  constructor(
    context: vscode.ExtensionContext,
    private outputChannel: vscode.OutputChannel
  ) {
    this.filePath = path.join(context.globalStorageUri.fsPath, HISTORY_FILENAME);
  }

  /** Ensure the global storage directory exists. */
  async ensureStorageDir(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** Append a single entry to the history file. Non-fatal on error. */
  async append(entry: CallHistoryEntry): Promise<void> {
    try {
      await this.ensureStorageDir();

      const entries = await this.readRaw();
      entries.push(entry);

      // Cap entries
      while (entries.length > MAX_ENTRIES) {
        entries.shift();
      }

      fs.writeFileSync(this.filePath, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (err: any) {
      this.outputChannel.appendLine(
        `[CallHistory] Failed to write entry: ${err.message ?? err}`
      );
    }
  }

  /** Read all history entries, handling missing/corrupt files gracefully. */
  async read(): Promise<CallHistoryEntry[]> {
    try {
      const entries = await this.readRaw();
      return this.cleanupExpired(entries);
    } catch (err: any) {
      this.outputChannel.appendLine(
        `[CallHistory] Failed to read history: ${err.message ?? err}`
      );
      return [];
    }
  }

  /** Clear all history entries. */
  async clear(): Promise<void> {
    try {
      await this.ensureStorageDir();
      fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
    } catch (err: any) {
      this.outputChannel.appendLine(
        `[CallHistory] Failed to clear history: ${err.message ?? err}`
      );
    }
  }

  /**
   * Remove expired entries based on retention days.
   * Called before reading and after writing.
   */
  async cleanupExpiredEntries(): Promise<void> {
    try {
      const entries = await this.readRaw();
      const cleaned = this.cleanupExpired(entries);
      if (cleaned.length !== entries.length) {
        fs.writeFileSync(this.filePath, JSON.stringify(cleaned, null, 2), 'utf-8');
      }
    } catch (err: any) {
      this.outputChannel.appendLine(
        `[CallHistory] Failed to cleanup expired entries: ${err.message ?? err}`
      );
    }
  }

  // --- Private helpers ---

  /** Read entries from disk without cleanup. */
  private async readRaw(): Promise<CallHistoryEntry[]> {
    await this.ensureStorageDir();

    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const content = fs.readFileSync(this.filePath, 'utf-8');
    if (!content.trim()) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      this.outputChannel.appendLine(
        '[CallHistory] History file is corrupted. Starting with empty history.'
      );
      return [];
    }

    if (!Array.isArray(parsed)) {
      this.outputChannel.appendLine(
        '[CallHistory] History file has unexpected format. Starting with empty history.'
      );
      return [];
    }

    return parsed as CallHistoryEntry[];
  }

  /** Filter out entries older than the configured retention period. */
  private cleanupExpired(entries: CallHistoryEntry[]): CallHistoryEntry[] {
    const retentionDays = getCallHistoryRetentionDays();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    return entries.filter((e) => {
      const t = Date.parse(e.timestamp);
      return !isNaN(t) && t >= cutoff;
    });
  }
}
