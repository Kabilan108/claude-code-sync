/**
 * Claude Code Sync Plugin
 *
 * Syncs Claude Code sessions to OpenSync dashboard.
 * Uses API Key authentication (no browser OAuth required).
 *
 * Install: npm install -g claude-code-sync
 * Configure: claude-code-sync login
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ============================================================================
// Types
// ============================================================================

export interface Config {
  convexUrl: string;
  apiKey: string;
  autoSync?: boolean;
  syncToolCalls?: boolean;
  syncThinking?: boolean;
}

export interface SessionData {
  sessionId: string;
  source: "claude-code";
  title?: string;
  projectPath?: string;
  projectName?: string;
  cwd?: string;
  gitBranch?: string;
  gitRepo?: string;
  model?: string;
  startType?: "new" | "resume" | "continue";
  endReason?: "user_stop" | "max_turns" | "error" | "completed" | "clear" | "logout" | "prompt_input_exit" | "other" | string;
  thinkingEnabled?: boolean;
  permissionMode?: string;
  mcpServers?: string[];
  messageCount?: number;
  toolCallCount?: number;
  tokenUsage?: {
    input: number;
    output: number;
  };
  costEstimate?: number;
  startedAt?: string;
  endedAt?: string;
}

// Message part type for tool calls and results
export interface MessagePart {
  type: "text" | "tool-call" | "tool-result";
  content: unknown;
}

export interface MessageData {
  sessionId: string;
  messageId: string;
  source: "claude-code";
  role: "user" | "assistant" | "system";
  content?: string;
  thinkingContent?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  parts?: MessagePart[];
  durationMs?: number;
  tokenCount?: number;
  timestamp?: string;
  model?: string;
}

export interface ToolUseData {
  sessionId: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  result?: string;
  success?: boolean;
  durationMs?: number;
  timestamp?: string;
}

// Claude Code Hook Types
export interface ClaudeCodeHooks {
  SessionStart?: (data: SessionStartEvent) => void | Promise<void>;
  UserPromptSubmit?: (data: UserPromptEvent) => void | Promise<void>;
  PostToolUse?: (data: ToolUseEvent) => void | Promise<void>;
  Stop?: (data: StopEvent) => void | Promise<void>;
  SessionEnd?: (data: SessionEndEvent) => void | Promise<void>;
}

// Actual Claude Code hook event interfaces (from documentation)
// Supports both new format (session_id, transcript_path) and legacy format (sessionId)
export interface SessionStartEvent {
  session_id: string;
  transcript_path: string;
  permission_mode: string;
  hook_event_name: "SessionStart";
  source: "startup" | "resume" | "clear" | "compact";
  // Legacy fields (may or may not be provided)
  sessionId?: string;
  cwd?: string;
  model?: string;
  startType?: "new" | "resume" | "continue";
  thinkingEnabled?: boolean;
  permissionMode?: string;
  mcpServers?: string[];
}

export interface UserPromptEvent {
  session_id: string;
  transcript_path: string;
  permission_mode: string;
  hook_event_name: "UserPromptSubmit";
  prompt?: string;
  // Legacy fields
  sessionId?: string;
  timestamp?: string;
}

export interface ToolUseEvent {
  session_id: string;
  transcript_path: string;
  tool_name: string;
  permission_mode: string;
  hook_event_name: "PostToolUse";
  // Legacy fields
  sessionId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: string;
  success?: boolean;
  durationMs?: number;
}

export interface StopEvent {
  session_id: string;
  transcript_path: string;
  permission_mode: string;
  hook_event_name: "Stop";
  stop_hook_active: boolean;
  // Legacy fields
  sessionId?: string;
  response?: string;
  tokenUsage?: { input: number; output: number };
  durationMs?: number;
  model?: string;
}

export interface SessionEndEvent {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: "SessionEnd";
  reason: "clear" | "logout" | "prompt_input_exit" | "other";
  // Legacy fields
  sessionId?: string;
  endReason?: string;
  messageCount?: number;
  toolCallCount?: number;
  totalTokenUsage?: { input: number; output: number };
  costEstimate?: number;
}

// ============================================================================
// Transcript Parsing
// ============================================================================

// Transcript entry types for parsing JSONL files
interface TranscriptEntry {
  type: string;
  message?: {
    model?: string;
    role?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    content?: unknown;
  };
  sessionId?: string;
  cwd?: string;
  slug?: string;
}

// Stats extracted from transcript
interface TranscriptStats {
  model: string | undefined;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
  title: string | undefined;
  cwd: string | undefined;
}

/**
 * Parse transcript file to extract model, token usage, and stats
 */
