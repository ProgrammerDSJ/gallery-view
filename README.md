# GalleryView

[![Obsidian Minimum Version](https://img.shields.io/badge/Obsidian-v0.15.0%2B-purple.svg?style=flat-square)](https://obsidian.md)
[![Latest Release](https://img.shields.io/badge/Release-v1.0.1-blue.svg?style=flat-square)](https://github.com/ProgrammerDSJ/gallery-view/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/ProgrammerDSJ/gallery-view/pulls)

Keep your vault clean. GalleryView sends pasted images straight into a hidden `.gallery/` folder and gives you a dedicated photo gallery inside Obsidian to view, sort, and manage them.

Built by **Devansh Jhawar** ([@ProgrammerDSJ](https://github.com/ProgrammerDSJ)).

---

## Why I Built This

Every time I paste a screenshot or drop an image into my notes, Obsidian dumps the file into my vault root or a visible attachment folder. Over time, the file tree gets completely clogged with dozens of random `Pasted image 2026...png` files.

I hated having my workspace look messy. Setting up attachment folders manually for every project was annoying, and having images cluttering my note tree was a constant headache.

I wanted something simple:
1. Every image I paste or drop should go straight into a hidden `.gallery/` folder.
2. It should never appear in Obsidian's visible file explorer.
3. I still want to view, organize, and use my images, so I needed a dedicated Gallery View that reads the hidden folder like a real photo gallery app.

That is why I created GalleryView.

---

## Key Features

### 1. Zero File Tree Clutter
All pasted and dropped images are stored inside `.gallery/`. Because of the leading dot, Obsidian completely hides it from the native file explorer. Your note tree stays completely clean.

### 2. Native Previews Everywhere
Normally, Obsidian cannot resolve links to files inside hidden dot-folders and shows a "could not be found" error. GalleryView uses an in-memory virtual registry so every image resolves natively in Live Preview, Reading View, and Canvas.

### 3. Dedicated Gallery View Tab
Open the gallery as a full tab, a split leaf, or a floating window. It gives you a clean view of all your images and subfolders with responsive thumbnail cards.

### 4. Folder & Subfolder Management
Create subfolders like `.gallery/Wallpapers` or `.gallery/Screenshots` directly inside the gallery. Move images by dragging them onto folder cards or via the right-click menu.

### 5. Star Favourites
Click the star icon on any image card to mark it as a favourite. Filter by favourites in one click from the top toolbar.

### 6. Fullscreen Lightbox
Click any image to open a full modal viewer. Zoom in with mouse wheel or buttons, click and drag to pan around, and navigate through your folder with the Left and Right arrow keys.

### 7. Quick Image Picker for Notes and Canvas
Run `GalleryView: Insert image from gallery` from the Command Palette. It opens a visual modal with live thumbnails and fuzzy search so you can find and insert images in seconds.

### 8. Direct Image Copying
Right-click any card in the gallery and choose "Copy Image to Clipboard" to copy the actual image binary. You can paste it straight into Discord, Photoshop, or your browser without hunting for the file on disk.

---

## How It Works

```
                  Copy-Paste or Drag-Drop Image
                               │
                               ▼
                 ┌───────────────────────────┐
                 │   GalleryView Interceptor │
                 │   - Catches image file    │
                 │   - Saves to .gallery/    │
                 │   - Inserts wikilink      │
                 └─────────────┬─────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
    ┌───────────────────────┐     ┌───────────────────────┐
    │ Obsidian File Tree    │     │ Dedicated Gallery App │
    │                       │     │                       │
    │ HIDDEN from explorer  │     │ - Subfolders          │
    │ (Zero clutter in root)│     │ - Thumbnail grids     │
    │                       │     │ - Star favourites     │
    │                       │     │ - Lightbox viewer     │
    └───────────────────────┘     └───────────────────────┘
```

---

## Installation

### Option 1: Community Plugins (Recommended once listed)
1. Open Obsidian **Settings** > **Community plugins**.
2. Make sure Restricted mode is turned off.
3. Click **Browse** and search for **GalleryView**.
4. Click **Install**, then click **Enable**.

### Option 2: Manual Installation
1. Go to the [Releases](https://github.com/ProgrammerDSJ/gallery-view/releases) page.
2. Download `main.js`, `manifest.json`, and `styles.css`.
3. In your vault directory, go to `.obsidian/plugins/` and create a folder named `galleryview`.
4. Move the downloaded files into `.obsidian/plugins/galleryview/`.
5. In Obsidian, go to **Settings** > **Community plugins** and turn on **GalleryView**.

### Option 3: Via BRAT
1. Install the **Obsidian42 - BRAT** community plugin.
2. Open the Command Palette (`Ctrl+P` or `Cmd+P`).
3. Run `BRAT: Add a beta plugin for testing`.
4. Enter `ProgrammerDSJ/gallery-view`.
5. Turn on **GalleryView** under Community plugins.

---

## Usage Guide

### Pasting Images
Work on your notes normally. When you press `Ctrl+V` (or `Cmd+V`) with an image in your clipboard, GalleryView automatically saves the file into `.gallery/` and inserts a standard Obsidian wikilink:

```markdown
![[Pasted image 20261021 125519.png]]
```

The image appears in Live Preview and Reading View without showing up in your file tree.

### Opening the Gallery
- Click the **image icon** in the left ribbon.
- Open the Command Palette (`Ctrl+P` / `Cmd+P`) and choose `GalleryView: Open Gallery View`.
- To open in a popout window, choose `GalleryView: Open Gallery View in new window`.

### Managing Folders and Images
- **Create folder**: Click the **Folder** button in the gallery toolbar.
- **Navigate**: Double-click folder cards to enter. Use the breadcrumb bar at the top or the Back button to move up.
- **Move image**: Drag any image card onto a folder card, or right-click and pick **Move to Folder...**.
- **Mark favourite**: Click the star icon on any image card to favourite it. Click the star in the top toolbar to view only your favourites.
- **Fullscreen view**: Click any image to open the Lightbox. Zoom with `+` / `-` or mouse wheel, drag to pan, and use Left/Right arrow keys to navigate.

### Inserting Images from the Command Palette
When editing any note or canvas:
1. Press `Ctrl+P` (or `Cmd+P`).
2. Search for `GalleryView: Insert image from gallery`.
3. Type to filter through all images across `.gallery/` with live visual previews.
4. Press `Enter` to insert the selected image at your cursor position.

---

## Settings

Go to **Settings** > **GalleryView** to configure:

| Setting | Default | Description |
| :--- | :---: | :--- |
| **Gallery Root Folder** | `.gallery` | Hidden folder where all gallery media is saved. |
| **Default Attachment Folder** | `.gallery` | Destination folder for new pasted/dropped images. |
| **Link Format** | `Wikilink` | Format used when inserting images (`![[image.png]]` or `Markdown`). |
| **Default Grid Size** | `Medium` | Thumbnail card size in the gallery (`Small`, `Medium`, `Large`). |
| **Show Notifications** | `On` | Displays a brief notice when an image is saved to `.gallery/`. |

---

## Contributing

Contributions, bug reports, and suggestions are welcome.
1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/cool-idea`).
3. Commit your changes (`git commit -m "feat: add cool idea"`).
4. Push to your branch (`git push origin feature/cool-idea`).
5. Open a Pull Request.

---

## License

This project is licensed under the [MIT License](LICENSE).
Free to use, modify, and distribute.
