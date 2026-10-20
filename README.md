# OpenTV Launcher for LG

A clean, ad-free home screen for rooted LG webOS TVs, in the style of Apple TV.

Built and tested on an LG OLED42C2PSA (webOS 22) rooted with the Homebrew Channel.

## Features

- **Recent row:** your last used apps first (up to 10), topped up to 6 with your favourites.
- **All Apps:** every installed app with its real icon. LG's own apps are hidden, except Browser, the LG app store and HDMI inputs.
- **Opens on its own** at power on, on wake from standby, and when you press Home.
- **Top bar:** Settings, Notifications and LG Home on the left; clock, Search and Profile on the right.
- **Recent Lists (press Back twice):** the same open apps list as LG's, with snapshots. You can close one app or close all.
- **New apps show up by themselves:** a small root service copies icons for newly installed apps.
- **Smooth movement:** focus, banner and scrolling all animate.

## Requirements

- An LG webOS TV rooted with the [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel), with root shell access (telnet or SSH).
- A computer on the same network.

## Install

1. Copy `dist/com.opentvlauncher.lg_1.3.0_all.ipk` to the TV, for example to `/tmp/launcher.ipk`.
2. On the TV's root shell, install it:

   ```sh
   luna-send -n 12 -w 40000 -f luna://com.webos.appInstallService/dev/install \
     '{"id":"com.opentvlauncher.lg","ipkUrl":"/tmp/launcher.ipk","subscribe":true}'
   ```

3. Turn on start-up, the Home button takeover and recent app tracking:

   ```sh
   sh /media/developer/apps/usr/palm/applications/com.opentvlauncher.lg/install-autostart.sh
   ```

   To turn that off again, run the same command with `remove` at the end.

The watcher logs to `/tmp/opentvlauncher.log`.

## Build

```sh
sh build-ipk.sh
```

This writes `dist/com.opentvlauncher.lg_<version>_all.ipk`. The version comes from `app/appinfo.json`.

## Customise

Edit `app/apps.js`:

- `dock`: your favourite apps, used to fill the Recent row and listed first in All Apps.
- `showLgApps`: LG apps to keep visible.
- `profileInitial`: the letter in the profile button.

## How it works

| Part | What it does |
| --- | --- |
| `app/` | The launcher page (HTML, CSS, JS). |
| `service/` | `com.opentvlauncher.lg.service`, a small Node service that the watcher gives root. It copies app icons, reads LG's recent list and closes apps. It offers no general command execution. |
| `app/autostart.sh` | The watcher, installed to `/var/lib/webosbrew/init.d/50opentvlauncher`. It opens the launcher at boot, on wake and on Home, records recently used apps, and keeps the service running as root. |
| `app/sync-icons.js` | Copies every app's icon into the app folder and writes `installed.js`. |

## Disclaimer

This is an unofficial project and is not affiliated with or endorsed by LG Electronics or Apple. Rooting your TV may void its warranty. Use it at your own risk.
