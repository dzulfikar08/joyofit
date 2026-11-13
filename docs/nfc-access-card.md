# NFC access cards on the watch: feasibility

Status: **feasibility study 2026-11-12. Not implemented, and not feasible to clone.** Question: a user asked whether JoyoFit
could let a Huawei watch act as an NFC access card (kartu akses kantor/apartemen, transit card, bank card), the way Huawei
Wallet does — ideally a one-tap "share to watch" like Gadgetbridge's loyalty cards. This note records what the watch protocol
actually requires, so we don't re-investigate next time.

Sources: Huawei Health (HH) 17.0.8.300 decompiled (`~/re/huawei-health`, `huawei-health.apk` sha256
`6e693fe6…6f42fd`; decompiled with the REA / jadx-headless-mcp 0.7.1 engine per `~/re/huawei-health/NOTES.md`). Gadgetbridge
master (checked 2026-11-12). File and command references are for analysis; no Huawei code is copied into this repo.

## Short answer

No. The Bluetooth command that pushes a card to the watch is trivial to send, but it is only the last hop. The card
credential it carries (the secure-element applet and its keys) is created and personalised by **Huawei's wallet servers (TSM)**,
bound to the user's Huawei account and the watch's chip. Nothing in the APK generates it locally. Without that server step we
have no valid payload to send, so there is nothing to clone. Gadgetbridge has none of this for Huawei either.

The only realistic path stays: the user adds the card once through **Huawei Wallet / Huawei Health**; after that it lives on the
watch's secure element and keeps working no matter which companion app (JoyoFit, Gadgetbridge) is connected over BLE.

## What the protocol looks like

All wallet/NFC traffic with the watch runs on one TLV channel, **service ID 27**, with ~24 command IDs. The phone-side manager
is `com.huawei.hwdevice.mainprocess.mgr.hwpaymgr.HwPayManager`; the plugin entry point is `com.huawei.nfc.PluginPayAdapter`
(impl `lqe`, the `PluginPay` bundle `config://PluginPay.zip`, not in the base dex). Verified commands (read directly from the
decompile, service 27):

| Cmd | Method (obfuscated) | Purpose |
|---|---|---|
| 2 | `executeApdu(PayApduInfo)` | send an APDU to an applet in the secure element |
| 4 | `getCplc()` | read the chip's CPLC (unique secure-element id) |
| 21 | `sendAccessCardRfInfo(aid, rfinfo)` | push an access card's AID + RF field data |
| 22 | `sendAccessCardReadEvent(...)` | card read / tap event |

(The rest cover install/activate/delete applet, channel open/close, card list, Mifare sector auth, bank-card TLV, etc. UI
entry points exist too: `AddBankOrBusCardActivity`, `OpenAccessCardListActivity`, `wallet://…BindBusCardAddActivity`.)

The shape of command 21 (`HwPayManager.c(aid, rfinfo, cb)`):

```
serviceID = 27, commandID = 21
payload (TLV, hex): tag 1 = aid ; tag 2 = rfinfo    # each as len-prefixed bytes
```

## Why knowing the command doesn't help

The CPLC read (cmd 4) and the APDU exchange (cmd 2) are there precisely so **Huawei's TSM server** can personalise the chip:
the server generates the applet and keys, and the phone just relays its APDUs to the secure element. The card's secrets never
exist in the app. For a real door/office card the card itself must be either a blank Huawei supports or an empty-frequency card
copied through Huawei's cloud — an account-bound, server-side step. So even with the exact BLE opcode, we can't synthesise a
valid `aid`/`rfinfo` or a working applet. This is a secure-element + server limitation, not a protocol gap we can fill.

## If a lighter feature is ever wanted

Gadgetbridge's wallet feature for other brands (Catima / FossWallet) is **not** NFC — it sends a loyalty card as a *barcode*
for the watch screen. That could in principle be worth exploring for Huawei (does the Fit watch have a screen-barcode slot?),
but it is a different feature from NFC emulation and was not investigated here.
