const TelegramBot  = require("node-telegram-bot-api");
const axios        = require("axios");
const fs           = require("fs");
const path         = require("path");
const crypto       = require("crypto");

// CosmJS — loaded lazily to avoid startup crash if not yet installed
let cosmjsLoaded = false;
let SigningStargateClient, DirectSecp256k1HdWallet, coins;

async function loadCosmJS() {
  if (cosmjsLoaded) return true;
  try {
    ({ SigningStargateClient }    = require("@cosmjs/stargate"));
    ({ DirectSecp256k1HdWallet } = require("@cosmjs/proto-signing"));
    ({ coins }                   = require("@cosmjs/amino"));
    cosmjsLoaded = true;
    return true;
  } catch {
    return false;
  }
}

// ================= CONFIG =================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || "YOUR_CHAT_ID_HERE";

// Encryption key for mnemonic storage (32-char string → 256-bit AES key)
// Set via env var or leave default (change this to something secret!)
const ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || "cosmos-bot-secret-key-change-me!";

const RPC_INTERVAL         = 60_000;    // 60 sec
const GOV_INTERVAL         = 1_800_000; // 30 min
const ALERT_COOLDOWN       = 600_000;   // 10 min
const UPGRADE_ALERT_BLOCKS = 100;       // alert when this many blocks remain

const CHAINS_FILE = path.join(__dirname, "chains.json");
const STATE_FILE  = path.join(__dirname, "state.json");

// ================= ENCRYPTION =================
// Mnemonics are AES-256-GCM encrypted before writing to chains.json

function encrypt(text) {
  const iv  = crypto.randomBytes(12);
  const key = crypto.scryptSync(ENCRYPT_SECRET, "cosmos-salt", 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(payload) {
  const [ivHex, tagHex, encHex] = payload.split(":");
  const key = crypto.scryptSync(ENCRYPT_SECRET, "cosmos-salt", 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(encHex, "hex")) + decipher.final("utf8");
}

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
// chains: [{ name, rpc, rest, prefix?, denom?, gasPrice?, voter?, mnemonic_enc? }]

let state = loadJSON(STATE_FILE, {});
// state: { [chainName]: { status, lastBlock, lastAlert, gov:{}, upgrade:null } }

function saveChains() { saveJSON(CHAINS_FILE, chains); }
function saveState()  { saveJSON(STATE_FILE,  state);  }

function initChainState(name) {
  if (!state[name])           state[name]             = {};
  if (!state[name].status)    state[name].status      = "unknown";
  if (!state[name].lastBlock) state[name].lastBlock   = 0;
  if (!state[name].lastAlert) state[name].lastAlert   = 0;
  if (!state[name].gov)       state[name].gov         = {};
  if (!state[name].upgrade === undefined) state[name].upgrade = null;
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

// Map human vote option → cosmos VoteOption integer
const VOTE_OPTIONS = {
  yes:     1,
  abstain: 2,
  no:      3,
  veto:    4,
  nowithveto: 4,
};

// ================= SEND HELPERS =================

async function sendMsg(chatId, text, opts = {}) {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: "HTML", ...opts });
  } catch (e) {
    console.error("sendMsg error:", e.message);
  }
}

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
        `Voting ends: ${endStr}\n\n` +
        (chain.mnemonic_enc
          ? `💡 Vote with: /vote ${chain.name} ${id} yes|no|abstain|veto`
          : `💡 Add a key with /addkey to vote from bot`)
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

// ================= UPGRADE CHECK =================

