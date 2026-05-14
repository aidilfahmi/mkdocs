const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || "YOUR_CHAT_ID_HERE";

const RPC_INTERVAL    = 60_000;     // 60 sec
const GOV_INTERVAL    = 1_800_000;  // 30 min
const ALERT_COOLDOWN  = 600_000;    // 10 min

const CHAINS_FILE = path.join(__dirname, "chains.json");
const STATE_FILE  = path.join(__dirname, "state.json");

// ================= PERSISTENCE =================

function loadJSON(file, fallback) {
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  }
  return fallback;
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let chains = loadJSON(CHAINS_FILE, []);
// chains: [{ name, rpc, rest }]

let state = loadJSON(STATE_FILE, {});
// state: { [chainName]: { status, lastBlock, lastAlert, gov: {} } }

function saveChains() { saveJSON(CHAINS_FILE, chains); }
function saveState()  { saveJSON(STATE_FILE, state); }

function initChainState(name) {
  if (!state[name])            state[name] = {};
  if (!state[name].status)     state[name].status    = "unknown";
  if (!state[name].lastBlock)  state[name].lastBlock  = 0;
  if (!state[name].lastAlert)  state[name].lastAlert  = 0;
  if (!state[name].gov)        state[name].gov        = {};
}

// ================= BOT SETUP =================

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// ================= HELPERS =================

function isAuthorized(chatId) {
  return String(chatId) === String(TELEGRAM_CHAT_ID);
}

function authGuard(msg) {
  if (!isAuthorized(msg.chat.id)) {
    bot.sendMessage(msg.chat.id, "⛔ Unauthorized.");
    return false;
  }
  return true;
}

function findChain(name) {
  return chains.find(c => c.name.toLowerCase() === name.toLowerCase());
}

// ================= SEND HELPERS =================

async function sendMsg(chatId, text, opts = {}) {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: "HTML", ...opts });
  } catch (e) {
    console.error("sendMsg error:", e.message);
  }
}

// Broadcast alert to the owner chat
async function alert(text) {
  await sendMsg(TELEGRAM_CHAT_ID, text);
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

    if (syncInfo.catching_up) throw new Error("Node is catching_up");
    if (state[chain.name].lastBlock === latestBlock && latestBlock !== 0)
      throw new Error("Block height not increasing");

    state[chain.name].lastBlock = latestBlock;

    if (state[chain.name].status === "down" || state[chain.name].status === "unknown") {
      await alert(`🟢 <b>${chain.name} RPC RECOVERED</b>\nHeight: <code>${latestBlock}</code>`);
    }

    state[chain.name].status = "up";
    console.log(`[RPC] ${chain.name} OK – block ${latestBlock}`);

  } catch (err) {
    const shouldAlert =
      state[chain.name].status !== "down" ||
      now - state[chain.name].lastAlert > ALERT_COOLDOWN;

    if (shouldAlert) {
      await alert(`🔴 <b>${chain.name} RPC DOWN</b>\nReason: ${err.message}`);
      state[chain.name].lastAlert = now;
    }

    state[chain.name].status = "down";
    console.log(`[RPC] ${chain.name} ERROR – ${err.message}`);
  }
}

// ================= GOVERNANCE CHECK =================

async function checkGovernance(chain) {
  if (!chain.rest) return;
  initChainState(chain.name);

  let proposals = [];

  try {
    const res = await axios.get(
      `${chain.rest}/cosmos/gov/v1/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD`,
      { timeout: 8000 }
    );
    proposals = res.data?.proposals || [];
  } catch {
    try {
      const res = await axios.get(
        `${chain.rest}/cosmos/gov/v1beta1/proposals?proposal_status=2`,
        { timeout: 8000 }
      );
      proposals = res.data?.proposals || [];
    } catch {
      console.log(`[GOV] ${chain.name} – governance endpoint not available`);
      return;
    }
  }

  console.log(`[GOV] ${chain.name} – ${proposals.length} active proposal(s)`);

  for (const proposal of proposals) {
    const id = String(proposal.id || "");
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
      state[chain.name].gov[id] = { alertedNew: false, alertedEnding: false };
    }

    if (!state[chain.name].gov[id].alertedNew) {
      const endStr = new Date(votingEndRaw).toUTCString();
      await alert(
        `🗳️ <b>New Proposal – ${chain.name}</b>\n` +
        `ID: <code>${id}</code>\n` +
        `Title: ${title}\n` +
        `Voting ends: ${endStr}`
      );
      state[chain.name].gov[id].alertedNew = true;
    }

    const hoursLeft = (votingEnd - now) / (1000 * 60 * 60);
    if (hoursLeft > 0 && hoursLeft < 24 && !state[chain.name].gov[id].alertedEnding) {
      await alert(
        `⏰ <b>Proposal Ending Soon – ${chain.name}</b>\n` +
        `ID: <code>${id}</code>\n` +
        `Title: ${title}\n` +
        `Less than 24h remaining!`
      );
      state[chain.name].gov[id].alertedEnding = true;
    }
  }
}

