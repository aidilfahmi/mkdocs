## RPC Monitoring and Goverment Proposal Alert
### Preparing folder and requirement
```shell
cd $HOME
mkdir monitor
cd monitor
npm init -y
npm install axios
```
### Create alert.json
```nano alert.json
```
```shell
const axios = require("axios");
const fs = require("fs");

// ================= CONFIG =================

// 🔐 Your Telegram Bot Token
const TELEGRAM_BOT_TOKEN = "GUdTEZ8GdI:a3490328409329034"; //bot token

// 👤 Your PRIVATE chat ID (positive number)
const TELEGRAM_CHAT_ID = "1232323****";  // telegram id

const RPC_INTERVAL = 60000;        // 60 sec
const GOV_INTERVAL = 1800000;       // 30 min
const ALERT_COOLDOWN = 600000;     // 10 min cooldown

const CHAINS = [
  { name: "Atomone", rpc: "https://rpc-atomone.dnsarz.net", rest: "https://api-atomone.dnsarz.net" },
  { name: "BitBadget", rpc: "http://rpc-bitbadges.dnsarz.net", rest: "https://api-bitbadges.dnsarz.net" }
];

// ==========================================

const STATE_FILE = "./state.json";

let state = {};
if (fs.existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE));
  } catch {
    state = {};
  }
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function initChainState(name) {
  if (!state[name]) state[name] = {};
  if (!state[name].status) state[name].status = "unknown";
  if (!state[name].lastBlock) state[name].lastBlock = 0;
  if (!state[name].lastAlert) state[name].lastAlert = 0;
  if (!state[name].gov) state[name].gov = {};
}

// ================= TELEGRAM =================

async function sendTelegram(message) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML"
      }
    );
  } catch (err) {
    console.error("Telegram error:", err.response?.data || err.message);
  }
}

// ================= RPC CHECK =================

async function checkRPC(chain) {
  const now = Date.now();
  initChainState(chain.name);

  try {
    const res = await axios.get(`${chain.rpc}/status`, { timeout: 5000 });
    const syncInfo = res.data?.result?.sync_info;

    if (!syncInfo) throw new Error("Invalid RPC response");

    const latestBlock = parseInt(syncInfo.latest_block_height);

    if (syncInfo.catching_up) {
      throw new Error("Node catching_up");
    }

    if (state[chain.name].lastBlock === latestBlock) {
      throw new Error("Block not increasing");
    }

    state[chain.name].lastBlock = latestBlock;

    if (state[chain.name].status !== "up") {
      await sendTelegram(
        `🟢 <b>${chain.name} RPC RECOVERED</b>\nHeight: ${latestBlock}`
      );
    }

    state[chain.name].status = "up";
    console.log(`${chain.name} RPC OK - ${latestBlock}`);

  } catch (err) {
    if (
      state[chain.name].status !== "down" ||
      now - state[chain.name].lastAlert > ALERT_COOLDOWN
    ) {
      await sendTelegram(
        `🔴 <b>${chain.name} RPC DOWN</b>\nReason: ${err.message}`
      );
      state[chain.name].lastAlert = now;
    }

    state[chain.name].status = "down";
    console.log(`${chain.name} RPC ERROR - ${err.message}`);
  }
}

// ================= GOVERNANCE CHECK =================

async function checkGovernance(chain) {
  if (!chain.rest) return;

  initChainState(chain.name);

  let proposals = [];

  try {
    // Try v1
    const res = await axios.get(
      `${chain.rest}/cosmos/gov/v1/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD`,
      { timeout: 8000 }
    );
    proposals = res.data?.proposals || [];
  } catch (err) {
    try {
      // Fallback v1beta1
      const resBeta = await axios.get(
        `${chain.rest}/cosmos/gov/v1beta1/proposals?proposal_status=2`,
        { timeout: 8000 }
      );
      proposals = resBeta.data?.proposals || [];
    } catch {
      console.log(`${chain.name} Governance not available`);
      return;
    }
  }

  console.log(`${chain.name} proposals found: ${proposals.length}`);

  for (const proposal of proposals) {
    const id = String(proposal.id);

    if (!id) continue;

    const title =
      proposal.title ||
      proposal.content?.title ||
      proposal.messages?.[0]?.content?.title ||
      "No title";

    const votingEndRaw =
      proposal.voting_end_time ||
      proposal.votingEndTime ||
      proposal.content?.voting_end_time;

    if (!votingEndRaw) continue;

    const votingEnd = new Date(votingEndRaw).getTime();
    const now = Date.now();

    if (!state[chain.name].gov[id]) {
      state[chain.name].gov[id] = {
        alertedNew: false,
        alertedEnding: false
      };
    }

    // New proposal alert
    if (!state[chain.name].gov[id].alertedNew) {
      await sendTelegram(
        `🗳️ <b>New Proposal - ${chain.name}</b>\nID: ${id}\nTitle: ${title}`
      );
      state[chain.name].gov[id].alertedNew = true;
    }

    // Ending soon (<24h)
    const hoursLeft = (votingEnd - now) / (1000 * 60 * 60);

    if (
      hoursLeft > 0 &&
      hoursLeft < 24 &&
      !state[chain.name].gov[id].alertedEnding
    ) {
      await sendTelegram(
        `⏰ <b>Proposal Ending Soon - ${chain.name}</b>\nID: ${id}\nLess than 24h remaining`
      );
      state[chain.name].gov[id].alertedEnding = true;
    }
  }
}

// ================= LOOPS =================

async function runRPCMonitor() {
  for (const chain of CHAINS) {
    await checkRPC(chain);
  }
  saveState();
}

async function runGovMonitor() {
  for (const chain of CHAINS) {
    await checkGovernance(chain);
  }
  saveState();
}

// ================= START =================

console.log("🚀 Monitoring started...");

runRPCMonitor();
runGovMonitor();

setInterval(runRPCMonitor, RPC_INTERVAL);
setInterval(runGovMonitor, GOV_INTERVAL);
```

### Run the Script
```
node alert.json
```
