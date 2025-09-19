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
https://github.com/aidilfahmi/cosmos-prune.git
cd cosmos-prune
make install
```
### Run cosmprund
```shell
cosmos-pruner prune ~/.folder/data
```
