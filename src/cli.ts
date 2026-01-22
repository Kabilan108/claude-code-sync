#!/usr/bin/env node

/**
 * Claude Code Sync CLI
 *
 * Commands:
 *   login   - Configure Convex URL and API Key
 *   logout  - Clear stored credentials
 *   status  - Show connection status
 *   config  - Show current configuration
 */

import { Command } from "commander";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import {
  loadConfig,
  saveConfig,
  clearConfig,
  SyncClient,
  Config,
  SessionData,
  MessageData,
} from "./index";

// Types for Claude Code hook event data from stdin
interface HookSessionStartData {
  session_id: string;
  cwd?: string;
  model?: string;
  permission_mode?: string;
  source?: string;
  thinking_enabled?: boolean;
  mcp_servers?: string[];
}

interface HookSessionEndData {
  session_id: string;
  reason?: "user_stop" | "max_turns" | "error" | "completed";
  message_count?: number;
  tool_call_count?: number;
  total_token_usage?: {
    input: number;
    output: number;
  };
  cost_estimate?: number;
}

interface HookUserPromptData {
  session_id: string;
  prompt: string;
  timestamp?: string;
}

interface HookToolUseData {
  session_id: string;
  tool_name: string;
  tool_use_id?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: {
    output?: string;
    error?: string;
  };
  duration_ms?: number;
  success?: boolean;
}

interface HookStopData {
  session_id: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
  permission_mode?: string;
  cwd?: string;
  hook_event_name?: string;
}