function parseTranscript(transcriptPath: string): TranscriptStats {
  const stats: TranscriptStats = {
    model: undefined,
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    messageCount: 0,
    toolCallCount: 0,
    title: undefined,
    cwd: undefined,
  };

  try {
    if (!fs.existsSync(transcriptPath)) {
      return stats;
    }

    const content = fs.readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n");

    for (const line of lines) {
      try {
        const entry: TranscriptEntry = JSON.parse(line);

        // Get cwd and title from first entry that has them
        if (!stats.cwd && entry.cwd) {
          stats.cwd = entry.cwd;
        }
        if (!stats.title && entry.slug) {
          stats.title = entry.slug;
        }

        // Count messages
        if (entry.type === "user") {
          stats.messageCount++;
        }

        // Extract model and tokens from assistant messages
        if (entry.type === "assistant" && entry.message) {
          if (entry.message.model && !stats.model) {
            stats.model = entry.message.model;
          }

          if (entry.message.usage) {
            const usage = entry.message.usage;
            stats.inputTokens += usage.input_tokens || 0;
            stats.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
            stats.cacheReadTokens += usage.cache_read_input_tokens || 0;
            stats.outputTokens += usage.output_tokens || 0;
          }
        }

        // Count tool uses
        if (entry.type === "assistant" && entry.message?.content) {
          const msgContent = entry.message.content;
          if (Array.isArray(msgContent)) {
            for (const part of msgContent) {
              if (part && typeof part === "object" && "type" in part && part.type === "tool_use") {
                stats.toolCallCount++;
              }
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (error) {
    console.error("[claude-code-sync] Error parsing transcript:", error);
  }

  return stats;
}

// ============================================================================
// Model Pricing & Cost Calculation
// ============================================================================

// Pricing per million tokens (USD) with cache pricing
// Source: https://www.anthropic.com/pricing
const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-opus-4-20250514": { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-opus-4-5-20251101": { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-3-5-sonnet-20241022": { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-3-opus-20240229": { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-3-5-haiku-20241022": { input: 0.80, output: 4.00, cacheWrite: 1.00, cacheRead: 0.08 },
};

/**
 * Calculate cost from model and token usage with proper cache pricing
 * Returns 0 if model is unknown or pricing not available
 */
function calculateCost(model: string | undefined, stats: TranscriptStats): number {
  if (!model) return 0;

  // Try exact match first
  let pricing = MODEL_PRICING[model];

  // Try partial match if exact match fails
  if (!pricing) {
    const matchingKey = Object.keys(MODEL_PRICING).find(k => model.includes(k) || k.includes(model));
    if (matchingKey) {
      pricing = MODEL_PRICING[matchingKey];
    }
  }

  if (!pricing) return 0;

  // Calculate cost with proper cache pricing
  const inputCost = stats.inputTokens * pricing.input;
  const cacheWriteCost = stats.cacheCreationTokens * pricing.cacheWrite;
  const cacheReadCost = stats.cacheReadTokens * pricing.cacheRead;
  const outputCost = stats.outputTokens * pricing.output;

  return (inputCost + cacheWriteCost + cacheReadCost + outputCost) / 1_000_000;
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), ".config", "claude-code-sync");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function loadConfig(): Config | null {
  // Check environment variables first
  const envUrl = process.env.CLAUDE_SYNC_CONVEX_URL;
  const envKey = process.env.CLAUDE_SYNC_API_KEY;

  if (envUrl && envKey) {
    return {
      convexUrl: normalizeConvexUrl(envUrl),
      apiKey: envKey,
      autoSync: process.env.CLAUDE_SYNC_AUTO_SYNC !== "false",
      syncToolCalls: process.env.CLAUDE_SYNC_TOOL_CALLS !== "false",
      syncThinking: process.env.CLAUDE_SYNC_THINKING === "true",
    };
  }

  // Fall back to config file
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      const config = JSON.parse(data) as Config;
      config.convexUrl = normalizeConvexUrl(config.convexUrl);
      return config;
    }
  } catch (error) {
    console.error("Error loading config:", error);
  }

  return null;
}

export function saveConfig(config: Config): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error("Error saving config:", error);
    throw error;
  }
}

export function clearConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  } catch (error) {
    console.error("Error clearing config:", error);
  }
}

function normalizeConvexUrl(url: string): string {
  // Convert .convex.cloud to .convex.site for API calls
  return url.replace(".convex.cloud", ".convex.site");
}

// ============================================================================
// Sync Client
// ============================================================================

export class SyncClient {
  private config: Config;
  private siteUrl: string;
  private sessionCache: Map<string, Partial<SessionData>> = new Map();

  constructor(config: Config) {
    this.config = config;
    // Normalize URL to .convex.site for HTTP endpoints
    // Supports both .convex.cloud and .convex.site input URLs
    this.siteUrl = config.convexUrl.replace(".convex.cloud", ".convex.site");
  }

