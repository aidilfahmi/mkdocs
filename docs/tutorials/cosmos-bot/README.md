# 🤖 Cosmos Monitor Bot

A Telegram bot for monitoring **Cosmos SDK blockchain nodes** — RPC health, block progress, and governance proposals — with full interactive chain management via chat commands.

No config file editing needed. Add, list, and remove chains directly from Telegram.

---

## Features

- **RPC Monitoring** — checks every 60 seconds; alerts on node down or block stalled
- **Auto-recovery alerts** — notifies when a downed node comes back online
- **Governance alerts** — detects new voting-period proposals and warns when voting ends in under 24h
- **Interactive chain management** — add/remove chains via bot commands, no server restarts needed
- **Persistent state** — chains and monitoring state survive bot restarts
- **Alert cooldown** — prevents repeated alerts; re-alerts after 10 min if node stays down
- **Auth guard** — only responds to your own Telegram chat ID

---

## Screenshots

```
/add Atomone https://rpc-atomone.example.com https://api-atomone.example.com

🔍 Validating RPC for Atomone...
✅ Atomone added successfully!
   RPC: https://rpc-atomone.example.com
   REST: https://api-atomone.example.com
```

```
/list

📋 Monitored Chains (2)

1. 🟢 Atomone
   RPC: https://rpc-atomone.example.com
   REST: https://api-atomone.example.com
   Block: 4823019

2. 🔴 BitBadges
   RPC: http://rpc-bitbadges.example.com
   REST: https://api-bitbadges.example.com
   Block: 1029384
```

---

## Commands

| Command | Description |
|---|---|
| `/add <Name> <rpc_url> <rest_url>` | Add a chain to monitoring (validates RPC first) |
| `/list` | Show all monitored chains with live status |
| `/status [name]` | Force-check RPC now; optionally filter by name |
| `/delete <Name>` | Remove a chain (asks for confirmation) |
| `/help` | Show all commands |

**Examples:**
```
/add Atomone https://rpc-atomone.example.com https://api-atomone.example.com
/status Atomone
/delete BitBadges
```

---

## Alerts

The bot sends automatic alerts to your Telegram for:

| Event | Message |
|---|---|
| Node RPC unreachable | 🔴 `<Chain> RPC DOWN` |
| Node recovered | 🟢 `<Chain> RPC RECOVERED` |
| Block height stalled | 🔴 `Block height not increasing` |
| Node catching up | 🔴 `Node is catching_up` |
| New governance proposal | 🗳️ `New Proposal – <Chain>` |
| Proposal ending < 24h | ⏰ `Proposal Ending Soon – <Chain>` |

---

## Project Structure

```
cosmos-monitor-bot/
├── bot.js              # Main bot logic
├── package.json
├── chains.json         # Auto-generated: your monitored chains
├── state.json          # Auto-generated: monitoring state & gov history
├── .env.example        # Environment variable template
└── cosmos-bot.service  # systemd service for production
```

> `chains.json` and `state.json` are created automatically on first run. Do not edit them manually while the bot is running.

---

## Setup

### Prerequisites

- Node.js v18+
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Your Telegram chat ID (get it from [@userinfobot](https://t.me/userinfobot))

### Installation

```bash
git clone https://github.com/your-username/cosmos-monitor-bot.git
cd cosmos-monitor-bot
npm install
```

### Configuration

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_CHAT_ID=123456789
```

Alternatively, set credentials directly in `bot.js` at the top of the CONFIG section.

### Run

```bash
# With env file
export $(cat .env | xargs) && node bot.js

# Or directly
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy node bot.js
```

---

## Production Deployment (systemd)

1. Copy the service file:
```bash
sudo cp cosmos-bot.service /etc/systemd/system/
```

2. Edit the service file with your username and credentials:
```bash
sudo nano /etc/systemd/system/cosmos-bot.service
```

3. Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable cosmos-bot
sudo systemctl start cosmos-bot
```

4. Check logs:
```bash
sudo journalctl -fu cosmos-bot
```

---

## Timing Reference

| Check | Interval |
|---|---|
| RPC / block height | Every 60 seconds |
| Governance proposals | Every 30 minutes |
| Alert cooldown (re-alert if still down) | Every 10 minutes |

---

## Supported Chains

Any Cosmos SDK chain with a standard Tendermint RPC and Cosmos REST (LCD) endpoint. Compatible with both:
- `cosmos/gov/v1` (newer chains)
- `cosmos/gov/v1beta1` (older chains, automatic fallback)

---

## Security Notes

- The bot only processes commands from the `TELEGRAM_CHAT_ID` you configure. All other users are silently rejected.
- Never commit your `.env` file or expose your bot token publicly.
- Add `.env` and `state.json` / `chains.json` to `.gitignore` if you fork this repo.

---

## License

MIT