// Types for Claude Code transcript JSONL entries
interface TranscriptUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface TranscriptContentPart {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface TranscriptMessage {
  content?: TranscriptContentPart[];
  usage?: TranscriptUsage;
  model?: string;
  stop_reason?: string | null;
}

interface TranscriptEntry {
  type?: string;
  uuid?: string;
  timestamp?: string;
  message?: TranscriptMessage;
  sessionId?: string;
  parentUuid?: string;
}

// Types for Claude Code settings.json
interface ClaudeSettings {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

// Type for package.json version field
interface PackageJson {
  version?: string;
}

// Read version from package.json
function getVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as PackageJson;
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("claude-code-sync")
  .description("Sync Claude Code sessions to OpenSync dashboard")
  .version(getVersion());

// ============================================================================
// Helper Functions
// ============================================================================

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.substring(0, 4) + "****" + key.substring(key.length - 4);
}

// ============================================================================
// Commands
// ============================================================================

program
  .command("login")
  .description("Configure Convex URL and API Key")
  .action(async () => {
    console.log("\n  Claude Code Sync - Login\n");
    console.log("Get your API key from your OpenSync.dev Settings page, starts with osk_. Enter it here:");
    console.log("  1. Go to Settings");
    console.log("  2. Click 'Generate API Key'");
    console.log("  3. Copy the key (starts with osk_)\n");

    const convexUrl = await prompt("Convex URL (e.g., https://your-project.convex.cloud): ");

    if (!convexUrl) {
      console.error("Error: Convex URL is required");
      process.exit(1);
    }

    if (!convexUrl.includes("convex.cloud") && !convexUrl.includes("convex.site")) {
      console.error("Error: Invalid Convex URL. Must contain convex.cloud or convex.site");
      process.exit(1);
    }

    const apiKey = await prompt("API Key (osk_...): ");

    if (!apiKey) {
      console.error("Error: API Key is required");
      process.exit(1);
    }

    if (!apiKey.startsWith("osk_")) {
      console.error("Error: Invalid API Key. Must start with osk_");
      process.exit(1);
    }

    const config: Config = {
      convexUrl,
      apiKey,
      autoSync: true,
      syncToolCalls: true,
      syncThinking: false,
    };

    // Test connection
    console.log("\nTesting connection...");
    const client = new SyncClient(config);
    const connected = await client.testConnection();

    if (!connected) {
      console.error("Error: Could not connect to Convex backend");
      console.error("   Check your URL and try again");
      process.exit(1);
    }

    // Save config
    saveConfig(config);
    console.log("\nConfiguration saved!");
    console.log(`   URL: ${convexUrl}`);
    console.log(`   Key: ${maskApiKey(apiKey)}`);
    console.log("\nNext step: Run the setup command to configure Claude Code hooks:\n");
    console.log("   claude-code-sync setup\n");
  });

program
  .command("logout")
  .description("Clear stored credentials")
  .action(() => {
    clearConfig();
    console.log("Credentials cleared");
  });

program
  .command("status")
  .description("Show connection status")
  .action(async () => {
    const config = loadConfig();

    console.log("\n  Claude Code Sync - Status\n");

    if (!config) {
      console.log("Not configured");
      console.log("   Run 'claude-code-sync login' to set up\n");
      process.exit(1);
    }

    console.log("Configuration:");
    console.log(`  Convex URL: ${config.convexUrl}`);
    console.log(`  API Key:    ${maskApiKey(config.apiKey)}`);
    console.log(`  Auto Sync:  ${config.autoSync !== false ? "enabled" : "disabled"}`);
    console.log(`  Tool Calls: ${config.syncToolCalls !== false ? "enabled" : "disabled"}`);
    console.log(`  Thinking:   ${config.syncThinking ? "enabled" : "disabled"}`);

    console.log("\nTesting connection...");
    const client = new SyncClient(config);
    const connected = await client.testConnection();

    if (connected) {
      console.log("Connected to Convex backend\n");
    } else {
      console.log("Error: Could not connect to Convex backend\n");
      process.exit(1);
    }
  });

program
  .command("config")
  .description("Show current configuration")
  .option("--json", "Output as JSON")
  .action((options: { json?: boolean }) => {
    const config = loadConfig();

    if (!config) {
      if (options.json) {
        console.log(JSON.stringify({ configured: false }));
      } else {
        console.log("Not configured. Run 'claude-code-sync login' to set up.");
      }
      return;
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            configured: true,
            convexUrl: config.convexUrl,
            apiKey: maskApiKey(config.apiKey),
            autoSync: config.autoSync !== false,
            syncToolCalls: config.syncToolCalls !== false,
            syncThinking: config.syncThinking === true,
          },
          null,
          2
        )
      );
    } else {
      console.log("\n  Current Configuration\n");
      console.log(`Convex URL:  ${config.convexUrl}`);
      console.log(`API Key:     ${maskApiKey(config.apiKey)}`);
      console.log(`Auto Sync:   ${config.autoSync !== false}`);
      console.log(`Tool Calls:  ${config.syncToolCalls !== false}`);
      console.log(`Thinking:    ${config.syncThinking === true}`);
      console.log(`\nConfig file: ~/.config/claude-code-sync/config.json\n`);
    }
  });

program
  .command("set <key> <value>")
  .description("Set a configuration value")
  .action((key: string, value: string) => {
    const config = loadConfig();

    if (!config) {
      console.error("Not configured. Run 'claude-code-sync login' first.");
      process.exit(1);
    }

    const validKeys = ["autoSync", "syncToolCalls", "syncThinking"];
    if (!validKeys.includes(key)) {
      console.error(`Invalid key. Valid keys: ${validKeys.join(", ")}`);
      process.exit(1);
    }

    const boolValue = value === "true" || value === "1" || value === "yes";
    
    // Type-safe config update
    if (key === "autoSync") {
      config.autoSync = boolValue;
    } else if (key === "syncToolCalls") {
      config.syncToolCalls = boolValue;
    } else if (key === "syncThinking") {
      config.syncThinking = boolValue;
    }

    saveConfig(config);
    console.log(`Set ${key} = ${boolValue}`);
  });

// ============================================================================
// Setup Command (configures Claude Code hooks)
// ============================================================================