async function checkUpgrade(chain) {
  if (!chain.rest) return;
  initChainState(chain.name);

  const currentBlock = state[chain.name].lastBlock || 0;

  let plan = null;
  try {
    const res = await axios.get(
      `${chain.rest}/cosmos/upgrade/v1beta1/current_plan`,
      { timeout: 8000 }
    );
    plan = res.data?.plan || null;
  } catch (err) {
    console.log(`[UPGRADE] ${chain.name} – endpoint error: ${err.message}`);
    return;
  }

  if (!plan || !plan.height) {
    const prev = state[chain.name].upgrade;
    if (prev && !prev.alertedDone) {
      await alert(
        `✅ <b>Upgrade Complete – ${chain.name}</b>\n` +
        `Name: <b>${prev.name}</b>\n` +
        `Height: <code>${prev.height}</code>\n` +
        `Chain is running the new version.`
      );
      state[chain.name].upgrade = { ...prev, alertedDone: true };
    }
    return;
  }

  const upgradeHeight = parseInt(plan.height);
  const upgradeName   = plan.name || "unknown";
  const blocksLeft    = upgradeHeight - currentBlock;

  console.log(`[UPGRADE] ${chain.name} – "${upgradeName}" at ${upgradeHeight}, ${blocksLeft} left`);

  const prev = state[chain.name].upgrade;
  if (!prev || prev.height !== upgradeHeight || prev.name !== upgradeName) {
    state[chain.name].upgrade = {
      name: upgradeName, height: upgradeHeight,
      alertedDetected: false, alerted100: false, alertedImminent: false, alertedDone: false,
    };
  }

  const upg = state[chain.name].upgrade;

  if (!upg.alertedDetected) {
    const eta = currentBlock > 0
      ? `~${Math.round(blocksLeft * 6 / 60)} min (6s/block est.)` : "unknown";
    await alert(
      `🆙 <b>Upgrade Detected – ${chain.name}</b>\n` +
      `Name: <b>${upgradeName}</b>\n` +
      `Upgrade height: <code>${upgradeHeight}</code>\n` +
      `Current block: <code>${currentBlock}</code>\n` +
      `Blocks remaining: <code>${blocksLeft}</code>\n` +
      `ETA: ${eta}`
    );
    upg.alertedDetected = true;
  }

  if (!upg.alerted100 && blocksLeft > 0 && blocksLeft <= UPGRADE_ALERT_BLOCKS) {
    await alert(
      `⚠️ <b>Upgrade in ${blocksLeft} Blocks – ${chain.name}</b>\n` +
      `Name: <b>${upgradeName}</b>\n` +
      `Upgrade at: <code>${upgradeHeight}</code>\n` +
      `Current: <code>${currentBlock}</code>\n\n` +
      `🔧 Make sure your node binary is ready!`
    );
    upg.alerted100 = true;
  }

  if (upg.alerted100 && !upg.alertedImminent && blocksLeft > 0 && blocksLeft <= 10) {
    await alert(
      `🚨 <b>UPGRADE IMMINENT – ${chain.name}</b>\n` +
      `Name: <b>${upgradeName}</b>\n` +
      `Only <b>${blocksLeft} block(s)</b> remaining!\n` +
      `Upgrade at: <code>${upgradeHeight}</code>`
    );
    upg.alertedImminent = true;
  }
}

// ================= VOTE TX =================

/**
 * Broadcast a MsgVote transaction on behalf of the stored wallet.
 * Returns { txHash, success, error }
 */
async function broadcastVote(chain, proposalId, voteOption) {
  if (!await loadCosmJS()) {
    return { success: false, error: "CosmJS not installed. Run: npm install @cosmjs/stargate @cosmjs/proto-signing @cosmjs/amino" };
  }

  if (!chain.mnemonic_enc) {
    return { success: false, error: "No key registered for this chain. Use /addkey first." };
  }

  let mnemonic;
  try {
    mnemonic = decrypt(chain.mnemonic_enc);
  } catch {
    return { success: false, error: "Failed to decrypt stored mnemonic. Check ENCRYPT_SECRET." };
  }

  // Defaults — can be overridden per chain in chains.json
  const prefix   = chain.prefix   || "cosmos";
  const denom    = chain.denom    || "uatom";
  const gasPrice = chain.gasPrice || `0.025${denom}`;

  try {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix });
    const [account] = await wallet.getAccounts();

    const client = await SigningStargateClient.connectWithSigner(chain.rpc, wallet, {
      gasPrice: { amount: gasPrice.replace(/[^0-9.]/g, ""), denom },
    });

    const voteMsg = {
      typeUrl: "/cosmos.gov.v1beta1.MsgVote",
      value: {
        proposalId: BigInt(proposalId),
        voter:      account.address,
        option:     voteOption,
      },
    };

    const result = await client.signAndBroadcast(
      account.address,
      [voteMsg],
      "auto",
      `Voted via Cosmos Monitor Bot`
    );

    if (result.code !== 0) {
      return { success: false, error: `Tx failed (code ${result.code}): ${result.rawLog}` };
    }

    return { success: true, txHash: result.transactionHash, voter: account.address };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ================= MONITOR LOOPS =================

