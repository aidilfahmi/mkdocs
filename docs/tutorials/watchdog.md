## Watchdog - CPU Watchdog for Blockchain Services
* Auto restart node binary if reach THRESHOLD for some duration
```shell
sudo nano /usr/local/bin/watchdog.sh
```
```bash
#!/bin/bash

SERVICES=(
    safrochaind
    nobled
    gaiad
    osmosisd
)

THRESHOLD=100      # Same meaning as top: 100 = one fully utilized CPU core
INTERVAL=5         # Seconds between checks
DURATION=30        # Restart after 30 seconds
LIMIT=$((DURATION / INTERVAL))

CLK_TCK=$(getconf CLK_TCK)
NCPU=$(nproc)

declare -A COUNT

while true; do
    for SERVICE in "${SERVICES[@]}"; do

        PID=$(pidof "$SERVICE")

        if [[ -z "$PID" ]]; then
            COUNT[$SERVICE]=0
            continue
        fi

        # Process CPU time (utime + stime)
        read -r utime1 stime1 < <(awk '{print $14, $15}' /proc/$PID/stat)
        total1=$((utime1 + stime1))

        sleep "$INTERVAL"

        # Process may have exited
        if [[ ! -r /proc/$PID/stat ]]; then
            COUNT[$SERVICE]=0
            continue
        fi

        read -r utime2 stime2 < <(awk '{print $14, $15}' /proc/$PID/stat)
        total2=$((utime2 + stime2))

        delta=$((total2 - total1))

        # Same convention as top:
        # 100 = one CPU core fully utilized
        CPU=$(awk -v d="$delta" -v hz="$CLK_TCK" -v sec="$INTERVAL" \
            'BEGIN { printf "%.0f", d*100/(hz*sec) }')

        echo "$(date) $SERVICE CPU=${CPU}% COUNT=${COUNT[$SERVICE]}"

        if (( CPU >= THRESHOLD )); then
            COUNT[$SERVICE]=$(( ${COUNT[$SERVICE]:-0} + 1 ))
        else
            COUNT[$SERVICE]=0
        fi

        if (( ${COUNT[$SERVICE]} >= LIMIT )); then
            logger -t service-watchdog "Restarting ${SERVICE}.service (CPU=${CPU}%)"

            systemctl restart "${SERVICE}.service"

            COUNT[$SERVICE]=0

            # Give it time to start
            sleep 60
        fi

    done
done
```
```shell
sudo chmod +x /usr/local/bin/watchdog.sh
```
```bash
sudo tee /etc/systemd/system/watchdog.service > /dev/null <<EOF
[Unit]
Description=CPU Watchdog for Blockchain Services
After=network-online.target
[Service]
User=$USER
ExecStart=$(which watchdog.sh)
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
```
```shell
sudo systemctl daemon-reload
sudo systemctl enable --now watchdog.service
sudo systemctl restart watchdog.service && sudo journalctl -u watchdog.service -f
```