// Claude Code hooks configuration
const CLAUDE_HOOKS_CONFIG = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: "claude-code-sync hook SessionStart",
          },
        ],
      },
    ],
    SessionEnd: [
      {
        hooks: [
          {
            type: "command",
            command: "claude-code-sync hook SessionEnd",
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: "claude-code-sync hook UserPromptSubmit",
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: "claude-code-sync hook PostToolUse",
          },
        ],
      },
    ],
    Stop: [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: "claude-code-sync hook Stop",
          },
        ],
      },
    ],
  },
};

program
  .command("setup")
  .description("Add hooks to Claude Code settings (configures ~/.claude/settings.json)")
  .option("--force", "Overwrite existing hooks configuration")
  .action(async (options: { force?: boolean }) => {
    const claudeDir = path.join(process.env.HOME || "~", ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");

    console.log("\n  Claude Code Sync - Setup\n");

    // Check if plugin credentials are configured
    const config = loadConfig();
    if (!config) {
      console.log("Warning: Plugin not configured yet.");
      console.log("   Run 'claude-code-sync login' first to set up credentials.\n");
    }

    // Create .claude directory if needed
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
      console.log("Created ~/.claude directory");
    }

    // Check for existing settings
    let existingSettings: ClaudeSettings = {};
    let hasExistingHooks = false;

    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, "utf-8");
        existingSettings = JSON.parse(content) as ClaudeSettings;
        hasExistingHooks = !!existingSettings.hooks;
        console.log("Found existing settings.json");
      } catch {
        console.log("Warning: Could not parse existing settings.json, will create new one");
      }
    }

    // Handle existing hooks
    if (hasExistingHooks && !options.force) {
      console.log("\nExisting hooks configuration found.");
      console.log("   Use --force to overwrite, or manually merge the hooks.\n");
      console.log("To manually add, include these hooks in your settings.json:");
      console.log(JSON.stringify(CLAUDE_HOOKS_CONFIG, null, 2));
      process.exit(1);
    }

    // Merge settings
    const newSettings = {
      ...existingSettings,
      ...CLAUDE_HOOKS_CONFIG,
    };

    // Write settings
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
      console.log("\nClaude Code hooks configured!");
      console.log(`   Settings file: ${settingsPath}`);
      console.log("\nSetup complete. Sessions will sync automatically.\n");
    } catch (error) {
      console.error("Error writing settings:", error);
      process.exit(1);
    }
  });

program
  .command("verify")
  .description("Verify credentials and Claude Code configuration")
  .action(async () => {
    console.log("\n  OpenSync Setup Verification\n");

    // Check credentials
    const config = loadConfig();
    if (config) {
      console.log("Credentials: OK");
      console.log(`   Convex URL: ${config.convexUrl}`);
      console.log(`   API Key: ${maskApiKey(config.apiKey)}`);
    } else {
      console.log("Credentials: NOT CONFIGURED");
      console.log("   Run 'claude-code-sync login' to set up");
    }

    // Check Claude Code config
    const settingsPath = path.join(process.env.HOME || "~", ".claude", "settings.json");
    let hooksConfigured = false;

    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, "utf-8");
        const settings = JSON.parse(content) as ClaudeSettings;
        hooksConfigured = !!settings.hooks?.SessionStart;
      } catch {
        // Ignore parse errors
      }
    }

    console.log("");
    if (hooksConfigured) {
      console.log("Claude Code Config: OK");
      console.log(`   Config file: ${settingsPath}`);
      console.log("   Hooks registered: claude-code-sync");
    } else {
      console.log("Claude Code Config: NOT CONFIGURED");
      console.log("   Run 'claude-code-sync setup' to configure hooks");
    }

    // Test connection if credentials exist
    if (config) {
      console.log("\nTesting connection...");
      const client = new SyncClient(config);
      const connected = await client.testConnection();
      if (connected) {
        console.log("Connection: OK\n");
      } else {
        console.log("Connection: FAILED\n");
        process.exit(1);
      }
    }

    if (config && hooksConfigured) {
      console.log("Ready! Start Claude Code and sessions will sync automatically.\n");
    } else {
      console.log("");
      process.exit(1);
    }
  });

