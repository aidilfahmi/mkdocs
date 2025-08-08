# PM2 - Daemon
###Installing Node.js
```bash
sudo apt autoremove nodejs -y
curl -fsSL https://deb.nodesource.com/setup_23.x | sudo -E bash -
sudo apt update
sudo apt-get install -y nodejs
```

### Installing PM2
```bash
sudo npm install pm2 -g
```
/// admonition | Sample on INIChain Node :
#### Installing INIChain Node Mine
```bash
cd $HOME
wget https://github.com/Project-InitVerse/ini-miner/releases/download/v1.0.0/iniminer-linux-x64
chmod +x iniminer-linux-x64
```
#### Node Operations
Starting Applications with pm2
```bash
pm2 start $HOME/iniminer-linux-x64 -- --pool stratum+tcp://<YOUR_WALLET_ADDRESS>.Worker001@pool-core-testnet.inichain.com:32672 --cpu-devices 1 --cpu-devices 2
```

#### Cek Status or List
```
pm2 status
```
#### Cek Dashboard / Monitor
```
pm2 monit
```
#### Stop ID/Name Application
```
pm2 stop id/name
```
#### Delete ID/Name Application
```
pm2 delete id/name
```
///
