# Claude Code Sync v0.1.11 Fix

## The Problem

After upgrading to v0.1.10, users reported:
- Assistant messages not appearing in OpenSync session view (only tool calls visible)
- Token counts showing as "0 tokens / $0.0000"
- Sessions labeled as "Untitled"

The OpenCode plugin worked correctly, but the Claude Code plugin did not.

## Root Cause

The Claude Code hooks system works differently than expected. When the `Stop` hook fires, Claude Code does NOT pass `response` or `token_usage` directly in the hook payload.

**What we expected:**
```json
{
  "session_id": "abc123",
  "response": "Done. I added the feature...",
  "token_usage": { "input": 500, "output": 100 }
}
```

**What Claude Code actually sends:**
```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/.../abc123.jsonl",
  "stop_hook_active": true,
  "permission_mode": "default"
}
```

The actual conversation data is stored in the **transcript JSONL file**, not passed directly to hooks.

## The Solution

Updated the plugin to read and parse the transcript file:

1. **New `parseTranscriptFile()` function** reads the JSONL transcript and extracts:
   - Assistant message text from `type: "assistant"` entries
   - Token usage from `message.usage` fields
   - Model information from each message

2. **Updated Stop handler** now:
   - Reads `transcript_path` from the hook data
   - Parses the JSONL to find assistant messages
   - Deduplicates messages using UUID tracking
   - Syncs extracted messages to OpenSync
   - Updates session with total token usage

3. **Transcript entry structure:**
```json
{
  "type": "assistant",
  "uuid": "88e7c2c6-644e-4b0d-be0a-13d00dbfbc04",
  "timestamp": "2026-01-22T08:36:51.407Z",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "content": [
      {"type": "thinking", "thinking": "..."},
      {"type": "text", "text": "Done. I added..."}
    ],
    "usage": {
      "input_tokens": 7,
      "output_tokens": 1,
      "cache_read_input_tokens": 22233
    }
  }
}
```

## Files Changed

- `src/cli.ts` - Updated HookStopData interface, added parseTranscriptFile(), updated Stop handler
- `src/index.ts` - Added `model` field to MessageData interface
- `package.json` - Bumped version to 0.1.11
- `changelog.md` - Added 0.1.11 release notes

## Key Lesson

Claude Code hooks provide a `transcript_path` to a JSONL file containing the full conversation history. Unlike the OpenCode plugin system which passes data directly, Claude Code requires reading and parsing this file to extract messages and token usage.

## Testing

1. Upgrade: `npm update -g claude-code-sync`
2. Verify version: `claude-code-sync --version` (should show 0.1.11)
3. Start a new Claude Code session
4. Check OpenSync dashboard for:
   - Assistant text responses (not just tool calls)
   - Actual token counts
   - Session titles from first prompt

## References

- [Claude Code Hooks Documentation](https://code.claude.com/docs/en/hooks)
- Stop hook input only includes: `session_id`, `transcript_path`, `stop_hook_active`, `permission_mode`, `cwd`, `hook_event_name`