// ============================================================================
// Sync Test Command (test connectivity)
// ============================================================================

program
  .command("synctest")
  .description("Test connectivity and create a test session")
  .action(async () => {
    const config = loadConfig();

    console.log("\n  Claude Code Sync - Connection Test\n");

    if (!config) {
      console.log("Not configured");
      console.log("   Run 'claude-code-sync login' to set up\n");
      process.exit(1);
    }

    console.log("Configuration:");
    console.log(`  Convex URL: ${config.convexUrl}`);
    console.log(`  API Key:    ${maskApiKey(config.apiKey)}`);

    console.log("\nTesting connection...");
    const client = new SyncClient(config);
    const connected = await client.testConnection();

    if (connected) {
      console.log("Connection: OK");
      
      // Create a test session to verify full sync works
      console.log("\nCreating test session...");
      try {
        const testSession = {
          sessionId: `test-${Date.now()}`,
          source: "claude-code" as const,
          title: "Connection Test",
          projectName: "synctest",
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
        };
        await client.syncSession(testSession);
        console.log("Test session created successfully");
        console.log("\nSync test passed. Ready to sync Claude Code sessions.\n");
      } catch (error) {
        console.log(`Test session failed: ${error}`);
        console.log("\nConnection works but sync may have issues.\n");
        process.exit(1);
      }
    } else {
      console.log("Connection: FAILED");
      console.log("\nCheck your Convex URL and API key.\n");
      process.exit(1);
    }
  });

// ============================================================================
// Hook Command (for Claude Code integration)
// ============================================================================

// Track session state for title generation (first user prompt)
const SESSION_STATE_FILE = path.join(
  process.env.HOME || "~",
  ".config",
  "claude-code-sync",
  "session-state.json"
);

interface SessionState {
  [sessionId: string]: {
    model?: string;
    firstPrompt?: string;
    tokenUsage?: { input: number; output: number };
    messageCount?: number;
    syncedMessageUuids?: Set<string> | string[];
  };
}

function loadSessionState(): SessionState {
  try {
    if (fs.existsSync(SESSION_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_STATE_FILE, "utf-8")) as SessionState;
      // Convert arrays back to Sets for syncedMessageUuids
      for (const sessionId of Object.keys(data)) {
        const session = data[sessionId];
        if (session.syncedMessageUuids && Array.isArray(session.syncedMessageUuids)) {
          session.syncedMessageUuids = new Set(session.syncedMessageUuids);
        }
      }
      return data;
    }
  } catch {
    // Ignore errors
  }
  return {};
}

