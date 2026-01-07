!!! warning "Only work if keyring-backend using `file` or `test`. For mainnet production, it is recomended to use `file`"

### Optional
#### Wallet using keyring-backend = file
```bash
# Create wallet
atomoned keys add wallet --keyring-backend

# Recovery
atomoned keys add wallet --keyring-backend --recovery
```
#### Create .keypass file for password authentication
```bash
cd $HOME
echo "yourpassword" >> .keypass
```
!!! info "Auto Compound Cosmos Network Validator"

### Default Script for claiming commission ex. Atomone
```bash
#!/usr/bin/env bash
set -euo pipefail

# ================= CONFIG =================
CHAIN_ID="atomone-1"
VALIDATOR_ADDRESS="atonevaloper1uuqu7tmepex365vq2pluf25jqvutk8rrq5jvm0"
KEY_NAME="wallet"
KEYRING_BACKEND="file"
DENOM="uatone"
MIN_RESTAKE_AMOUNT=100000   # 0.1 ATONE
CLI="/home/dnsarz/go/bin/atomoned"
JQ="/usr/bin/jq"
FEES="50000uphoton"
GAS_ADJUSTMENT="1.5"
KEYPASS_FILE="$HOME/.keypass"   # password file (chmod 600)
# ==========================================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

fail() {
    log "[ERROR] $*"
    exit 1
}

# =============== CHECK DEPS ===============
command -v "$CLI" >/dev/null || fail "CLI binary not found"
command -v "$JQ" >/dev/null || fail "jq not found"
[ -f "$KEYPASS_FILE" ] || fail "Key password file missing"
# ==========================================

log "Querying validator commission..."

REWARDS_JSON=$($CLI query distribution commission "$VALIDATOR_ADDRESS" -o json 2>/dev/null) \
    || fail "Failed to query commission"

REWARDS=$(
    echo "$REWARDS_JSON" | $JQ -r --arg denom "$DENOM" '
        .commission[]
        | select(.denom == $denom)
        | (.amount | tonumber | floor)
    ' || echo 0
)

REWARDS=${REWARDS:-0}

log "Available commission: $REWARDS $DENOM"

# =============== THRESHOLD ================
if (( REWARDS < MIN_RESTAKE_AMOUNT )); then
    log "Below threshold ($MIN_RESTAKE_AMOUNT). Exiting."
    exit 0
fi
# ==========================================

log "Withdrawing commission..."

WITHDRAW_OUTPUT=$(echo "$(cat "$KEYPASS_FILE")" | \
$CLI tx distribution withdraw-rewards "$VALIDATOR_ADDRESS" \
    --commission \
    --from "$KEY_NAME" \
    --chain-id "$CHAIN_ID" \
    --fees "$FEES" \
    --gas-adjustment "$GAS_ADJUSTMENT" \
    --keyring-backend "$KEYRING_BACKEND" \
    --yes -o json 2>&1) || fail "Withdraw tx failed"

TX_HASH=$(echo "$WITHDRAW_OUTPUT" | $JQ -r '.txhash')

[ -n "$TX_HASH" ] || fail "Failed to extract tx hash"

log "Withdraw tx sent: $TX_HASH"

# =============== WAIT TX ===================
log "Waiting for inclusion..."
for _ in {1..20}; do
    sleep 5
    HEIGHT=$($CLI query tx "$TX_HASH" -o json 2>/dev/null | $JQ -r '.height // 0')
    [[ "$HEIGHT" != "0" ]] && break
done

[[ "$HEIGHT" != "0" ]] || fail "Tx not included after timeout"

log "Withdraw confirmed at height $HEIGHT"
log "Auto-compound step completed"
```

