
Script for update genesis.json and addrbook.json from server node to nginx server. This is for proxmox server using LXC Container.
Run this script in every LXC.

```bash
#!/usr/bin/env bash

set -Eeuo pipefail

########################################
# Configuration
########################################

REMOTE_USER="root"
REMOTE_HOST="192.168.100.250"
REMOTE_BASE="/srv/files"

NETWORK="mainnet"      # mainnet or testnet
NODE_NAME="osmosis"    # Customize this

########################################

# Find genesis.json automatically
GENESIS=$(find "$HOME" -maxdepth 3 -type f -path "*/config/genesis.json" | head -n1)

if [[ -z "$GENESIS" ]]; then
    echo "ERROR: genesis.json not found."
    exit 1
fi

CONFIG_DIR=$(dirname "$GENESIS")
ADDRBOOK="$CONFIG_DIR/addrbook.json"

REMOTE_DIR="${REMOTE_BASE}/${NETWORK}/${NODE_NAME}"

echo "========================================"
echo "Node      : $NODE_NAME"
echo "Network   : $NETWORK"
echo "Local     : $CONFIG_DIR"
echo "Remote    : ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"
echo "========================================"

# SSH Control Socket
CONTROL_SOCKET="/tmp/ssh-node-sync-$$"

echo "Opening SSH connection..."
ssh \
    -o ControlMaster=yes \
    -o ControlPath="$CONTROL_SOCKET" \
    -o ControlPersist=5m \
    "${REMOTE_USER}@${REMOTE_HOST}" true

cleanup() {
    ssh \
        -O exit \
        -o ControlPath="$CONTROL_SOCKET" \
        "${REMOTE_USER}@${REMOTE_HOST}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Creating remote directory..."
ssh \
    -o ControlPath="$CONTROL_SOCKET" \
    "${REMOTE_USER}@${REMOTE_HOST}" \
    "mkdir -p '$REMOTE_DIR'"

echo "Uploading genesis.json..."
rsync -az \
    --chmod=F644 \
    -e "ssh -o ControlPath=$CONTROL_SOCKET" \
    "$GENESIS" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"

if [[ -f "$ADDRBOOK" ]]; then
    echo "Uploading addrbook.json..."
    rsync -az \
        --chmod=F644 \
        -e "ssh -o ControlPath=$CONTROL_SOCKET" \
        "$ADDRBOOK" \
        "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
else
    echo "addrbook.json not found, skipping."
fi

echo
echo "========================================"
echo "✓ Sync completed successfully!"
echo "========================================"
```