async function runRPCMonitor() {
  for (const chain of chains) {
    await checkRPC(chain);
    await checkUpgrade(chain);
  }
  saveState();
}

async function runGovMonitor() {
  for (const chain of chains) await checkGovernance(chain);
  saveState();
}

// ================= BOT COMMANDS =================

// ── /add ──────────────────────────────────────────────────────────────────────
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
    `Monitoring started. Use /status to check anytime.\n` +
    `💡 Add a wallet key with /addkey to enable voting.`
  );

  await checkRPC({ name, rpc, rest });
  await checkUpgrade({ name, rpc, rest });
  await checkGovernance({ name, rpc, rest });
  saveState();
});

// ── /addkey ───────────────────────────────────────────────────────────────────
// Usage: /addkey <ChainName> <bech32_prefix> <denom> <gas_price> <mnemonic words...>
// Example: /addkey Atomone cosmos uatom 0.025uatom word1 word2 ... word24
bot.onText(/\/addkey (.+)/, async (msg, match) => {
  if (!authGuard(msg)) return;

  // Delete the user's message immediately to protect the mnemonic
  try { await bot.deleteMessage(msg.chat.id, msg.message_id); } catch {}

  const parts = match[1].trim().split(/\s+/);
  if (parts.length < 6) {
    return sendMsg(msg.chat.id,
      "❌ Usage:\n" +
      "<code>/addkey &lt;Name&gt; &lt;prefix&gt; &lt;denom&gt; &lt;gasPrice&gt; &lt;mnemonic...&gt;</code>\n\n" +
      "Example:\n" +
      "<code>/addkey Atomone cosmos uatom 0.025uatom word1 word2 ... word24</code>\n\n" +
      "⚠️ Your message was deleted to protect your mnemonic."
    );
  }

  const [name, prefix, denom, gasPrice, ...mnemonicWords] = parts;
  const mnemonic = mnemonicWords.join(" ");

  const chain = findChain(name);
  if (!chain) {
    return sendMsg(msg.chat.id,
      `❌ Chain "<b>${name}</b>" not found. Add it first with /add.`
    );
  }

  // Validate mnemonic by deriving address
  if (!await loadCosmJS()) {
    return sendMsg(msg.chat.id,
      "❌ CosmJS not installed.\nRun: <code>npm install @cosmjs/stargate @cosmjs/proto-signing @cosmjs/amino</code>"
    );
  }

  let voterAddress;
  try {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix });
    const [account] = await wallet.getAccounts();
    voterAddress = account.address;
  } catch (err) {
    return sendMsg(msg.chat.id, `❌ Invalid mnemonic: ${err.message}`);
  }

  // Encrypt and store
  const encrypted = encrypt(mnemonic);
  const idx = chains.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
  chains[idx].mnemonic_enc = encrypted;
  chains[idx].voter        = voterAddress;
  chains[idx].prefix       = prefix;
  chains[idx].denom        = denom;
  chains[idx].gasPrice     = gasPrice;
  saveChains();

  await sendMsg(msg.chat.id,
    `🔐 <b>Key registered for ${name}</b>\n\n` +
    `Address: <code>${voterAddress}</code>\n` +
    `Prefix: <code>${prefix}</code>\n` +
    `Denom: <code>${denom}</code>\n` +
    `Gas price: <code>${gasPrice}</code>\n\n` +
    `✅ Mnemonic encrypted and saved.\n` +
    `You can now use: <code>/vote ${name} &lt;proposal_id&gt; yes|no|abstain|veto</code>`
  );
});