### AutoCompound Script
```bash
#!/usr/bin/env bash
set -euo pipefail

# ================= CONFIG =================
CHAIN_ID="cosmoshub-4"
VALIDATOR_ADDRESS="cosmos1..."            # Your wallet address
DELEGATOR_ADDRESS="cosmosvaloper1..."     # Your validator address
KEY_NAME="wallet"
KEYRING_BACKEND="file"
DENOM="uatom"
MIN_RESTAKE_AMOUNT=1000000       # minimum commission to act
FEE_BUFFER=1000000               # keep for future tx fees
CLI="/home/user/go/bin/gaiad"    # binary path
JQ="/usr/bin/jq"
FEES="50000uatom"
GAS_ADJUSTMENT="1.5"
KEYPASS_FILE="$HOME/.keypass"
# ==========================================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

fail() {
    log "[ERROR] $*"
    exit 1
}

# =============== CHECK DEPS ===============
command -v "$CLI" >/dev/null || fail "CLI not found"
command -v "$JQ" >/dev/null || fail "jq not found"
[ -f "$KEYPASS_FILE" ] || fail "Key password file missing"
# ==========================================

# ========== QUERY COMMISSION ==============
log "Querying validator commission..."

REWARDS_JSON=$($CLI query distribution commission "$VALIDATOR_ADDRESS" -o json) \
    || fail "Failed to query commission"

REWARDS=$(
    echo "$REWARDS_JSON" | $JQ -r --arg denom "$DENOM" '
        .commission[]
        | select(.denom == $denom)
        | (.amount | tonumber | floor)
    ' || echo 0
)

REWARDS=${REWARDS:-0}
log "Commission available: $REWARDS $DENOM"

(( REWARDS >= MIN_RESTAKE_AMOUNT )) || {
    log "Below threshold. Exiting."
    exit 0
}

# ========== WITHDRAW COMMISSION ===========
log "Withdrawing commission..."

WITHDRAW_JSON=$(echo "$(cat "$KEYPASS_FILE")" | \
$CLI tx distribution withdraw-rewards "$VALIDATOR_ADDRESS" \
    --commission \
    --from "$KEY_NAME" \
    --chain-id "$CHAIN_ID" \
    --fees "$FEES" \
    --gas-adjustment "$GAS_ADJUSTMENT" \
    --keyring-backend "$KEYRING_BACKEND" \
    --yes -o json) || fail "Withdraw failed"

TX_HASH=$(echo "$WITHDRAW_JSON" | $JQ -r '.txhash')
[ -n "$TX_HASH" ] || fail "No tx hash"

log "Withdraw tx sent: $TX_HASH"

# ========== WAIT FOR TX ===================
log "Waiting for withdraw confirmation..."
for _ in {1..20}; do
    sleep 5
    HEIGHT=$($CLI query tx "$TX_HASH" -o json 2>/dev/null | $JQ -r '.height // 0')
    [[ "$HEIGHT" != "0" ]] && break
done
[[ "$HEIGHT" != "0" ]] || fail "Withdraw tx not confirmed"

log "Withdraw confirmed at height $HEIGHT"

# ========== CHECK BALANCE =================
log "Checking available balance..."

BALANCE=$($CLI query bank balances "$DELEGATOR_ADDRESS" -o json | \
    $JQ -r --arg denom "$DENOM" '
        .balances[]
        | select(.denom == $denom)
        | (.amount | tonumber)
    ' || echo 0)

BALANCE=${BALANCE:-0}
log "Wallet balance: $BALANCE $DENOM"

STAKE_AMOUNT=$(( BALANCE - FEE_BUFFER ))

(( STAKE_AMOUNT >= MIN_RESTAKE_AMOUNT )) || {
    log "Not enough balance to stake after fee buffer. Exiting."
    exit 0
}

log "Staking $STAKE_AMOUNT $DENOM"

# ========== DELEGATE ======================
DELEGATE_JSON=$(echo "$(cat "$KEYPASS_FILE")" | \
$CLI tx staking delegate "$VALIDATOR_ADDRESS" "${STAKE_AMOUNT}${DENOM}" \
    --from "$KEY_NAME" \
    --chain-id "$CHAIN_ID" \
    --fees "$FEES" \
    --gas-adjustment "$GAS_ADJUSTMENT" \
    --keyring-backend "$KEYRING_BACKEND" \
    --yes -o json) || fail "Delegation failed"

DELEGATE_HASH=$(echo "$DELEGATE_JSON" | $JQ -r '.txhash')
log "Delegation tx sent: $DELEGATE_HASH"

log "✅ Auto-compound + staking complete"
```

!!! info "For Lumen Mainnet Cnfigurations"

### Lumen AutoCompound Script

