# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.1.11] - 2025-01-22

### Fixed

- Fixed Stop hook not receiving assistant responses. Claude Code hooks only provide transcript_path, not response text directly
- Now reads and parses transcript JSONL file to extract assistant messages and token usage
- Fixed token counts showing as 0 by accumulating usage from transcript entries
- Fixed assistant messages not appearing in session view by extracting text content from transcript

### Added

- parseTranscriptFile function to read Claude Code transcript JSONL files
- TranscriptEntry, TranscriptMessage, and related types for transcript parsing
- Deduplication of synced messages using UUID tracking to prevent duplicates on multiple Stop events
- Support for transcript_path field in Stop hook data (per Claude Code hooks documentation)

### Changed

- HookStopData interface updated to match actual Claude Code hooks payload (transcript_path instead of response/token_usage)
- SessionState now tracks syncedMessageUuids to avoid re-syncing messages

## [0.1.10] - 2025-01-22

### Fixed

- Fixed "Unknown Tool" display issue. Tool call parts now pass content as object instead of JSON string, matching OpenSync frontend expectations

## [0.1.9] - 2025-01-22

### Fixed

- Fixed Stop hook not capturing assistant responses. Now properly syncs response text to messages table
- Fixed sessions showing as "Untitled". Now generates title from first user prompt
- Fixed token counts showing as 0. Now accumulates token usage from Stop events and syncs to session
- Fixed textContent being empty for assistant messages. Stop event response now stored as message content
- Fixed model field not being passed through to backend

### Added

- Session state tracking to accumulate token usage and message counts across hook events
- Title generation from first user prompt (truncates at 80 chars with word boundary)
- HookStopData interface for Stop event processing
- Support for tool_use_id field in PostToolUse events
- Support for model field in SessionStart events
- Support for thinking_enabled and mcp_servers in SessionStart events

### Changed

- transformSession now only includes defined fields to avoid overwriting with undefined
- transformMessage improved to handle tool calls with separate tool-call and tool-result parts
- Message IDs now include role prefix for better identification (user-timestamp, assistant-timestamp)

## [0.1.8] - 2025-01-19

### Fixed

- Fixed sync payload field mapping: `sessionId` now transforms to `externalId` for backend compatibility
- Fixed message sync: `messageId` transforms to `externalId`, `sessionId` to `sessionExternalId`, `content` to `textContent`
- Fixed `synctest` command failing with ArgumentValidationError for missing `externalId` field
- Added `transformSession` and `transformMessage` methods to properly map plugin fields to backend schema
- Re-throw errors in sync methods to surface failures properly

### Added

- `setup` command to automatically configure Claude Code hooks in `~/.claude/settings.json`
- `verify` command to check credentials and Claude Code configuration status
- `synctest` command to test connectivity and create a test session
- `hook <event>` command to handle Claude Code hook events (SessionStart, SessionEnd, UserPromptSubmit, PostToolUse, Stop)
- One-liner alternative for quick setup in documentation
- Hook events documentation section in README

### Changed

- Updated README with simplified Step 3 (setup command or one-liner)
- Added Step 4 (verify) to README Quick Start
- Added OpenSync Ecosystem section to README with links to all packages
- Updated Links section with organized package references

## [0.1.3] - 2025-01-18

### Added

- Initial public release
- `login` command for interactive credential configuration
- `logout` command to clear credentials
- `status` command to show connection status
- `config` command to display current configuration
- `set` command to update configuration values
- Environment variable support for configuration
- Automatic URL normalization (.convex.cloud to .convex.site)
- API key masking in output