// ── /removekey ────────────────────────────────────────────────────────────────
bot.onText(/\/removekey (.+)/, async (msg, match) => {
  if (!authGuard(msg)) return;

  const name  = match[1].trim();
  const chain = findChain(name);

  if (!chain) {
    return sendMsg(msg.chat.id, `❌ Chain "<b>${name}</b>" not found.`);
  }

  if (!chain.mnemonic_enc) {
    return sendMsg(msg.chat.id, `⚠️ No key is registered for <b>${name}</b>.`);
  }

  await bot.sendMessage(msg.chat.id,
    `⚠️ Remove the stored key for <b>${chain.name}</b>?\n` +
    `Voter: <code>${chain.voter || "unknown"}</code>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Yes, remove key", callback_data: `confirm_removekey:${chain.name}` },
          { text: "❌ Cancel",          callback_data: `cancel_removekey:${chain.name}` }
        ]]
      }
    }
  );
});

// ── /vote ─────────────────────────────────────────────────────────────────────
// Usage: /vote <ChainName> <proposal_id> <yes|no|abstain|veto>
bot.onText(/\/vote (.+)/, async (msg, match) => {
  if (!authGuard(msg)) return;

  const parts = match[1].trim().split(/\s+/);
  if (parts.length < 3) {
    return sendMsg(msg.chat.id,
      "❌ Usage: <code>/vote &lt;Name&gt; &lt;proposal_id&gt; &lt;yes|no|abstain|veto&gt;</code>\n\n" +
      "Example: <code>/vote Atomone 5 yes</code>"
    );
  }

  const [name, proposalId, voteInput] = parts;
  const voteKey = voteInput.toLowerCase().replace(/\s/g, "");
  const voteOption = VOTE_OPTIONS[voteKey];

  if (!voteOption) {
    return sendMsg(msg.chat.id,
      `❌ Invalid vote option: <b>${voteInput}</b>\n` +
      `Valid options: <code>yes</code> · <code>no</code> · <code>abstain</code> · <code>veto</code>`
    );
  }

  const chain = findChain(name);
  if (!chain) {
    return sendMsg(msg.chat.id, `❌ Chain "<b>${name}</b>" not found. Use /list to see chains.`);
  }

  if (!chain.mnemonic_enc) {
    return sendMsg(msg.chat.id,
      `❌ No wallet key for <b>${name}</b>.\n` +
      `Register one with /addkey first.`
    );
  }

  // Confirm before broadcasting
  const voteLabels = { 1: "✅ YES", 2: "🟡 ABSTAIN", 3: "❌ NO", 4: "🚫 VETO" };
  await bot.sendMessage(msg.chat.id,
    `🗳️ <b>Confirm Vote</b>\n\n` +
    `Chain: <b>${chain.name}</b>\n` +
    `Proposal ID: <code>${proposalId}</code>\n` +
    `Vote: <b>${voteLabels[voteOption]}</b>\n` +
    `Voter: <code>${chain.voter || "stored wallet"}</code>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Confirm & Broadcast", callback_data: `confirm_vote:${name}:${proposalId}:${voteOption}` },
          { text: "❌ Cancel",              callback_data: `cancel_vote:${name}` }
        ]]
      }
    }
  );
});

// ── /mykeys ───────────────────────────────────────────────────────────────────
bot.onText(/\/mykeys/, async (msg) => {
  if (!authGuard(msg)) return;

  const keyed = chains.filter(c => c.mnemonic_enc);
  if (keyed.length === 0) {
    return sendMsg(msg.chat.id,
      "🔑 No keys registered yet.\n\nUse /addkey to add a wallet for voting."
    );
  }

  const lines = keyed.map(c =>
    `🔐 <b>${c.name}</b>\n` +
    `   Address: <code>${c.voter || "unknown"}</code>\n` +
    `   Prefix: <code>${c.prefix}</code>  Denom: <code>${c.denom}</code>  Gas: <code>${c.gasPrice}</code>`
  );

  await sendMsg(msg.chat.id,
    `🔑 <b>Registered Voting Keys (${keyed.length})</b>\n\n` + lines.join("\n\n")
  );
});

