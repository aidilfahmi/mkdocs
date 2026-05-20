# Upgrade Proxmox VE 8 (Debian 12) → Proxmox VE 9 (Debian 13)

## Environment

-   Proxmox VE 8.4 → 9.1
-   Debian 12 (Bookworm) → Debian 13 (Trixie)
-   Software RAID1 (`mdadm`)
-   Existing VMs/CTs preserved

## 1. Verify current system

``` bash
pveversion -v
cat /etc/debian_version
uname -r
lsblk
pvs
vgs
lvs
```

## 2. Backup

``` bash
tar czf /root/pve-upgrade-backup.tar.gz /etc/pve /etc/network/interfaces /etc/hosts /etc/fstab
```

## 3. Update current system

``` bash
apt update
apt full-upgrade -y
reboot
```

## 4. Install upgrade assistant

``` bash
apt install proxmox-upgrade-assistant -y
pve8to9 --full
```

Proceed only if:

``` text
WARNINGS: 0
FAILURES: 0
```

## 5. Shutdown guests

``` bash
for ct in $(pct list | awk 'NR>1 {print $1}'); do
    pct shutdown $ct || true
done

for vm in $(qm list | awk 'NR>1 {print $1}'); do
    qm shutdown $vm || true
done
```

## 6. Switch repositories

``` bash
sed -i 's/bookworm/trixie/g' /etc/apt/sources.list
```

Disable enterprise repo:

``` bash
rm -f /etc/apt/sources.list.d/pve-enterprise.*
```

Add no-subscription repo:

``` bash
cat > /etc/apt/sources.list.d/pve-install-repo.list <<EOF
deb http://download.proxmox.com/debian/pve trixie pve-no-subscription
EOF
```

## 7. Upgrade

``` bash
apt update
apt upgrade
apt full-upgrade
```

Keep current config when prompted: - /etc/network/interfaces -
/etc/hosts - /etc/issue

## 8. Postfix fix (if needed)

``` bash
mkdir -p /etc/postfix
cp /usr/share/postfix/main.cf.debian /etc/postfix/main.cf
dpkg-reconfigure postfix
dpkg --configure -a
apt --fix-broken install
```

## 9. Reboot

``` bash
reboot
```

## 10. Verify

``` bash
cat /etc/debian_version
pveversion -v
uname -r
qm list
pct list
```

## 11. Cleanup

``` bash
apt autoremove
apt update
apt full-upgrade
```

Final result: - Debian 13 - Proxmox VE 9 - Kernel 7.x - Existing VMs/CTs
preserved
