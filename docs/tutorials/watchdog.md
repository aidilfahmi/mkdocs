## Watchdog - CPU Watchdog for Blockchain Services
* Auto restart node binary if reach THRESHOLD for some duration
```shell
sudo nano /usr/local/bin/watchdog.sh
```
```bash
#!/bin/bash

###############################################################################
# Service CPU Watchdog
#
# Monitors selected services and restarts them if CPU usage stays above
# THRESHOLD for DURATION seconds.
###############################################################################

# Services to monitor
SERVICES=(
    nobled
    gaiad
    osmosisd
    # node-binary you want to control
)

# Configuration
THRESHOLD=100      # CPU percentage
INTERVAL=5         # Check every 5 seconds
DURATION=30        # Restart after 30 seconds above threshold
LIMIT=$((DURATION / INTERVAL))

# Counter for each service
declare -A COUNTER

while true; do

    for SERVICE in "${SERVICES[@]}"; do

        PID=$(pgrep -x "$SERVICE")

        if [[ -z "$PID" ]]; then
            COUNTER[$SERVICE]=0
            continue
        fi

        CPU=$(ps -p "$PID" -o %cpu= | awk '{print int($1)}')

        if [[ "$CPU" -ge "$THRESHOLD" ]]; then

            COUNTER[$SERVICE]=$(( ${COUNTER[$SERVICE]:-0} + 1 ))

            logger "[Watchdog] ${SERVICE}: CPU ${CPU}% (${COUNTER[$SERVICE]}/${LIMIT})"

            if [[ "${COUNTER[$SERVICE]}" -ge "$LIMIT" ]]; then

                logger "[Watchdog] Restarting ${SERVICE}.service (CPU ${CPU}% for ${DURATION}s)"

                systemctl restart "${SERVICE}.service"

                COUNTER[$SERVICE]=0

                # Give the service time to initialize
                sleep 60
            fi

        else
            COUNTER[$SERVICE]=0
        fi

    done

    sleep "$INTERVAL"

done
```
```shell
sudo chmod +x /usr/local/bin/service-watchdog.sh
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
