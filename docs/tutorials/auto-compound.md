!!! info "Auto Compound Cosmos Network Validator"

### Default Script
```bash
#!/bin/bash

# ---------------- CONFIGURATION ----------------
CHAIN_ID="cosmoshub-4"                  # Change to your chain ID
DELEGATOR_ADDRESS="cosmos1..."           # Your wallet address (for querying rewards)
VALIDATOR_ADDRESS="cosmosvaloper1..."    # Your validator address
KEY_NAME="mykey"                        # Key name in keyring
KEYRING_BACKEND="os"                    # "os", "file", or "test"
DENOM="uatom"                           # Token denom (uatom, uosmo, etc.)
GAS="auto"
GAS_ADJUSTMENT="1.2"
INTERVAL_SECONDS=3600                   # How often to run (1 hour)
MIN_RESTAKE_AMOUNT=100000               # Minimum amount to restake (in base denom, e.g., 100000 uatom = 0.1 ATOM)
CLI_BINARY="gaiad"                      # Path to CLI binary (gaiad, osmosisd, etc.)
# ------------------------------------------------

echo "[INFO] Starting auto-compound script for $CHAIN_ID"

while true; do
    echo ""
    echo "[$(date)] Checking rewards..."

    # Fetch rewards (integer part only, like Python script)
    REWARDS_OUTPUT=$($CLI_BINARY query distribution rewards "$DELEGATOR_ADDRESS" --chain-id "$CHAIN_ID" -o json 2>/dev/null)
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to query rewards"
        sleep "$INTERVAL_SECONDS"
        continue
    fi

    REWARDS=$(echo "$REWARDS_OUTPUT" | jq -r --arg denom "$DENOM" '
        .rewards[]? | select(.denom == $denom) | .amount // "0" | floor
    ')

    if [ -z "$REWARDS" ] || [ "$REWARDS" = "null" ]; then
        REWARDS=0
    fi

    echo "[INFO] Current rewards: $REWARDS $DENOM"

    if [ "$REWARDS" -ge "$MIN_RESTAKE_AMOUNT" ]; then
        echo "[INFO] Withdrawing rewards..."
        WITHDRAW_OUTPUT=$($CLI_BINARY tx distribution withdraw-rewards "$VALIDATOR_ADDRESS" \
            --from "$KEY_NAME" \
            --chain-id "$CHAIN_ID" \
            --keyring-backend "$KEYRING_BACKEND" \
            --gas "$GAS" \
            --gas-adjustment "$GAS_ADJUSTMENT" \
            --yes 2>&1)

        if echo "$WITHDRAW_OUTPUT" | grep -q '"code":0'; then
            echo "[SUCCESS] Rewards withdrawn"
        else
            echo "[ERROR] Withdraw failed:"
            echo "$WITHDRAW_OUTPUT"
            sleep "$INTERVAL_SECONDS"
            continue
        fi

        sleep 10  # Wait for transaction to be included

        echo "[INFO] Delegating $REWARDS $DENOM back to validator..."
        DELEGATE_OUTPUT=$($CLI_BINARY tx staking delegate "$VALIDATOR_ADDRESS" "${REWARDS}${DENOM}" \
            --from "$KEY_NAME" \
            --chain-id "$CHAIN_ID" \
            --keyring-backend "$KEYRING_BACKEND" \
            --gas "$GAS" \
            --gas-adjustment "$GAS_ADJUSTMENT" \
            --yes 2>&1)

        if echo "$DELEGATE_OUTPUT" | grep -q '"code":0'; then
            echo "[SUCCESS] Delegation successful"
        else
            echo "[ERROR] Delegation failed:"
            echo "$DELEGATE_OUTPUT"
        fi
    else
        echo "[INFO] Rewards below threshold ($MIN_RESTAKE_AMOUNT $DENOM), skipping."
    fi

    echo "[INFO] Sleeping for $INTERVAL_SECONDS seconds..."
    sleep "$INTERVAL_SECONDS"
done
```

!!! info "For Lumen Mainnet Cnfigurations"

### Lumen AutoCompound Script