// ── /list ─────────────────────────────────────────────────────────────────────
bot.onText(/\/list/, async (msg) => {
  if (!authGuard(msg)) return;

  if (chains.length === 0) {
    return sendMsg(msg.chat.id,
      "📭 No chains added yet.\n\nUse <code>/add &lt;Name&gt; &lt;rpc_url&gt; &lt;rest_url&gt;</code> to add one."
    );
  }

  const lines = chains.map((c, i) => {
    const s    = state[c.name] || {};
    const icon = s.status === "up" ? "🟢" : s.status === "down" ? "🔴" : "⚪";
    const key  = c.mnemonic_enc ? ` 🔐` : "";
    return (
      `${i + 1}. ${icon} <b>${c.name}</b>${key}\n` +
      `   RPC:  <code>${c.rpc}</code>\n` +
      `   REST: <code>${c.rest}</code>\n` +
      `   Block: <code>${s.lastBlock || "N/A"}</code>`
    );
  });

  await sendMsg(msg.chat.id,
    `📋 <b>Monitored Chains (${chains.length})</b>\n` +
    `🔐 = voting key registered\n\n` +
    lines.join("\n\n")
  );
});

// ── /status ───────────────────────────────────────────────────────────────────
bot.onText(/\/status(?:\s+(.+))?/, async (msg, match) => {
  if (!authGuard(msg)) return;

  const targetName = match[1]?.trim();
  const targets    = targetName
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
    const s        = state[c.name] || {};
    const icon     = s.status === "up" ? "🟢" : s.status === "down" ? "🔴" : "⚪";
    const govCount = Object.keys(s.gov || {}).length;
    const upg      = s.upgrade;
    const upgLine  = upg && !upg.alertedDone
      ? `\n   🆙 Upgrade <b>${upg.name}</b> at <code>${upg.height}</code> ` +
        `(${Math.max(0, upg.height - (s.lastBlock || 0))} blocks left)`
      : "";
    const keyLine  = c.mnemonic_enc
      ? `\n   🔐 Voter: <code>${c.voter}</code>`
      : `\n   🔑 No voting key (use /addkey)`;
    return (
      `${icon} <b>${c.name}</b>\n` +
      `   Status: ${s.status || "unknown"}\n` +
      `   Block: <code>${s.lastBlock || "N/A"}</code>\n` +
      `   Active proposals tracked: ${govCount}` +
      upgLine + keyLine
    );
  });

  await sendMsg(msg.chat.id, `📊 <b>Status Report</b>\n\n` + lines.join("\n\n"));
});

// ── /delete ───────────────────────────────────────────────────────────────────
bot.onText(/\/delete (.+)/, async (msg, match) => {
  if (!authGuard(msg)) return;

  const name  = match[1].trim();
  const chain = findChain(name);

  if (!chain) {
    return sendMsg(msg.chat.id, `❌ Chain "<b>${name}</b>" not found. Use /list to see all chains.`);
  }

  await bot.sendMessage(msg.chat.id,
    `⚠️ Are you sure you want to delete <b>${chain.name}</b>?\n` +
    `This will remove all monitoring, state, and key data.`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Yes, delete", callback_data: `confirm_delete:${chain.name}` },
          { text: "❌ Cancel",      callback_data: `cancel_delete:${chain.name}`  }
        ]]
      }
    }
  );
});

// ── /help ─────────────────────────────────────────────────────────────────────
bot.onText(/\/help|\/start/, async (msg) => {
  if (!authGuard(msg)) return;

  await sendMsg(msg.chat.id,
    `🤖 <b>Cosmos Monitor Bot</b>\n\n` +

    `<b>── Chain Management ──</b>\n` +
    `➕ /add &lt;Name&gt; &lt;rpc&gt; &lt;rest&gt;\n` +
    `📋 /list\n` +
    `📊 /status [name]\n` +
    `🗑️ /delete &lt;Name&gt;\n\n` +

    `<b>── Voting Keys ──</b>\n` +
    `🔐 /addkey &lt;Name&gt; &lt;prefix&gt; &lt;denom&gt; &lt;gasPrice&gt; &lt;mnemonic&gt;\n` +
    `🔑 /mykeys\n` +
    `🗝️ /removekey &lt;Name&gt;\n\n` +

    `<b>── Governance Voting ──</b>\n` +
    `🗳️ /vote &lt;Name&gt; &lt;proposal_id&gt; &lt;yes|no|abstain|veto&gt;\n\n` +

    `<b>── Auto Alerts ──</b>\n` +
    `• 🔴 RPC down / 🟢 Recovered\n` +
    `• 🗳️ New governance proposal\n` +
    `• ⏰ Proposal ending in &lt;24h\n` +
    `• 🆙 Chain upgrade detected\n` +
    `• ⚠️ Upgrade in 100 blocks\n` +
    `• 🚨 Upgrade in 10 blocks\n` +
    `• ✅ Upgrade complete\n\n` +

    `RPC/upgrade checked every <b>60s</b> · Governance every <b>30min</b>`
  );
});