function saveSessionState(state: SessionState): void {
  try {
    const dir = path.dirname(SESSION_STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Convert Sets to arrays for JSON serialization
    const serializable: Record<string, unknown> = {};
    for (const sessionId of Object.keys(state)) {
      const session = state[sessionId];
      serializable[sessionId] = {
        ...session,
        syncedMessageUuids: session.syncedMessageUuids instanceof Set
          ? Array.from(session.syncedMessageUuids)
          : session.syncedMessageUuids,
      };
    }
    fs.writeFileSync(SESSION_STATE_FILE, JSON.stringify(serializable, null, 2));
  } catch {
    // Ignore errors
  }
}

function generateTitle(prompt: string): string {
  // Use first 80 chars of first prompt as title, trim at word boundary
  const trimmed = prompt.slice(0, 80).trim();
  if (prompt.length > 80) {
    const lastSpace = trimmed.lastIndexOf(" ");
    if (lastSpace > 40) {
      return trimmed.slice(0, lastSpace) + "...";
    }
    return trimmed + "...";
  }
  return trimmed;
}

// Parse transcript file to extract assistant messages and token usage
interface ParsedTranscript {
  assistantMessages: Array<{
    uuid: string;
    text: string;
    timestamp: string;
    model?: string;
  }>;
  tokenUsage: {
    input: number;
    output: number;
  };
}

function parseTranscriptFile(transcriptPath: string): ParsedTranscript {
  const result: ParsedTranscript = {
    assistantMessages: [],
    tokenUsage: { input: 0, output: 0 },
  };

  try {
    if (!fs.existsSync(transcriptPath)) {
      return result;
    }

    const content = fs.readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n");
    const seenUuids = new Set<string>();

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line) as TranscriptEntry;

        // Only process assistant messages
        if (entry.type === "assistant" && entry.message) {
          const msg = entry.message;
          const uuid = entry.uuid || "";

          // Skip if we've already seen this UUID (dedup)
          if (uuid && seenUuids.has(uuid)) continue;
          if (uuid) seenUuids.add(uuid);

          // Extract text content from message
          if (msg.content && Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "text" && part.text) {
                result.assistantMessages.push({
                  uuid,
                  text: part.text,
                  timestamp: entry.timestamp || new Date().toISOString(),
                  model: msg.model,
                });
              }
            }
          }

          // Accumulate token usage from all assistant messages
          if (msg.usage) {
            result.tokenUsage.input +=
              (msg.usage.input_tokens || 0) +
              (msg.usage.cache_read_input_tokens || 0) +
              (msg.usage.cache_creation_input_tokens || 0);
            result.tokenUsage.output += msg.usage.output_tokens || 0;
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Return empty result on error
  }

  return result;
}

