## Jupyter Lab

!!! info "tested on Ubuntu 24.0.4"

### Install pipx and jupiterlab
```bash
sudo apt install pipx
pipx install jupyterlab
```

### Create PATH environment variable

```bash
pipx ensurepath
```

!!! warning "Re-login to change take effect"

### Create Config file

```bash
jupyter-lab --generate-config
```

### Edit config file

!!! info "nano $HOME/.jupyter/jupyter_lab_config.py"

```bash
c.ServerApp.ip = '0.0.0.0' # edit host
c.ServerApp.port = 9999    # edit port
c.ServerApp.token = '12345' # edit '12345' with tour custom token, it will be using for authentication on the webpage
```

### Create service
```bash
sudo tee /etc/systemd/system/jupyterLab.service > /dev/null <<EOF
[Unit]
Description=JupyterLab
After=network-online.target
[Service]
User=$USER
WorkingDirectory=$HOME
ExecStart=$HOME/.local/bin/jupyter-lab --config=$HOME/.jupyter/jupyter_lab_config.py
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
[Install]
WantedBy=multi-user.target
EOF
```

### Start service

```bash
sudo systemctl daemon-reload
sudo systemctl restart jupyterlab
sudo systemctl enable jupyterlab
sudo systemctl status jupyterlab
```

!!! success " Open browser and test your lab  http://yourip:port/lab"