// ================= CALLBACK QUERY HANDLER =================

bot.on("callback_query", async (query) => {
  if (!isAuthorized(query.message.chat.id)) return;

  const parts      = query.data.split(":");
  const action     = parts[0];
  const chainName  = parts[1];

  // ── Confirm vote ────────────────────────────────────────────────────────────
  if (action === "confirm_vote") {
    const [, name, proposalId, voteOptionStr] = parts;
    const voteOption = parseInt(voteOptionStr);
    const chain      = findChain(name);
    const voteLabels = { 1: "YES", 2: "ABSTAIN", 3: "NO", 4: "VETO" };

    await bot.editMessageText(
      `⏳ Broadcasting vote <b>${voteLabels[voteOption]}</b> on proposal <code>${proposalId}</code> for <b>${name}</b>...`,
      { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" }
    );

    const result = await broadcastVote(chain, proposalId, voteOption);

    if (result.success) {
      await bot.editMessageText(
        `✅ <b>Vote Submitted!</b>\n\n` +
        `Chain: <b>${name}</b>\n` +
        `Proposal: <code>${proposalId}</code>\n` +
        `Vote: <b>${voteLabels[voteOption]}</b>\n` +
        `Voter: <code>${result.voter}</code>\n` +
        `Tx Hash: <code>${result.txHash}</code>`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" }
      );
    } else {
      await bot.editMessageText(
        `❌ <b>Vote Failed</b>\n\nError: ${result.error}`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" }
      );
    }
  }

  // ── Cancel vote ─────────────────────────────────────────────────────────────
  if (action === "cancel_vote") {
    await bot.editMessageText(
      `↩️ Vote cancelled.`,
      { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" }
    );
  }

  // ── Confirm delete chain ─────────────────────────────────────────────────────
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

  // ── Cancel delete chain ──────────────────────────────────────────────────────
  if (action === "cancel_delete") {
    await bot.editMessageText(
      `↩️ Deletion of <b>${chainName}</b> cancelled.`,
      { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" }
    );
  }

  // ── Confirm remove key ───────────────────────────────────────────────────────
  if (action === "confirm_removekey") {
    const idx = chains.findIndex(c => c.name === chainName);
    if (idx !== -1) {
      delete chains[idx].mnemonic_enc;
      delete chains[idx].voter;
      saveChains();
      await bot.editMessageText(
        `🗝️ Voting key for <b>${chainName}</b> has been removed.`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" }
      );
    }
  }

  // ── Cancel remove key ────────────────────────────────────────────────────────
  if (action === "cancel_removekey") {
    await bot.editMessageText(
      `↩️ Key removal for <b>${chainName}</b> cancelled.`,
      { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" }
    );
  }

  await bot.answerCallbackQuery(query.id);
});

// ================= START =================

console.log("🚀 Cosmos Monitor Bot starting...");
console.log(`📡 Monitoring ${chains.length} chain(s) from chains.json`);

if (chains.length > 0) {
  runRPCMonitor();
  runGovMonitor();
}

setInterval(runRPCMonitor, RPC_INTERVAL);
setInterval(runGovMonitor, GOV_INTERVAL);

bot.on("polling_error", (err) => console.error("Polling error:", err.message));

console.log("✅ Bot is running and listening for commands.");
