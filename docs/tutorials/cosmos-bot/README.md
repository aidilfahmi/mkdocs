# 🤖 Cosmos Monitor Bot

A Telegram bot for monitoring **Cosmos SDK blockchain nodes** — RPC health, block progress, governance proposals, chain upgrades — and **submitting governance votes** directly from chat.

No config file editing needed. All chain management and voting happens via Telegram commands.

---

## Features

- **RPC Monitoring** — checks every 60s; alerts on node down or block stalled
- **Auto-recovery alerts** — notifies when a downed node comes back online
- **Governance alerts** — detects new voting-period proposals; warns when voting ends in under 24h
- **Governance voting** — vote YES/NO/ABSTAIN/VETO on proposals directly from Telegram
- **Upgrade monitoring** — staged alerts at detection → 100 blocks → 10 blocks → complete
- **Interactive chain management** — add/remove chains live, no server restarts needed
- **Encrypted key storage** — mnemonics stored AES-256-GCM encrypted in `chains.json`
- **Mnemonic auto-delete** — `/addkey` messages are immediately deleted from chat
- **Auth guard** — only responds to your own Telegram chat ID

---

## Commands

### Chain Management

| Command | Description |
|---|---|
| `/add <Name> <rpc_url> <rest_url>` | Add a chain (validates RPC first) |
| `/list` | Show all chains with status and key indicator |
| `/status [name]` | Force-check RPC; shows upgrade and voter info |
| `/delete <Name>` | Remove a chain (confirmation required) |

### Voting Keys

| Command | Description |
|---|---|
| `/addkey <Name> <prefix> <denom> <gasPrice> <mnemonic>` | Register a wallet for voting |
| `/mykeys` | List all registered voter addresses |
| `/removekey <Name>` | Delete a stored key (confirmation required) |

### Governance Voting

| Command | Description |
|---|---|
| `/vote <Name> <proposal_id> <yes\|no\|abstain\|veto>` | Vote on a proposal (confirmation required) |

**Examples:**
```
/add Atomone https://rpc-atomone.example.com https://api-atomone.example.com

/addkey Atomone cosmos uatom 0.025uatom word1 word2 word3 ... word24

/vote Atomone 12 yes
/vote Atomone 12 no
/vote Atomone 12 abstain
/vote Atomone 12 veto
```

---

## Vote Flow

```
You: /vote Atomone 12 yes

Bot: 🗳️ Confirm Vote
     Chain: Atomone
     Proposal: 12
     Vote: ✅ YES
     Voter: cosmos1abc...xyz
     [✅ Confirm & Broadcast]  [❌ Cancel]

You: [tap Confirm]

Bot: ✅ Vote Submitted!
     Tx Hash: ABC123DEF...
```

---

## Automatic Alerts

| Event | Message |
|---|---|
| Node RPC unreachable | 🔴 `<Chain> RPC DOWN` |
| Node recovered | 🟢 `<Chain> RPC RECOVERED` |
| Block height stalled | 🔴 `Block height not increasing` |
| New governance proposal | 🗳️ `New Proposal – <Chain>` + vote hint |
| Proposal ending < 24h | ⏰ `Proposal Ending Soon – <Chain>` |
| Upgrade plan found | 🆙 `Upgrade Detected` with ETA |
| 100 blocks before upgrade | ⚠️ `Upgrade in 100 Blocks` |
| 10 blocks before upgrade | 🚨 `UPGRADE IMMINENT` |
| Upgrade plan cleared | ✅ `Upgrade Complete` |

### Upgrade Alert Flow

```
Block 4,999,500  →  🆙 Upgrade Detected: "v2.0.0" at block 5,000,000 (~55 min)
Block 4,999,900  →  ⚠️ Upgrade in 100 Blocks — prepare your binary!
Block 4,999,990  →  🚨 UPGRADE IMMINENT — only 10 blocks remaining!
Block 5,000,001  →  ✅ Upgrade Complete — chain is running the new version
```

---

## Security

### Mnemonic Encryption

Mnemonics are encrypted with **AES-256-GCM** before being written to `chains.json`:

- The key is derived from your `ENCRYPT_SECRET` env var using `scrypt`
- Each encryption uses a random 96-bit IV so every stored value is unique
- The raw mnemonic never touches disk

### Message Auto-Delete

When you send `/addkey`, the bot **immediately deletes your message** from Telegram chat history to prevent the mnemonic from sitting in chat logs.

### Best Practices

- Set a strong, unique `ENCRYPT_SECRET` in your `.env` file
- Never commit `.env` or `chains.json` to a public repository
- Use a **dedicated wallet** with only enough balance for gas fees
- Validator voting power comes from the validator operator key — use your **delegator/voter address** for governance, not your validator key

---

## Project Structure

```
cosmos-monitor-bot/
├── bot.js               # Main bot logic
├── package.json
├── chains.json          # Auto-generated: chains + encrypted keys
├── state.json           # Auto-generated: monitoring state & gov history
├── .env.example         # Environment variable template
└── cosmos-bot.service   # systemd service for production
```

> `chains.json` and `state.json` are created automatically. Do not edit while the bot is running.

---

## Setup

### Prerequisites

- Node.js v18+
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Your Telegram chat ID from [@userinfobot](https://t.me/userinfobot)

### Installation

```bash
git clone https://github.com/your-username/cosmos-monitor-bot.git
cd cosmos-monitor-bot
npm install
```

### Configuration

```bash
cp .env.example .env
nano .env
```

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_CHAT_ID=123456789
ENCRYPT_SECRET=change-me-to-something-random-and-secret
```

### Run

```bash
export $(cat .env | xargs) && node bot.js
```

---

## Production Deployment (systemd)

```bash
sudo cp cosmos-bot.service /etc/systemd/system/
sudo nano /etc/systemd/system/cosmos-bot.service   # fill in user + env vars
sudo systemctl daemon-reload
sudo systemctl enable --now cosmos-bot
sudo journalctl -fu cosmos-bot
```

---

## Timing Reference

| Check | Interval |
|---|---|
| RPC / block height | Every 60 seconds |
| Upgrade plan | Every 60 seconds (runs alongside RPC) |
| Governance proposals | Every 30 minutes |
| Alert cooldown (re-alert if still down) | Every 10 minutes |

---

## Supported Chains

Any Cosmos SDK chain with standard Tendermint RPC and REST (LCD) endpoints. Governance supports both `v1` and `v1beta1` with automatic fallback. Voting uses `cosmos.gov.v1beta1.MsgVote`.

---

## License

MIT
