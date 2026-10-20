# 📺 OpenTV Launcher for LG

A clean, ad-free home screen for rooted LG webOS TVs, in the style of Apple TV.

✅ Tested on an LG OLED42C2PSA (webOS 22), rooted with [slopbro](https://github.com/throwaway96/slopbro).

---

## 🖼️ Before and after

**😩 Before: LG's home screen**, full of banners and ads

![LG's home screen](docs/screenshots/before-lg-home.jpg)

**😍 After: OpenTV Launcher**, just your apps

![OpenTV Launcher](docs/screenshots/after-opentv-launcher.jpg)

---

## ✨ What you get

- 🕘 **Recent row:** the apps you used last come first (up to 10). If you've used fewer than 6, your favourites fill the gap.
- 📱 **All Apps:** every installed app, with its real icon.
- 🎛️ **Launcher Settings** (the sliders button next to Search): turn on **Hide LG TV apps** to hide LG's own apps, keeping only Browser, Apps (the LG store) and HDMI inputs. It's off by default.
- 📊 **Show performance** (also in Launcher Settings): a glass panel on the right of the banner with live **memory (RAM)** use and **storage** left for apps, updated every 5 seconds. It's off by default.
- 🗑️ **Delete apps like on LG's home:** hold OK on an app, press ⬆️ to the **Delete** button above it, and confirm in LG's own popup. LG's built-in apps can't be deleted.
- 🛟 **Safe by design:** if the launcher ever hits an error, it tells you and opens LG's home instead, so the TV is never stuck.
- 🖥️ **Fits any screen:** HD, Full HD and 4K, and fills other screen shapes too.
- 🏠 **Always your home screen:** opens when the TV turns on, when it wakes from standby, and when you press **Home**.
- 🧭 **Top bar:** Settings, Restart, Notifications and LG Home on the left; clock, Search, Launcher Settings and Profile on the right.
- 🔄 **Restart button:** restarts the TV after you confirm in LG's own popup.
- 🔙 **Recent Lists:** press **Back twice** to see your open apps, then close one or close all.
- 🆕 **New apps appear by themselves,** with their icons.
- 🌊 **Smooth animations** while you move around.
- 🚫 **No ads, no banners.**

---

## 🧰 Before you start (prerequisites)

1. 🔓 **Root your TV.** I used [slopbro](https://github.com/throwaway96/slopbro):
   - 🐍 Get the slopbro repo on a computer that has Python 3.
   - 📶 Put the computer and the TV on the same network.
   - ▶️ Run slopbro, following its README. Accept the pairing prompt on the TV when it appears.
   - 🍺 When it finishes, the **Homebrew Channel** is installed on your TV.
   - 🔎 Your TV not supported by slopbro? Check [CanI.RootMy.TV](https://cani.rootmy.tv) for other options.
2. 🗑️ **Remove LG's "Developer Mode" app** if it's installed on your TV. Uninstall it from the TV like any other app. When its session runs out, it can delete apps installed like this one, and on a rooted TV the Homebrew Channel already does its job.
3. 🖥️ **Turn on root shell access.** On the TV, open **Homebrew Channel → Settings** and turn on **Telnet** (or **SSH**).
4. 🔢 **Find your TV's IP address.** On the TV, go to **Settings → Network → Wi-Fi (or Wired) → Advanced Settings**.
5. 💻 **A computer on the same network,** to log in to the TV. (Mac or Linux with Python 3 is only needed for the backup install method.)
6. 🧪 **Check you can log in to the TV:**
   ```sh
   telnet <TV IP address>
   ```
   You should get a `#` prompt, which means you are root. On a Mac without telnet, run `brew install telnet` first.

---

## 🚀 Install (one command on the TV)

1. 🔌 Log in to the TV's root shell from your computer:
   ```sh
   telnet <TV IP address>
   ```
2. 📋 Paste this one line and press Enter:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-launcher-LG/main/install/install.sh | sh
   ```
3. ⏳ Wait about a minute. The TV downloads everything from GitHub, installs it and checks every step:
   ```
     [ OK ] OpenTV Launcher is installed
     [ OK ] All app files are in place
     [ OK ] Starts automatically every time the TV turns on
     [ OK ] Background watcher is running
     [ OK ] Root access is working
     [ OK ] OpenTV Launcher is on screen

     Done! OpenTV Launcher is installed and verified.
   ```
4. 🎉 That's it. Press **Home** on your remote.

### 🛟 Backup: TV can't reach GitHub?

Some TVs block downloads from the internet. If so, the installer tells you, and you can share the files from your computer instead:

1. 💻 On your computer, get the project, either with git:
   ```sh
   git clone https://github.com/c0d3-ninja/opentv-launcher-LG.git
   cd opentv-launcher-LG
   ```
   or by downloading the ZIP from GitHub (**Code → Download ZIP**), unzipping it and opening a terminal in that folder.
2. 💻 Start sharing it with the TV:
   ```sh
   sh install/serve.sh
   ```
   It finds your computer's IP address and prints the exact line to paste on the TV. Keep the window open. If your computer asks whether to allow incoming connections, click **Allow**.
3. 📺 On the TV's root shell, paste the **INSTALL** line it printed. It looks like this:
   ```sh
   curl -fsS http://192.168.1.4:8000/install/install.sh | sh -s 192.168.1.4 8000
   ```
4. ✅ When the TV says **"Done!"**, press **Ctrl+C** on your computer to stop sharing.

---

## 🗑️ Uninstall

1. 📺 On the TV's root shell, paste:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-launcher-LG/main/install/uninstall.sh | sh
   ```
   (No internet on the TV? Run `sh install/serve.sh` on your computer and paste the **UNINSTALL** line it prints.)
2. ✅ It ends with **"Done! OpenTV Launcher is uninstalled and verified."** LG's own home comes back. The Homebrew Channel and root access are not touched.

---

## 🎮 Using it

| Remote button | What happens |
| --- | --- |
| 🏠 Home | Opens OpenTV Launcher |
| ⬅️ ➡️ ⬆️ ⬇️ | Move around |
| 🆗 OK | Open the app |
| 🔙 Back twice | Recent Lists (open apps) |
| ⬆️ in Recent Lists | Close an app, or Close All |
| 🆗 Hold OK on an app | Edit mode: ⬆️ to **Delete**, OK, then confirm in LG's popup. 🔙 cancels |
| 🏠 LG Home (top bar) | LG's original home screen |
| 🎛️ Sliders (top bar) | Launcher Settings: ⬆️ ⬇️ pick **Hide LG TV apps** or **Show performance**, OK switches it |

---

## 🛠️ Customise

Edit `app/apps.js`, run `sh build-ipk.sh`, then install again:

- ⭐ `dock`: your favourite apps.
- 👁️ `showLgApps`: LG apps that stay visible when **Hide LG TV apps** is on.
- 🔤 `profileInitial`: the letter on the profile button.

---

## 🧩 What's inside

| Path | What it is |
| --- | --- |
| 📁 `app/` | The launcher screen (HTML, CSS, JavaScript). |
| 🛟 `app/boot.js` | The safety net: on any error it shows a message and opens LG's home. |
| 📋 `app/apps.js` | Your favourites and which LG apps stay visible. |
| ⚙️ `service/` | A small background service with root access. It copies icons, reads LG's recent list, closes and deletes apps, reads memory and storage, saves settings and restarts the TV. It can't run arbitrary commands. |
| 👀 `app/autostart.sh` | The watcher. It opens the launcher at power on, on wake and on Home, and remembers recently used apps. |
| 📦 `dist/` | The ready-to-install IPK. |
| 🧰 `install/` | `install.sh` and `uninstall.sh` (run on the TV), `serve.sh` (backup: shares the files from your computer). |
| 🖼️ `docs/screenshots/` | The before and after pictures. |
| 🏗️ `build-ipk.sh` | Builds the IPK from `app/` and `service/`. |

📝 The log on the TV is `/tmp/opentvlauncher.log`. If something isn't working, check it first.

---

## 🔄 Updating

Run the same install command again on the TV. It replaces the old version and keeps your settings and recent apps.

---

## 🩺 Troubleshooting

- 🔤 **Tiles show letters instead of icons:** wait a few seconds and press **Home**. Icons are copied in the background.
- 🔒 **"Root access is not on yet":** press **Home** once. The watcher turns it on by itself.
- 🏠 **LG's home shows instead of the launcher:** the watcher may not be running. Run the install command again.
- 🌐 **The TV can't download from GitHub:** use the backup method with `install/serve.sh`.
- 📝 **Anything else:** on the TV, run `cat /tmp/opentvlauncher.log` and include it when you report the problem.

---

## 🐢 Good to know (small trade-offs)

- ⏱️ **When the TV turns on,** LG's own screen shows first, and OpenTV Launcher takes over after about **3 to 5 seconds**.
- ⚡ **After pressing Home or Back,** OpenTV Launcher appears after a short moment, from about **0.1 to 1 second**. You may briefly see LG's home before it.

This is because LG doesn't let other apps replace its home screen directly, so OpenTV Launcher steps in right after LG's home opens.

---

## ⚠️ Disclaimer

- 🔓 Rooting your TV **may void its warranty** and can, in rare cases, damage it. **You do this at your own risk.**
- 🤝 This is an **unofficial, community project.** It is **not affiliated with, endorsed by or supported by LG Electronics or Apple.** "LG", "webOS" and "Apple TV" are trademarks of their owners.
- 🔄 LG software updates may remove root access or stop this launcher from working.
- 🧯 The software is provided **"as is", without warranty of any kind.** The authors are not responsible for any damage, data loss or other problems.
