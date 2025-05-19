# Installation
tested on Ubuntu 24.0.4

```bash
sudo apt install pipx
pipx install jupyterlab
```
## Create PATH environment variable

```bash
pipx ensurepath
```

<p class="callout warning">**<span style="color: rgb(241, 196, 15);">Re-login to change take effect</span>**</p>

#####  

##### Create Config file

```bash
jupyter-lab --generate-config
```

#####  

##### Edit config file

```
nano $HOME/.jupyter/jupyter_lab_config.py
```

```bash
c.ServerApp.ip = "0.0.0.0" # edit host
c.ServerApp.port = 9999    # edit port
c.ServerApp.token = '12345' # edit '12345' with tour custom token, it will be using for authentication on the webpage
```

##### Create service

<p class="callout info">Replace "username" with your user login</p>

```bash
[Unit]
Description=JupyterLab

[Service]
Type=simple
User=username
WorkingDirectory=/home/username/
ExecStart=/home/username/.local/bin/jupyter-lab --config=/home/username/.jupyter/jupyter_lab_config.py
Restart=always
RestartSec=10
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

##### Start service

```bash
sudo systemctl daemon-reload
sudo systemctl restart jupyterlab
sudo systemctl enable jupyterlab
sudo systemctl status jupyterlab
```

<p class="callout success">Open browser and test your lab  
<span style="color: rgb(241, 196, 15);">http://yourip:port/lab</span></p>