```bash
#!/bin/bash
set -euo pipefail

# ---------- CRON SAFE ENV ----------
export PATH=/usr/local/bin:/usr/bin:/bin:/home/dnsarz/go/bin

# ---------------- CONFIGURATION ----------------
CHAIN_ID="lumen"
DELEGATOR_ADDRESS="lmn1auwxmw3ycas3w3s2qe2n40syca6hrxnhup344g"          # Your wallet address
VALIDATOR_ADDRESS="lmnvaloper1auwxmw3ycas3w3s2qe2n40syca6hrxnhpnc5uk"   # Your validator address
KEY_NAME="wallet"                       # Key name in keyring
KEYRING_BACKEND="test"                  # "os", "file", or "test"
DENOM="ulmn"                            # Token denom (uatom, uosmo, etc.)
GAS="auto"
GAS_ADJUSTMENT="1.5"
MIN_RESTAKE_AMOUNT=1000000              # Minimum amount to restake
CLI_BINARY="/home/dnsarz/go/bin/lumend" # Path to CLI binary (gaiad, osmosisd, etc.)
JQ_BIN="/usr/bin/jq"                    # # Path to JQ
# ------------------------------------------------


echo "[INFO] Starting auto-compound script for $CHAIN_ID"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Checking rewards..."

# ---------------- QUERY REWARDS ----------------
REWARDS_OUTPUT=$($CLI_BINARY query distribution rewards "$DELEGATOR_ADDRESS" -o json 2>/dev/null || true)

if [ -z "$REWARDS_OUTPUT" ]; then
    echo "[ERROR] Failed to query rewards (RPC issue or wrong addresses?)"
    exit 1
fi

REWARDS=$(echo "$REWARDS_OUTPUT" | $JQ_BIN -r --arg denom "$DENOM" '
    .total[]?
    | capture("(?<amount>[0-9.]+)(?<denom>[a-zA-Z0-9]+)")
    | select(.denom == $denom)
    | .amount
    | tonumber
    | floor
' 2>/dev/null || echo 0)

REWARDS=${REWARDS:-0}

echo "[INFO] Current delegator rewards: $REWARDS $DENOM"

# ---------------- CHECK THRESHOLD ----------------
if [ "$REWARDS" -lt "$MIN_RESTAKE_AMOUNT" ]; then
    echo "[INFO] Rewards below threshold ($MIN_RESTAKE_AMOUNT $DENOM), skipping."
    exit 0
fi

echo "[INFO] Threshold reached. Withdrawing rewards..."

# ---------------- WITHDRAW REWARDS ----------------
WITHDRAW_OUTPUT=$($CLI_BINARY tx distribution withdraw-rewards "$VALIDATOR_ADDRESS" \
    --from "$KEY_NAME" \
    --chain-id "$CHAIN_ID" \
    --keyring-backend "$KEYRING_BACKEND" \
    --pqc-key "node-pqc" \
    --pqc-scheme "dilithium3" \
    --gas "$GAS" \
    --gas-adjustment "$GAS_ADJUSTMENT" \
    --fees "0ulmn" \
    --yes 2>&1)

if ! echo "$WITHDRAW_OUTPUT" | grep -q 'code:[[:space:]]*0'; then
    echo "[ERROR] Withdraw failed:"
    echo "$WITHDRAW_OUTPUT"
    exit 1
fi

echo "[SUCCESS] Rewards withdrawn successfully"

# ---------------- WAIT FOR TX ----------------
TX_HASH=$(echo "$WITHDRAW_OUTPUT" | grep -o 'txhash: [A-F0-9]\+' | cut -d' ' -f2)

echo "[INFO] Waiting for withdraw tx to be included..."
for i in {1..20}; do
    sleep 5
    HEIGHT=$($CLI_BINARY query tx "$TX_HASH" -o json 2>/dev/null | $JQ_BIN -r '.height // "0"')
    if [ "$HEIGHT" != "0" ]; then
        echo "[INFO] Withdraw included in block $HEIGHT"
        break
    fi
done

# ---------------- DELEGATE ----------------
echo "[INFO] Redelegating $REWARDS $DENOM..."

DELEGATE_OUTPUT=$($CLI_BINARY tx staking delegate "$VALIDATOR_ADDRESS" "${REWARDS}${DENOM}" \
    --chain-id "$CHAIN_ID" \
    --pqc-key "node-pqc" \
    --pqc-scheme "dilithium3" \
    --gas "$GAS" \
    --gas-adjustment "$GAS_ADJUSTMENT" \
    --gas-prices "0ulmn" \
    --from "$KEY_NAME" \
    --yes 2>&1)

if echo "$DELEGATE_OUTPUT" | grep -q 'code:[[:space:]]*0'; then
    echo "[SUCCESS] Delegation successful! Compounded $REWARDS $DENOM"
else
    echo "[ERROR] Delegation failed:"
    echo "$DELEGATE_OUTPUT"
    exit 1
fi
```