  private async request(endpoint: string, data: unknown): Promise<unknown> {
    const url = `${this.siteUrl}${endpoint}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Sync failed: ${response.status} - ${text}`);
    }

    return response.json();
  }

  // Transform session data to backend format
  private transformSession(session: SessionData): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      externalId: session.sessionId,
      source: session.source,
    };
    
    // Only include fields that are defined
    if (session.title !== undefined) payload.title = session.title;
    if (session.projectPath || session.cwd) payload.projectPath = session.projectPath || session.cwd;
    if (session.projectName) payload.projectName = session.projectName;
    if (session.model) payload.model = session.model;
    if (session.tokenUsage?.input !== undefined) payload.promptTokens = session.tokenUsage.input;
    if (session.tokenUsage?.output !== undefined) payload.completionTokens = session.tokenUsage.output;
    if (session.costEstimate !== undefined) payload.cost = session.costEstimate;
    if (session.messageCount !== undefined) payload.messageCount = session.messageCount;
    if (session.toolCallCount !== undefined) payload.toolCallCount = session.toolCallCount;
    if (session.endReason) payload.endReason = session.endReason;
    
    // Calculate duration if both timestamps exist
    if (session.endedAt && session.startedAt) {
      payload.durationMs = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime();
    }
    
    return payload;
  }

  // Transform message data to backend format
  private transformMessage(message: MessageData): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      sessionExternalId: message.sessionId,
      externalId: message.messageId,
      role: message.role,
      source: message.source,
    };
    
    // Set textContent for user prompts and assistant responses
    if (message.content) {
      payload.textContent = message.content;
    } else if (message.toolResult && !message.toolName) {
      // Only use toolResult as textContent if no toolName (fallback)
      payload.textContent = message.toolResult;
    }
    
    // Include duration if available
    if (message.durationMs !== undefined) {
      payload.durationMs = message.durationMs;
    }
    
    // Include token count if available
    if (message.tokenCount !== undefined) {
      payload.promptTokens = message.tokenCount;
    }
    
    // Include model if available
    if (message.model) {
      payload.model = message.model;
    }
    
    // Tool use info stored in parts
    if (message.toolName) {
      payload.parts = [
        {
          type: "tool-call",
          content: {
            toolName: message.toolName,
            args: message.toolArgs,
          },
        },
      ];
      // Add tool result as separate part
      if (message.toolResult) {
        (payload.parts as Array<{ type: string; content: unknown }>).push({
          type: "tool-result",
          content: message.toolResult,
        });
      }
    }
    
    return payload;
  }

  async syncSession(session: SessionData): Promise<void> {
    try {
      const payload = this.transformSession(session);
      await this.request("/sync/session", payload);
    } catch (error) {
      console.error("Failed to sync session:", error);
      throw error;
    }
  }

  async syncMessage(message: MessageData): Promise<void> {
    try {
      const payload = this.transformMessage(message);
      await this.request("/sync/message", payload);
    } catch (error) {
      console.error("Failed to sync message:", error);
      throw error;
    }
  }

  async syncBatch(
    sessions: SessionData[],
    messages: MessageData[]
  ): Promise<void> {
    try {
      const transformedSessions = sessions.map((s) => this.transformSession(s));
      const transformedMessages = messages.map((m) => this.transformMessage(m));
      await this.request("/sync/batch", {
        sessions: transformedSessions,
        messages: transformedMessages,
      });
    } catch (error) {
      console.error("Failed to sync batch:", error);
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.siteUrl}/health`;
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }

  // Session state management
  getSessionState(sessionId: string): Partial<SessionData> {
    return this.sessionCache.get(sessionId) || {};
  }

  updateSessionState(
    sessionId: string,
    updates: Partial<SessionData>
  ): void {
    const current = this.sessionCache.get(sessionId) || {};
    this.sessionCache.set(sessionId, { ...current, ...updates });
  }

  clearSessionState(sessionId: string): void {
    this.sessionCache.delete(sessionId);
  }
}

// ============================================================================
// Plugin Export
// ============================================================================

/**
 * Claude Code Plugin Entry Point
 *
 * This function is called by Claude Code to register the plugin.
 * It returns hook handlers that fire at key points in the session lifecycle.
 */
export function createPlugin(): ClaudeCodeHooks | null {
  const config = loadConfig();

  if (!config) {
    console.log(
      "[claude-code-sync] Not configured. Run 'claude-code-sync login' to set up."
    );
    return null;
  }

  if (config.autoSync === false) {
    console.log("[claude-code-sync] Auto-sync disabled in config.");
    return null;
  }

  const client = new SyncClient(config);
  let messageCounter = 0;
  let toolCallCounter = 0;

  console.log("[claude-code-sync] Plugin loaded. Sessions will sync to OpenSync.");

  return {
    /**
     * Called when a new session starts
     */
    SessionStart: async (event: SessionStartEvent) => {
      messageCounter = 0;
      toolCallCounter = 0;

      // Use session_id (new) or sessionId (legacy)
      const sessionId = event.session_id || event.sessionId || "";
      const cwd = event.cwd;
      const permissionMode = event.permission_mode || event.permissionMode;

      const session: SessionData = {
        sessionId,
        source: "claude-code",
        cwd,
        model: event.model,
        startType: event.startType,
        thinkingEnabled: event.thinkingEnabled,
        permissionMode,
        mcpServers: event.mcpServers,
        startedAt: new Date().toISOString(),
      };

      // Extract project info from cwd
      if (cwd) {
        session.projectPath = cwd;
        session.projectName = path.basename(cwd);

        // Try to get git info
        try {
          const gitDir = path.join(cwd, ".git");
          if (fs.existsSync(gitDir)) {
            const headFile = path.join(gitDir, "HEAD");
            if (fs.existsSync(headFile)) {
              const head = fs.readFileSync(headFile, "utf-8").trim();
              if (head.startsWith("ref: refs/heads/")) {
                session.gitBranch = head.replace("ref: refs/heads/", "");
              }
            }
          }
        } catch {
          // Ignore git errors
        }
      }

      client.updateSessionState(sessionId, session);
      await client.syncSession(session);
    },

    /**
     * Called when user submits a prompt
     */
    UserPromptSubmit: async (event: UserPromptEvent) => {
      messageCounter++;
      const sessionId = event.session_id || event.sessionId || "";
      const prompt = event.prompt || "";

      const message: MessageData = {
        sessionId,
        messageId: `${sessionId}-msg-${messageCounter}`,
        source: "claude-code",
        role: "user",
        content: prompt,
        timestamp: event.timestamp || new Date().toISOString(),
      };

      await client.syncMessage(message);
    },

    /**
     * Called after each tool use
     */
    PostToolUse: async (event: ToolUseEvent) => {
      if (!config.syncToolCalls) return;

      toolCallCounter++;
      messageCounter++;
      const sessionId = event.session_id || event.sessionId || "";
      const toolName = event.tool_name || event.toolName || "unknown";

      const message: MessageData = {
        sessionId,
        messageId: `${sessionId}-tool-${toolCallCounter}`,
        source: "claude-code",
        role: "assistant",
        toolName,
        toolArgs: event.args,
        toolResult: event.result,
        durationMs: event.durationMs,
        timestamp: new Date().toISOString(),
      };

      await client.syncMessage(message);
    },

    /**
     * Called when Claude stops responding
     */
    Stop: async (event: StopEvent) => {
      const sessionId = event.session_id || event.sessionId || "";
      const tokenUsage = event.tokenUsage || { input: 0, output: 0 };

      // Only create message if we have response content
      if (event.response) {
        messageCounter++;

        const message: MessageData = {
          sessionId,
          messageId: `${sessionId}-msg-${messageCounter}`,
          source: "claude-code",
          role: "assistant",
          content: event.response,
          model: event.model,
          tokenCount: tokenUsage.input + tokenUsage.output,
          durationMs: event.durationMs,
          timestamp: new Date().toISOString(),
        };

        await client.syncMessage(message);
      }

      // Update session state with token usage
      if (tokenUsage.input > 0 || tokenUsage.output > 0) {
        const currentState = client.getSessionState(sessionId);
        const currentTokens = currentState.tokenUsage || { input: 0, output: 0 };
        client.updateSessionState(sessionId, {
          tokenUsage: {
            input: currentTokens.input + tokenUsage.input,
            output: currentTokens.output + tokenUsage.output,
          },
        });
      }
    },

    /**
     * Called when session ends
     */
    SessionEnd: async (event: SessionEndEvent) => {
      const sessionId = event.session_id || event.sessionId || "";
      const currentState = client.getSessionState(sessionId);
      const endReason = event.reason || event.endReason;

      const session: SessionData = {
        ...currentState,
        sessionId,
        source: "claude-code",
        cwd: event.cwd,
        projectPath: event.cwd,
        projectName: event.cwd ? path.basename(event.cwd) : undefined,
        endReason,
        messageCount: event.messageCount,
        toolCallCount: event.toolCallCount,
        tokenUsage: event.totalTokenUsage,
        costEstimate: event.costEstimate,
        endedAt: new Date().toISOString(),
      };

      await client.syncSession(session);
      client.clearSessionState(sessionId);

      console.log(
        `[claude-code-sync] Session synced: ${event.messageCount || 0} messages, ${event.toolCallCount || 0} tool calls`
      );
    },
  };
}

// Default export for Claude Code plugin system
export default createPlugin;
