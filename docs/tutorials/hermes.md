## Hermes Releases
```shell
https://github.com/informalsystems/hermes/releases
```
## Download and Installation
```shell
wget https://github.com/informalsystems/hermes/releases/download/v1.13.3/hermes-v1.13.3-x86_64-unknown-linux-gnu.tar.gz
tar -zxvf hermes-v1.13.3-x86_64-unknown-linux-gnu.tar.gz
chmod +x hermes
mv hermes ~/go/bin/
hermes version
```

## Create configuration file
```
mkdir ~/.hermes
touch ~/.hermes/config.toml
```
## Create Service
```shell
sudo tee /etc/systemd/system/hermesd.service > /dev/null <<EOF
[Unit]
Description=Hermes Relayer
After=network-online.target
[Service]
User=$USER
WorkingDirectory=$HOME/.hermes
ExecStart=$(which hermes) start
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
[Install]
WantedBy=multi-user.target
EOF
```
```
sudo systemctl enable hermesd
sudo systemctl restart hermesd && sudo journalctl -u hermesd -f
```
