## Upload genesis and addrbook to files server
Script for upload/ update genesis.json and addrbook.json from server node to nginx server. This is for proxmox server using LXC Container.
Run this script in every LXC.

### How to Use 
```text
Usage: ./genesis.sh [-n NODE_NAME] [-d DATA_FOLDER] [-t NETWORK] [-H REMOTE_HOST] [-u REMOTE_USER] [-b REMOTE_BASE]

  -n NODE_NAME     Node name, e.g. safrochain, lumera, osmosis    (default: osmosis)
  -d DATA_FOLDER   Home data folder for this chain, e.g. .safrochain (default: .osmosisd)
  -t NETWORK       mainnet or testnet                             (default: mainnet)
  -H REMOTE_HOST   Remote host/IP                                 (default: 95.217.76.186)
  -u REMOTE_USER   Remote SSH user                                (default: root)
  -b REMOTE_BASE   Remote base path                               (default: /srv/files)

Example:
  ./genesis.sh -n safrochain -d .safrochain
  ./genesis.sh -n lumera -d .lumera -t testnet
```
### genesis.sh
```bash
#!/usr/bin/env bash
set -Eeuo pipefail

########################################
# Configuration (defaults — override via CLI flags below)
########################################
REMOTE_USER="root"
REMOTE_HOST="192.168.100.250"
REMOTE_BASE="/srv/files"
NETWORK="mainnet"        # mainnet or testnet
NODE_NAME="osmosis"      # Customize this
DATA_FOLDER=".osmosisd"  # e.g. .safrochain, .lumera, .osmosisd

########################################
# Usage / CLI overrides
########################################
usage() {
    cat <<EOF
Usage: $0 [-n NODE_NAME] [-d DATA_FOLDER] [-t NETWORK] [-H REMOTE_HOST] [-u REMOTE_USER] [-b REMOTE_BASE]

  -n NODE_NAME     Node name, e.g. safrochain, lumera, osmosis   (default: $NODE_NAME)
  -d DATA_FOLDER   Home data folder for this chain, e.g. .safrochain (default: $DATA_FOLDER)
  -t NETWORK       mainnet or testnet                            (default: $NETWORK)
  -H REMOTE_HOST   Remote host/IP                                (default: $REMOTE_HOST)
  -u REMOTE_USER   Remote SSH user                                (default: $REMOTE_USER)
  -b REMOTE_BASE   Remote base path                                (default: $REMOTE_BASE)

Example:
  $0 -n safrochain -d .safrochain
  $0 -n lumera -d .lumera -t testnet
EOF
    exit 1
}

while getopts "n:d:t:H:u:b:h" opt; do
    case "$opt" in
        n) NODE_NAME="$OPTARG" ;;
        d) DATA_FOLDER="$OPTARG" ;;
        t) NETWORK="$OPTARG" ;;
        H) REMOTE_HOST="$OPTARG" ;;
        u) REMOTE_USER="$OPTARG" ;;
        b) REMOTE_BASE="$OPTARG" ;;
        h) usage ;;
        *) usage ;;
    esac
done

########################################
# Locate genesis.json inside the specified data folder only
########################################
DATA_HOME="$HOME/$DATA_FOLDER"

if [[ ! -d "$DATA_HOME" ]]; then
    echo "ERROR: data folder not found: $DATA_HOME"
    exit 1
fi

GENESIS=$(find "$DATA_HOME" -maxdepth 3 -type f -path "*/config/genesis.json" | head -n1)
if [[ -z "$GENESIS" ]]; then
    echo "ERROR: genesis.json not found under $DATA_HOME"
    exit 1
fi

CONFIG_DIR=$(dirname "$GENESIS")
ADDRBOOK="$CONFIG_DIR/addrbook.json"
REMOTE_DIR="${REMOTE_BASE}/${NETWORK}/${NODE_NAME}"

echo "========================================"
echo "Node      : $NODE_NAME"
echo "Data dir  : $DATA_HOME"
echo "Network   : $NETWORK"
echo "Local     : $CONFIG_DIR"
echo "Remote    : ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"
echo "========================================"

########################################
# SSH Control Socket
########################################
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
