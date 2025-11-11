### Installing Go
```shell
# install go, if needed
cd $HOME
sudo rm -rf /usr/local/go
VER="1.23.6"
curl -Ls https://go.dev/dl/go$VER.linux-amd64.tar.gz | sudo tar -xzf - -C /usr/local
echo "export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin" >> $HOME/.bash_profile
source $HOME/.bash_profile
mkdir -p ~/go/bin
go version
```
### Installing Cosmos Prune
```bash
# clone & build cosmprund repo
git clone https://github.com/aidilfahmi/cosmos-prune.git
cd cosmos-prune
make install
cd ~/
```
### Run cosmprund
```shell
cosmos-pruner prune ~/.folder/data
```

## Make auto-running with crontab
#### Creating .sh script
```shell
# create files prune.sh
# Node example : safrochain
cd $HOME

tee ~/prune.sh > /dev/null <<EOF
sudo systemctl stop safrochaind
cosmos-pruner prune ~/.safrochain/data/ --blocks 5
sudo systemctl restart safrochaind
EOF

chmod +x ~/prune.sh
```
### Passwordless when running systemctl from user crontab
```bash
sudo visudo -f /etc/sudoers.d/dnsarz-systemctl
```
Then add this line
```shell
dnsarz ALL=(root) NOPASSWD: /bin/systemctl *
```
### Create crontab
```shell
crontab -e
```
Add this line for every saturday mid-night
```bash
0 0 * * 6 /home/dnsarz/prune.sh
```
