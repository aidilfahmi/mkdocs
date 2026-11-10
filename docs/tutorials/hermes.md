# Hermes IBC Relayer: Celestia ↔ Luxa (`luxa-1`)

Panduan singkat membangun IBC relayer dengan [Hermes](https://github.com/informalsystems/hermes) untuk menghubungkan **Celestia** dan **Luxa Network**, dari instalasi sampai `hermes start`.

> Dibuat oleh **dnsarz**. Nilai seperti IP node, endpoint, dan alamat wallet di bawah ini hanya contoh. Ganti dengan milik Anda sendiri dan **jangan pernah commit mnemonic atau private key** ke repository.

## Ringkasan

| Item | Nilai |
|---|---|
| Chain A | `celestia` (prefix `celestia`, denom `utia`) |
| Chain B | `luxa-1` (prefix `luxa`, denom `uluxa`) |
| Port | `transfer` |
| Channel di Celestia | `channel-709` (connection `connection-118`, client `07-tendermint-179`) |
| Channel di Luxa | `channel-3` (connection `connection-3`, client `07-tendermint-6`) |
| Versi Hermes | v1.10.4 |

Channel ini sudah ada, jadi **tidak perlu** menjalankan `hermes create channel`. Relayer cukup dikonfigurasi lalu dijalankan.

> Catatan: pasangan channel di atas dibaca dari sisi Luxa (`channel-3` ↔ `channel-709`). Awalnya mudah tertukar, jadi selalu verifikasi di langkah 6.

---

## 1. Instal Hermes

```bash
VER=v1.10.4
wget https://github.com/informalsystems/hermes/releases/download/$VER/hermes-$VER-x86_64-unknown-linux-gnu.tar.gz
sudo tar -C /usr/local/bin -xzf hermes-$VER-x86_64-unknown-linux-gnu.tar.gz
hermes version
mkdir -p ~/.hermes
```

Opsional, untuk tes gRPC: pasang `grpcurl` dari rilis resmi [fullstorydev/grpcurl](https://github.com/fullstorydev/grpcurl/releases) (tidak tersedia di apt Ubuntu).

## 2. Konfigurasi `~/.hermes/config.toml`

```toml
[global]
log_level = 'info'

[mode.clients]
enabled = true
refresh = true
misbehaviour = false

[mode.connections]
enabled = false

[mode.channels]
enabled = false

[mode.packets]
enabled = true
clear_interval = 100
clear_on_start = true
tx_confirmation = true

[telemetry]
enabled = true
host = '127.0.0.1'
port = 3001

[[chains]]
id = 'celestia'
type = 'CosmosSdk'
rpc_addr = 'http://<CELESTIA_RPC_HOST>:26657'
grpc_addr = 'http://<CELESTIA_GRPC_HOST>:9090'
# Mode pull aman bila websocket tidak tersedia:
event_source = { mode = 'pull', interval = '1s', max_buffer_size = 100 }
# Mode push (lebih ringan) jika node mendukung websocket:
# event_source = { mode = 'push', url = 'ws://<CELESTIA_RPC_HOST>:26657/websocket', batch_delay = '500ms' }
rpc_timeout = '15s'
account_prefix = 'celestia'
key_name = 'relayer-celestia'
store_prefix = 'ibc'
default_gas = 300000
max_gas = 3000000
gas_price = { price = 0.002, denom = 'utia' }
gas_multiplier = 1.3
max_msg_num = 30
max_tx_size = 2097152
compat_mode = '0.37'
clock_drift = '5s'
max_block_time = '13s'
trusting_period = '10days'
memo_prefix = 'Relayer By dnsarz'
trust_threshold = { numerator = '1', denominator = '3' }
address_type = { derivation = 'cosmos' }
packet_filter = { policy = 'allow', list = [['transfer', 'channel-709']] }

[[chains]]
id = 'luxa-1'
type = 'CosmosSdk'
rpc_addr = 'http://<LUXA_RPC_HOST>:26657'
grpc_addr = 'http://<LUXA_GRPC_HOST>:9090'
event_source = { mode = 'push', url = 'ws://<LUXA_RPC_HOST>:26657/websocket', batch_delay = '500ms' }
rpc_timeout = '15s'
account_prefix = 'luxa'
key_name = 'relayer-luxa'
store_prefix = 'ibc'
default_gas = 300000
max_gas = 3000000
gas_price = { price = 0.001, denom = 'uluxa' }
gas_multiplier = 1.3
max_msg_num = 30
max_tx_size = 2097152
clock_drift = '5s'
max_block_time = '30s'
trusting_period = '14days'
memo_prefix = 'Relayer By dnsarz'
trust_threshold = { numerator = '1', denominator = '3' }
address_type = { derivation = 'cosmos' }   # 'ethermint' jika chain berbasis EVM
packet_filter = { policy = 'allow', list = [['transfer', 'channel-3']] }
```

### Catatan konfigurasi

- **`trusting_period`** harus lebih kecil dari unbonding period chain yang dilacak (umumnya sekitar 2/3). Cek dengan `<binary> q staking params`.
- **`packet_filter`** membatasi relayer hanya ke channel ini, supaya tidak ikut me-relay channel lain dan membuang gas.
- **`misbehaviour = false`** mengurangi query ke height lama. Pengecekan misbehaviour sering gagal di node dengan pruning agresif dan memicu rate limit di endpoint publik.
- **`clear_on_start` / `clear_interval`**: jika ada relayer lain di channel yang sama, `clear_on_start = false` dan `clear_interval = 0` lebih hemat gas. Biarkan aktif bila relayer ini berfungsi sebagai cadangan.
- **RPC dan gRPC satu chain sebaiknya dari node yang sama.** Mencampur dua sumber dengan retensi dan posisi sync berbeda bisa menimbulkan error yang membingungkan. Bandingkan `node_info.id` dari kedua endpoint.
- **`address_type`**: jika alamat akun berformat `0x...` atau key algo `eth_secp256k1`, chain tersebut berbasis EVM dan perlu `ethermint`.
- **`compat_mode`** diisi `'0.37'` (Hermes 1.10 hanya mengenal `0.34` dan `0.37`). Warning "could not infer the compatibility mode" yang tersisa hanya informasi.

## 3. Validasi config dan koneksi

```bash
hermes config validate
hermes health-check
```

Hasil yang diharapkan: `SUCCESS performed health check for all chains in the config`.

Jika muncul error `transport error` pada gRPC, cek apakah gRPC aktif di node (`[grpc] enable = true` di `app.toml`), alamat dan port benar, dan firewall mengizinkan. Endpoint gRPC TLS memakai skema `https://`.

## 4. Import key relayer

Gunakan wallet **khusus relayer**, bukan wallet utama.

```bash
echo "<MNEMONIC_RELAYER>" > /tmp/mnemonic.txt
chmod 600 /tmp/mnemonic.txt
hermes keys add --chain celestia --key-name relayer-celestia --mnemonic-file /tmp/mnemonic.txt
hermes keys add --chain luxa-1   --key-name relayer-luxa     --mnemonic-file /tmp/mnemonic.txt
shred -u /tmp/mnemonic.txt

hermes keys list --chain celestia
hermes keys list --chain luxa-1
```

Jangan memakai ulang key relayer lain agar tidak terjadi `account sequence mismatch`.

## 5. Isi saldo (wajib)

Kirim token native ke alamat relayer di **kedua chain**: `utia` di Celestia dan `uluxa` di Luxa. Akun yang belum pernah menerima dana akan menghasilkan error:

```
account <alamat> not found
```

```bash
hermes keys balance --chain celestia
hermes keys balance --chain luxa-1
```

## 6. Verifikasi channel dan client

Ringkasan kedua ujung channel dalam sekali jalan:

```bash
hermes query channel ends --chain luxa-1  --port transfer --channel channel-3
hermes query channel ends --chain celestia --port transfer --channel channel-709
```

Detail satu sisi:

```bash
hermes query channel end --chain celestia --port transfer --channel channel-709
hermes query channel end --chain luxa-1   --port transfer --channel channel-3
```

Yang harus terlihat:

- `state: Open`
- `counterparty.channel_id` saling cocok (`channel-709` ↔ `channel-3`)
- `connection_hops`: `connection-118` (Celestia) dan `connection-3` (Luxa)

Cek client:

```bash
hermes query client status --chain celestia --client 07-tendermint-179
hermes query client status --chain luxa-1   --client 07-tendermint-6
hermes query client state  --chain luxa-1   --client 07-tendermint-6
```

Syarat: status `Active`, `frozen_height: None`, dan `chain_id` pada client state sesuai chain yang dilacak (client Luxa melacak `celestia`, client Celestia melacak `luxa-1`). Jika `Expired` atau `Frozen`, Hermes tidak bisa relay dan perlu proposal governance untuk memulihkan client.

## 7. Update client (jika tertinggal)

Lihat `latest_height` pada client state:

```bash
hermes query client state --chain luxa-1 --client 07-tendermint-6 | grep -A3 latest_height
```

Jika jauh di belakang height chain yang dilacak, update manual:

```bash
hermes update client --host-chain luxa-1 --client 07-tendermint-6
```

Syarat:

- Akun relayer di `luxa-1` sudah ada dan punya saldo, karena tx dibayar di chain host.
- Endpoint chain yang dilacak (Celestia) menyimpan data pada trusted height client. Jika node melakukan pruning agresif, error yang muncul:
  `height <N> is not available, lowest height is <M>`.
  Gunakan RPC arsip (full history) satu kali, lalu kembali ke node biasa.

Client IBC tersimpan **on-chain** dan dipakai bersama oleh semua relayer. Update client aman dan tidak mengubah parameter, channel, atau dana siapa pun. Tabrakan dengan relayer lain hanya menghasilkan tx gagal berupa `redundant`, yang tidak berbahaya selain gas.

## 8. Cek packet tertunda

```bash
hermes query packet pending --chain celestia --port transfer --channel channel-709
hermes query packet pending --chain luxa-1   --port transfer --channel channel-3
```

## 9. Jalankan Hermes

Uji manual dulu:

```bash
hermes start
```

Tanda sehat di log:

- Worker untuk kedua channel ter-spawn (`channel is OPEN, state on destination chain is OPEN`)
- Tidak ada error `init_subscriptions`
- Tidak ada `429 Too Many Requests`
- Tidak ada `account sequence mismatch`, `insufficient fee`, atau `client expired`

Error `redundant` atau `already relayed` normal jika relayer lain lebih dulu memproses packet.

## 10. Tes end-to-end (opsional)

Gunakan jumlah kecil dan penerima milik sendiri:

```bash
hermes tx ft-transfer \
  --src-chain celestia --dst-chain luxa-1 \
  --src-port transfer --src-channel channel-709 \
  --amount 1000 --denom utia \
  --receiver <ALAMAT_LUXA_ANDA> \
  --timeout-height-offset 1000
```

Di log harus muncul alur `SendPacket` → `RecvPacket` → `AcknowledgePacket`. Karena ada relayer lain, relay bisa dikerjakan mereka, dan itu tidak masalah untuk tes ini.

## 11. Jalankan sebagai service systemd

Hentikan `hermes start` (Ctrl+C), lalu buat `/etc/systemd/system/hermes.service`:

```ini
[Unit]
Description=Hermes IBC Relayer
After=network-online.target

[Service]
User=<USER>
ExecStart=/usr/local/bin/hermes start
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hermes
journalctl -u hermes -f
```

## 12. Pemeliharaan rutin

- Pantau saldo kedua akun relayer, karena gas terus terpakai.
- Cek `latest_height` kedua client secara berkala dan pastikan terus ter-refresh jauh sebelum trusting period habis.
- Metrics Prometheus tersedia di `http://127.0.0.1:3001/metrics`.
- Jaga retensi (pruning) node Celestia dan Luxa agar lebih panjang dari interval refresh client. Hermes me-refresh client sekitar sepertiga trusting period, jadi targetkan retensi minimal sekitar 7 hari.
- Untuk produksi, gunakan node sendiri atau penyedia berbayar. Endpoint publik gratis tidak punya SLA dan sering dibatasi rate limit.

## Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `transport error` saat health-check | gRPC tidak aktif atau tidak terjangkau | Aktifkan `[grpc]` di `app.toml`, cek port dan firewall, pakai `https://` untuk TLS |
| `failed to create WebSocket driver ... wss://https//...` | URL websocket salah format | Tulis `wss://host:port/websocket` tanpa `https://` di dalamnya, atau pakai mode `pull` |
| `429 Too Many Requests` | Rate limit endpoint publik | Pakai node sendiri, kurangi query (`misbehaviour = false`), naikkan `interval` pada mode pull |
| `height N is not available, lowest height is M` | Node memangkas data lama | Pakai RPC arsip untuk update client sekali, lalu naikkan retensi node |
| `account ... not found` | Akun relayer belum pernah menerima dana | Kirim token native ke alamat relayer di chain tersebut |
| `channel ... does not exist` | Channel ID tertukar sisi | Verifikasi dengan `query channel ends`, cek filter `packet_filter` |
| `state on destination chain is UNINITIALIZED` | Query ke sumber tidak konsisten atau salah chain | Samakan RPC dan gRPC dari node yang sama, cek channel dengan `query channel end` |
| `not within trusting period` pada misbehaviour | Memeriksa consensus state lama di luar trusting period | Normal. Matikan `misbehaviour` atau abaikan, yang menentukan adalah consensus state terbaru |
| `account sequence mismatch` | Key dipakai bersama proses lain | Gunakan key khusus untuk relayer ini |
| `insufficient fee` / `out of gas` | `gas_price` atau `gas_multiplier` terlalu kecil | Naikkan nilainya sesuai `minimum-gas-prices` node |

## Referensi

- [Hermes documentation](https://hermes.informal.systems/)
- [Cosmos chain-registry](https://github.com/cosmos/chain-registry)
- [Celestia Mainnet Beta endpoints](https://docs.celestia.org/)