// ================= MONITOR LOOPS =================

async function runRPCMonitor() {
  for (const chain of chains) await checkRPC(chain);
  saveState();
}

async function runGovMonitor() {
  for (const chain of chains) await checkGovernance(chain);
  saveState();
}

// ================= BOT COMMANDS =================

/**
 * /add <Name> <rpc_url> <rest_url>
 * Example: /add Atomone https://rpc-atomone.example.com https://api-atomone.example.com
 */
bot.onText(/\/add (.+)/, async (msg, match) => {
  if (!authGuard(msg)) return;

  const parts = match[1].trim().split(/\s+/);
  if (parts.length < 3) {
    return sendMsg(msg.chat.id,
      "❌ Usage: <code>/add &lt;Name&gt; &lt;rpc_url&gt; &lt;rest_url&gt;</code>\n\n" +
      "Example:\n<code>/add Atomone https://rpc.example.com https://api.example.com</code>"
    );
  }

  const [name, rpc, rest] = parts;

  if (findChain(name)) {
    return sendMsg(msg.chat.id, `⚠️ Chain <b>${name}</b> already exists. Use /list to see all chains.`);
  }

  // Quick RPC validation
  await sendMsg(msg.chat.id, `🔍 Validating RPC for <b>${name}</b>...`);
  try {
    await axios.get(`${rpc}/status`, { timeout: 5000 });
  } catch (e) {
    return sendMsg(msg.chat.id,
      `❌ Cannot reach RPC: <code>${rpc}/status</code>\nError: ${e.message}\n\n` +
      `Please check the URL and try again.`
    );
  }

  chains.push({ name, rpc, rest });
  saveChains();

  initChainState(name);
  saveState();

  await sendMsg(msg.chat.id,
    `✅ <b>${name}</b> added successfully!\n\n` +
    `🔗 RPC: <code>${rpc}</code>\n` +
    `🌐 REST: <code>${rest}</code>\n\n` +
    `Monitoring started. Use /status to check anytime.`
  );

  // Run immediate check
  await checkRPC({ name, rpc, rest });
  await checkGovernance({ name, rpc, rest });
  saveState();
});

/**
 * /list – show all monitored chains
 */
bot.onText(/\/list/, async (msg) => {
  if (!authGuard(msg)) return;

  if (chains.length === 0) {
    return sendMsg(msg.chat.id,
      "📭 No chains added yet.\n\nUse <code>/add &lt;Name&gt; &lt;rpc_url&gt; &lt;rest_url&gt;</code> to add one."
    );
  }

  const lines = chains.map((c, i) => {
    const s = state[c.name] || {};
    const icon = s.status === "up" ? "🟢" : s.status === "down" ? "🔴" : "⚪";
    return (
      `${i + 1}. ${icon} <b>${c.name}</b>\n` +
      `   RPC: <code>${c.rpc}</code>\n` +
      `   REST: <code>${c.rest}</code>\n` +
      `   Block: <code>${s.lastBlock || "N/A"}</code>`
    );
  });

  await sendMsg(msg.chat.id,
    `📋 <b>Monitored Chains (${chains.length})</b>\n\n` + lines.join("\n\n")
  );
});

/**
 * /status [name] – check status of all chains or a specific one
 */