```bash
#!/bin/bash
# ---------------- CONFIGURATION ----------------
CHAIN_ID="lumen"                        # Change to your chain ID
DELEGATOR_ADDRESS=""                    # Your wallet address (for querying rewards)
VALIDATOR_ADDRESS=""                    # Your validator address
KEY_NAME="wallet"                       # Key name in keyring
KEYRING_BACKEND="test"                  # "os", "file", or "test"
DENOM="ulmn"                            # Token denom (uatom, uosmo, etc.)
GAS="auto"
GAS_ADJUSTMENT="1.5"
INTERVAL_SECONDS=10                     # How often to run (1 hour)
MIN_RESTAKE_AMOUNT=200000               # Minimum amount to restake (in base denom, e.g., 100000 uatom = 0.1 ATOM)
CLI_BINARY="lumend"                     # Path to CLI binary (gaiad, osmosisd, etc.)
# ------------------------------------------------

echo "[INFO] Starting auto-compound script for $CHAIN_ID"

#while true; do
    echo ""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Checking rewards..."

    # Query rewards specifically from your validator (more accurate and efficient)
    REWARDS_OUTPUT=$($CLI_BINARY query distribution rewards "$DELEGATOR_ADDRESS" -o json 2>/dev/null)

    if [ $? -ne 0 ] || [ -z "$REWARDS_OUTPUT" ]; then
        echo "[ERROR] Failed to query rewards (RPC issue or wrong addresses?)"
        sleep "$INTERVAL_SECONDS"
        continue
    fi

    # Extract integer part of ulmn rewards correctly from .reward[]
    REWARDS=$(echo "$REWARDS_OUTPUT" | jq -r --arg denom "$DENOM" '
        .total[]?
        | capture("(?<amount>[0-9.]+)(?<denom>[a-zA-Z0-9]+)")
        | select(.denom == $denom)
        | .amount
        | tonumber
        | floor // 0
    ' 2>/dev/null)

    # Safety fallback
    if [ -z "$REWARDS" ] || [ "$REWARDS" = "null" ]; then
        REWARDS=0
    fi

    echo "[INFO] Current delegator rewards: $REWARDS $DENOM"

    if [ "$REWARDS" -ge "$MIN_RESTAKE_AMOUNT" ]; then
        echo "[INFO] Threshold reached. Withdrawing rewards + commission..."

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

        # Correct success check: Cosmos CLI outputs "code":0 (no space)
        if echo "$WITHDRAW_OUTPUT" | grep code:[[:space:]]*0; then
            echo "[SUCCESS] Rewards and commission withdrawn successfully"
        else
            echo "[ERROR] Withdraw failed:"
            echo "$WITHDRAW_OUTPUT"
            sleep "$INTERVAL_SECONDS"
            continue
        fi
        sleep 2  # Wait for tx inclusion

        echo "[INFO] Redelegating $REWARDS $DENOM to validator..."

        DELEGATE_OUTPUT=$($CLI_BINARY tx staking delegate "$VALIDATOR_ADDRESS" "${REWARDS}${DENOM}" \
            --from "$KEY_NAME" \
            --chain-id "$CHAIN_ID" \
            --keyring-backend "$KEYRING_BACKEND" \
            --pqc-key "node-pqc" \
            --pqc-scheme "dilithium3" \
            --gas "$GAS" \
            --gas-adjustment "$GAS_ADJUSTMENT" \
            --gas-prices "0ulmn" \
            --yes 2>&1)

        if echo "$DELEGATE_OUTPUT" | grep code:[[:space:]]*0; then
            echo "[SUCCESS] Delegation successful! Compounded $REWARDS $DENOM"
        else
            echo "[ERROR] Delegation failed:"
            echo "$DELEGATE_OUTPUT" | grep -i "raw_log" || echo "$DELEGATE_OUTPUT"
        fi

    else
        echo "[INFO] Rewards below threshold ($MIN_RESTAKE_AMOUNT $DENOM), skipping."
    fi

#    echo "[INFO] Sleeping for $INTERVAL_SECONDS seconds..."
#    sleep "$INTERVAL_SECONDS"
#done

```
