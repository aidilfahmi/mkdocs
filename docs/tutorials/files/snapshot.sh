#!/bin/bash

set -uo pipefail

# =============================
# Mapping chain name -> root folder
# =============================
declare -A CHAINS=(
  ["safrochain"]="/home/dnsarz/.safrochain"
  ["lumera"]="/home/dnsarz/.lumera"
)


# =============================
# Mapping chain name -> systemd service name
# =============================
declare -A SERVICES=(
  ["safrochain"]="safrochaind"
  ["lumera"]="lumerad"
)


# =============================
# Mapping Network name -> testnet or mainnet
# =============================
declare -A NETWORKS=(
  ["safrochain"]="testnet"
  ["lumera"]="mainnet"
)


# Base folder for all public snapshots
WEB_BASE="/home/dnsarz/snapshots"

echo "📦 Starting validator snapshot with node stop/start..."

for CHAIN in "${!CHAINS[@]}"; do
  ROOT_DIR="${CHAINS[$CHAIN]}"
  DATA_DIR="$ROOT_DIR/data"
  SERVICE="${SERVICES[$CHAIN]}"
  NETWORK="${NETWORKS[$CHAIN]}" 
  ARCHIVE_NAME="snapshot.tar.lz4"

  # Web folder for each chain
  WEB_SNAPSHOT_DIR="$WEB_BASE/$NETWORK/$CHAIN"

  # Create web folder if it doesn't exist
  mkdir -p "$WEB_SNAPSHOT_DIR"

  echo ""
  echo "🛑 Stopping $SERVICE service..."
  sudo systemctl stop "$SERVICE"

#create info.json
  /home/dnsarz/go/bin/cosmprund db-info "$DATA_DIR"  > "$WEB_SNAPSHOT_DIR/$CHAIN.json"
  echo "🧹 Pruning $CHAIN data directory before snapshot..."
#  /home/dnsarz/go/bin/cosmprund prune "$DATA_DIR" --force-compress-app --keep-blocks 5 \
  /home/dnsarz/go/bin/cosmprund prune "$DATA_DIR" --force-compress-app --keep-blocks 5 \
    || echo "⚠️ Prune failed for $CHAIN"

  echo "📦 Archiving $CHAIN folders except config directly to web folder..."
  if [ -d "$ROOT_DIR" ]; then
    cd "$ROOT_DIR" || { 
      echo "⚠️ Failed to cd into $ROOT_DIR"; 
      sudo systemctl restart "$SERVICE"; 
      continue; 
    }

    ARCHIVE_PATH="$WEB_SNAPSHOT_DIR/$ARCHIVE_NAME"
    # Remove old snapshot if exists
    [ -f "$ARCHIVE_PATH" ] && rm -f "$ARCHIVE_PATH"

    # Tar all folders except config directly to web folder, ignore missing folders
    tar --exclude='./config' -cf - data wasm 2>/dev/null | lz4 - "$ARCHIVE_PATH"
    echo "✅ $CHAIN data archived and compressed successfully to $ARCHIVE_PATH"
  else
    echo "⚠️ Skipping $CHAIN - root directory not found: $ROOT_DIR"
    sudo systemctl restart "$SERVICE"
    continue
  fi

  echo "🚀 Starting $SERVICE service again..."
  sudo systemctl restart "$SERVICE"

  echo "🧹 Copying genesis.json and addrbook.json to web directory..."
  cp "$ROOT_DIR/config/genesis.json" "$WEB_SNAPSHOT_DIR/" || echo "❌ Failed to copy genesis.json to web directory"
  cp "$ROOT_DIR/config/addrbook.json" "$WEB_SNAPSHOT_DIR/" || echo "❌ Failed to copy addrbook.json to web directory"

done

echo ""
echo "🎉 All validator snapshots completed and published to $WEB_BASE!"