bot.onText(/\/status(?:\s+(.+))?/, async (msg, match) => {
  if (!authGuard(msg)) return;

  const targetName = match[1]?.trim();

  const targets = targetName
    ? chains.filter(c => c.name.toLowerCase().includes(targetName.toLowerCase()))
    : chains;

  if (targets.length === 0) {
    return sendMsg(msg.chat.id,
      targetName
        ? `❌ No chain found matching "<b>${targetName}</b>".`
        : "📭 No chains added yet. Use /add to start."
    );
  }

  await sendMsg(msg.chat.id, `🔄 Checking ${targets.length} chain(s)...`);

  for (const chain of targets) await checkRPC(chain);
  saveState();

  const lines = targets.map(c => {
    const s = state[c.name] || {};
    const icon = s.status === "up" ? "🟢" : s.status === "down" ? "🔴" : "⚪";
    const govCount = Object.keys(s.gov || {}).length;
    return (
      `${icon} <b>${c.name}</b>\n` +
      `   Status: ${s.status || "unknown"}\n` +
      `   Block: <code>${s.lastBlock || "N/A"}</code>\n` +
      `   Active proposals tracked: ${govCount}`
    );
  });

  await sendMsg(msg.chat.id,
    `📊 <b>Status Report</b>\n\n` + lines.join("\n\n")
  );
});

/**
 * /delete <Name> – remove a chain
 */
bot.onText(/\/delete (.+)/, async (msg, match) => {
  if (!authGuard(msg)) return;

  const name = match[1].trim();
  const chain = findChain(name);

  if (!chain) {
    return sendMsg(msg.chat.id,
      `❌ Chain "<b>${name}</b>" not found. Use /list to see all chains.`
    );
  }

  // Inline keyboard for confirmation
  await bot.sendMessage(msg.chat.id,
    `⚠️ Are you sure you want to delete <b>${chain.name}</b>?\n` +
    `This will remove all monitoring and state data.`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Yes, delete", callback_data: `confirm_delete:${chain.name}` },
          { text: "❌ Cancel",      callback_data: `cancel_delete:${chain.name}` }
        ]]
      }
    }
  );
});

// Handle inline button callbacks
bot.on("callback_query", async (query) => {
  if (!isAuthorized(query.message.chat.id)) return;

  const [action, chainName] = query.data.split(":");

  if (action === "confirm_delete") {
    const before = chains.length;
    chains = chains.filter(c => c.name !== chainName);

    if (chains.length < before) {
      delete state[chainName];
      saveChains();
      saveState();
      await bot.editMessageText(
        `🗑️ <b>${chainName}</b> has been removed from monitoring.`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" }
      );
    } else {
      await bot.editMessageText(
        `❌ Chain not found (may have already been deleted).`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" }
      );
    }
  }

  if (action === "cancel_delete") {
    await bot.editMessageText(
      `↩️ Deletion of <b>${chainName}</b> cancelled.`,
      { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" }
    );
  }

  await bot.answerCallbackQuery(query.id);
});

/**
 * /help – show available commands
 */
bot.onText(/\/help|\/start/, async (msg) => {
  if (!authGuard(msg)) return;

  await sendMsg(msg.chat.id,
    `🤖 <b>Cosmos Monitor Bot</b>\n\n` +
    `<b>Commands:</b>\n\n` +
    `➕ /add &lt;Name&gt; &lt;rpc_url&gt; &lt;rest_url&gt;\n` +
    `   Add a chain to monitor\n\n` +
    `📋 /list\n` +
    `   Show all monitored chains\n\n` +
    `📊 /status [name]\n` +
    `   Check status (all or specific chain)\n\n` +
    `🗑️ /delete &lt;Name&gt;\n` +
    `   Remove a chain from monitoring\n\n` +
    `<b>Automatic alerts:</b>\n` +
    `• 🔴 RPC down / 🟢 Recovered\n` +
    `• 🗳️ New governance proposal\n` +
    `• ⏰ Proposal ending in &lt;24h\n\n` +
    `RPC checked every <b>60s</b> · Governance every <b>30min</b>`
  );
});

// ================= START =================

console.log("🚀 Cosmos Monitor Bot starting...");
console.log(`📡 Monitoring ${chains.length} chain(s) from chains.json`);

// Initial run
if (chains.length > 0) {
  runRPCMonitor();
  runGovMonitor();
}

setInterval(runRPCMonitor, RPC_INTERVAL);
setInterval(runGovMonitor, GOV_INTERVAL);

bot.on("polling_error", (err) => console.error("Polling error:", err.message));

console.log("✅ Bot is running and listening for commands.");
