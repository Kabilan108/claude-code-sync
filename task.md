# Tasks

## Completed

- [x] Add `setup` command to configure Claude Code hooks automatically
- [x] Add `verify` command to check setup status
- [x] Add `synctest` command to test connectivity and create test session
- [x] Add `hook <event>` command for Claude Code integration
- [x] Update README with setup command and one-liner options
- [x] Update README with verify command and example output
- [x] Update CLI commands table in README
- [x] Update docs/CLAUDE-code-sync-Commands.md with new commands
- [x] Add hook command documentation
- [x] Add synctest command documentation
- [x] Add OpenSync Ecosystem section to README
- [x] Update Links section with all package references
- [x] Create files.md
- [x] Create changelog.md
- [x] Create task.md
- [x] v0.1.10: Fix "Unknown Tool" display by passing object instead of JSON string
- [x] v0.1.11: Fix Stop hook to read transcript_path JSONL file instead of expecting response directly
- [x] v0.1.11: Add parseTranscriptFile() to extract assistant messages and token usage
- [x] v0.1.11: Add message deduplication with UUID tracking
- [x] v0.1.11: Add model field to MessageData interface
- [x] v0.1.11: Add upgrade instructions to README
- [x] v0.1.13: Add cost calculation with cache token pricing (MODEL_PRICING, calculateCost)
- [x] v0.1.13: Add duration calculation from transcript timestamps
- [x] v0.1.13: Add TranscriptStats interface for comprehensive transcript data
- [x] v0.1.13: Extend parseTranscriptFile to track cache tokens separately
- [x] v0.1.13: Add title extraction from transcript slug field
- [x] v0.1.13: Add tool call counting from transcript
- [x] v0.1.13: Add git branch extraction in SessionStart handler
- [x] v0.1.13: Update event interfaces to match Claude Code hook payloads
- [x] v0.1.13: Add parseTranscript and calculateCost to index.ts for createPlugin
- [x] v0.1.13: Add MessagePart interface for tool calls
- [x] v0.1.13: Merge PR #1 features (model, cost, duration sync)
- [x] v0.1.14: Version bump for npm publish

## Pending

- [ ] Publish v0.1.14 to npm
- [ ] Test with fresh Claude Code session to verify cost calculation
- [ ] Test duration tracking across sessions
- [ ] Consider adding thinking content extraction from transcripts
- [ ] Close PR #1 after verification
