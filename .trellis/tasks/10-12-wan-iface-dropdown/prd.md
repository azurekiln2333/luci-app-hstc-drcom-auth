# PRD: WAN interface as a dropdown from LuCI

## Background

The WAN interface is a free-text field (`wan_port`, default `eth1`). Users must
know the exact Linux netdev name, and typos silently break the auth scripts
(they read `/sys/class/net/$WAN_PORT/address` and `ifconfig $WAN_PORT`).

## Goal

Let the user pick the WAN interface from a dropdown populated by LuCI, while the
stored value stays a netdev name so the scripts keep working unchanged.

## Requirements

- R1 The field becomes a dropdown offering:
  - LuCI network interfaces, shown as logical name plus device when they differ
    (e.g. `wan (eth0)`), storing the device/netdev name.
  - System netdevs not covered by a logical interface (e.g. `eth1`, `wwand0`).
- R2 The dropdown must include the currently configured value even if it is not
  currently present (so an offline interface is not lost).
- R3 The stored UCI value remains the netdev name (no behavior change server
  side).
- R4 Localized label/description in zh, zh-TW and en.
- R5 Works without JS modules failing when LuCI's network model is unavailable:
  fall back to the raw system netdev list.

## Acceptance criteria

- The dropdown lists the router's real interfaces (eth0/eth1/wwand0/br-lan/...).
- Selecting an interface and saving writes that netdev name to
  `/etc/config/drcom_auth` `wan_port`.
- The value survives a reload (selected option reflects the saved value).
- Verified on the Kwrt router.

## Out of scope

- Auto-detecting which interface is "the WAN".
- Changing how scripts consume WAN_PORT.