program
  .command("hook <event>")
  .description("Handle Claude Code hook events (reads stdin)")
  .action(async (event: string) => {
    const config = loadConfig();

    if (!config) {
      // Exit silently if not configured (don't block Claude Code)
      process.exit(0);
    }

    if (config.autoSync === false) {
      process.exit(0);
    }

    // Read JSON input from stdin
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
    }

    if (!input.trim()) {
      process.exit(0);
    }

    try {
      const client = new SyncClient(config);
      const sessionState = loadSessionState();

      switch (event) {
        case "SessionStart": {
          const data = JSON.parse(input) as HookSessionStartData;
          
          // Initialize session state
          sessionState[data.session_id] = {
            model: data.model,
            tokenUsage: { input: 0, output: 0 },
            messageCount: 0,
          };
          saveSessionState(sessionState);
          
          const session: SessionData = {
            sessionId: data.session_id,
            source: "claude-code",
            cwd: data.cwd,
            model: data.model,
            permissionMode: data.permission_mode,
            thinkingEnabled: data.thinking_enabled,
            mcpServers: data.mcp_servers,
            startType: data.source === "startup" ? "new" : (data.source as SessionData["startType"]),
            startedAt: new Date().toISOString(),
            projectPath: data.cwd,
            projectName: data.cwd ? data.cwd.split("/").pop() : undefined,
          };
          await client.syncSession(session);
          break;
        }

        case "SessionEnd": {
          const data = JSON.parse(input) as HookSessionEndData;
          const state = sessionState[data.session_id] || {};
          
          // Calculate final token usage
          const finalTokenUsage = data.total_token_usage || state.tokenUsage;
          
          const session: SessionData = {
            sessionId: data.session_id,
            source: "claude-code",
            title: state.firstPrompt ? generateTitle(state.firstPrompt) : undefined,
            endReason: data.reason,
            messageCount: data.message_count || state.messageCount,
            toolCallCount: data.tool_call_count,
            tokenUsage: finalTokenUsage,
            costEstimate: data.cost_estimate,
            endedAt: new Date().toISOString(),
          };
          await client.syncSession(session);
          
          // Clean up session state
          delete sessionState[data.session_id];
          saveSessionState(sessionState);
          break;
        }

        case "UserPromptSubmit": {
          const data = JSON.parse(input) as HookUserPromptData;
          const state = sessionState[data.session_id] || {};
          
          // Track first prompt for title generation
          if (!state.firstPrompt) {
            state.firstPrompt = data.prompt;
            sessionState[data.session_id] = state;
            saveSessionState(sessionState);
            
            // Update session with title
            const session: SessionData = {
              sessionId: data.session_id,
              source: "claude-code",
              title: generateTitle(data.prompt),
            };
            await client.syncSession(session);
          }
          
          // Increment message count
          state.messageCount = (state.messageCount || 0) + 1;
          sessionState[data.session_id] = state;
          saveSessionState(sessionState);
          
          const message: MessageData = {
            sessionId: data.session_id,
            messageId: `${data.session_id}-user-${Date.now()}`,
            source: "claude-code",
            role: "user",
            content: data.prompt,
            timestamp: data.timestamp || new Date().toISOString(),
          };
          await client.syncMessage(message);
          break;
        }

        case "PostToolUse": {
          if (!config.syncToolCalls) break;
          const data = JSON.parse(input) as HookToolUseData;
          const state = sessionState[data.session_id] || {};
          
          const message: MessageData = {
            sessionId: data.session_id,
            messageId: data.tool_use_id || `${data.session_id}-tool-${Date.now()}`,
            source: "claude-code",
            role: "assistant",
            toolName: data.tool_name,
            toolArgs: data.tool_input,
            toolResult: data.tool_result?.output || data.tool_result?.error,
            durationMs: data.duration_ms,
            timestamp: new Date().toISOString(),
          };
          await client.syncMessage(message);
          break;
        }

        case "Stop": {
          // Stop event provides transcript_path - we read it to get messages and tokens
          const data = JSON.parse(input) as HookStopData;
          const state = sessionState[data.session_id] || {};
          
          // Parse transcript file to extract assistant messages and token usage
          if (data.transcript_path) {
            const transcript = parseTranscriptFile(data.transcript_path);
            
            // Update token usage from transcript
            if (transcript.tokenUsage.input > 0 || transcript.tokenUsage.output > 0) {
              state.tokenUsage = transcript.tokenUsage;
            }
            
            // Track which messages we've already synced to avoid duplicates
            const syncedMessages = state.syncedMessageUuids instanceof Set
              ? state.syncedMessageUuids
              : new Set<string>(Array.isArray(state.syncedMessageUuids) ? state.syncedMessageUuids : []);
            
            // Sync new assistant messages
            for (const msg of transcript.assistantMessages) {
              // Skip if we've already synced this message
              if (msg.uuid && syncedMessages.has(msg.uuid)) continue;
              if (msg.uuid) syncedMessages.add(msg.uuid);
              
              // Increment message count
              state.messageCount = (state.messageCount || 0) + 1;
              
              const message: MessageData = {
                sessionId: data.session_id,
                messageId: msg.uuid || `${data.session_id}-assistant-${Date.now()}`,
                source: "claude-code",
                role: "assistant",
                content: msg.text,
                model: msg.model,
                timestamp: msg.timestamp,
              };
              await client.syncMessage(message);
            }
            
            // Store synced message UUIDs (convert Set to array for JSON)
            state.syncedMessageUuids = syncedMessages;
          }
          
          sessionState[data.session_id] = state;
          saveSessionState(sessionState);
          
          // Update session with token usage from transcript
          const session: SessionData = {
            sessionId: data.session_id,
            source: "claude-code",
            tokenUsage: state.tokenUsage,
            messageCount: state.messageCount,
          };
          await client.syncSession(session);
          break;
        }

        default:
          // Unknown event, ignore
          break;
      }

      process.exit(0);
    } catch (error) {
      // Log to stderr but don't block Claude Code
      console.error(`[claude-code-sync] Error: ${error}`);
      process.exit(0);
    }
  });

// Parse and run
program.parse();
