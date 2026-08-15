# Suno Mass Backup

Unofficial Chrome extension for backing up audio from **your own Suno account**.

## Features

- ❤️ **Likes only by default**
- 📚 Optional **entire library**
- One full library index: switch Likes ↔ All later without rescanning
- WAV or MP3
- Persistent scan and download queue
- Pause / resume
- Automatic multi-file downloads
- Download history to avoid duplicates
- 429 backoff
- Designed for very large libraries

## Installation

1. Click **Code → Download ZIP** on this repository and extract it.
2. Run `INSTALL_WINDOWS.bat`, or open `chrome://extensions/` manually.
3. Enable **Developer mode**.
4. Click **Load unpacked / Cargar descomprimida**.
5. Select the installed extension folder.
6. Open `suno.com`, sign in, and keep at least one Suno tab open.

> Chrome on Windows does not allow arbitrary GitHub extensions to install silently. The included installer reduces the process to the minimum number of manual steps.

## How it works

Suno Mass Backup performs one complete scan of your library and stores the Like flag for every song. After that you can choose at download time between:

- ❤️ **Likes only** — default
- 📚 **All songs**

Changing the download filter does not require another scan.

For audio, choose:

- **WAV** — maximum available quality
- **MP3** — faster and smaller

The scan and download queue are persistent, so the popup can be closed and the work can continue in the background. Download history is stored locally to avoid re-downloading files that are already recorded.

## Privacy

The extension does not send your Suno library, credentials, or download history to the extension developer. Authentication is read locally from your existing Suno tab. Library metadata and progress are kept in Chrome local extension storage.

See `PRIVACY.md`.

## Disclaimer

Suno Mass Backup is an unofficial independent project and is not affiliated with, endorsed by, or sponsored by Suno.

Use it only with content/accounts you are authorized to access. Users are responsible for complying with Suno's terms and applicable law.
