# Changelog

All notable changes to this project are documented here.

---

## [2.0.0] — 2025

### Added
- Interactive Telegram commands: `/add`, `/list`, `/status`, `/delete`, `/help`
- Chain data persisted to `chains.json` — no manual config editing required
- `/add` validates RPC endpoint before saving the chain
- `/delete` uses inline keyboard confirmation buttons
- `/status [name]` supports optional filter by chain name
- Auth guard: bot ignores all messages outside the configured `TELEGRAM_CHAT_ID`
- Environment variable support for `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
- systemd service file included for production deployment

### Changed
- Chains no longer hardcoded in script — fully dynamic at runtime
- Governance supports both `v1` and `v1beta1` endpoints with automatic fallback

---

## [1.0.0] — Initial Release

### Added
- RPC monitoring with block height stall detection
- Governance proposal alerts (new proposals + ending soon < 24h)
- Telegram notifications via bot token
- State persistence via `state.json`
- Alert cooldown to prevent notification spam
- Hardcoded `CHAINS` array configuration
