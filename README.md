# GalleryView

Keep your vault clean. Send pasted images straight into a hidden folder and manage everything inside a dedicated gallery app built into Obsidian.

Built by **Devansh Jhawar** ([@ProgrammerDSJ](https://github.com/ProgrammerDSJ)).

---

## Why I Built This

Every time I work in Obsidian and paste a screenshot or add an image to my notes, Obsidian dumps the file into my vault root or a visible attachments folder. Over time, my file explorer gets completely cluttered with dozens of random `Pasted image 2026...png` files.

I hate having my workspace look messy. Setting up attachment folders manually for every single project or dealing with cluttered sidebars was annoying. 

I wanted three simple things:
1. When I copy-paste or drop an image into a note, it should save straight into a hidden `.gallery/` folder inside the vault.
2. It should never appear in Obsidian's native file explorer tree.
3. I still want to actually see, organize, and use my images, so I needed a dedicated Gallery View that reads `.gallery/` like a real photo gallery app.

That is why I made GalleryView.

---

## What It Does

- **Zero sidebar clutter**: All pasted and dropped images are stored inside `.gallery/`. Because of the leading dot, Obsidian's native file tree completely hides it. Your notes stay front and center.
- **Seamless note previews**: In standard Obsidian, files inside dot-folders usually show up as "could not be found". GalleryView resolves these under the hood so every image renders properly in Live Preview, Reading View, and Canvas.
- **Dedicated Gallery View**: A full gallery workspace inside Obsidian. You get folder navigation, responsive thumbnail grids, search, sorting, and full keyboard-friendly controls.
- **Folder and subfolder management**: Organize images into subfolders like `.gallery/Wallpapers` or `.gallery/Screenshots`. Move images around by dragging them onto folder cards or using the right-click menu.
- **Star favourites**: Mark your best images with a star and toggle the favourite filter whenever you want quick access.
- **Fullscreen Lightbox**: Click any image to open a full modal viewer. Zoom in, pan around, use left and right arrow keys to browse, and copy what you need.
- **Quick insert from command palette**: Run `GalleryView: Insert image from gallery` while editing a note or canvas. It opens a visual picker with live thumbnails so you can find and insert images in seconds.
- **Copy images directly**: Right-click any image to copy the actual image binary to your clipboard, not just the markdown link. You can paste it straight into Discord, Photoshop, or your browser.

---

## Installation

### From Obsidian Community Plugins (Recommended once listed)
1. Open Obsidian **Settings** > **Community plugins**.
2. Make sure Restricted mode is turned off.
3. Click **Browse** and search for `GalleryView`.
4. Click **Install**, then click **Enable**.

### Manual Installation
1. Go to the [Releases](https://github.com/ProgrammerDSJ/gallery-view/releases) page on GitHub.
2. Download `main.js`, `manifest.json`, and `styles.css`.
3. In your vault, navigate to `.obsidian/plugins/` and create a folder named `galleryview`.
4. Paste the downloaded files into that folder.
5. In Obsidian, go to **Settings** > **Community plugins** and toggle **GalleryView** on.

### Via BRAT
If you use the [Obsidian42 - BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin:
1. Open the Command Palette (`Ctrl+P` or `Cmd+P`).
2. Run `BRAT: Add a beta plugin for testing`.
3. Enter `ProgrammerDSJ/gallery-view`.
4. Enable the plugin under Community plugins.

---

## How to Use It

### 1. Adding images to notes
Just paste an image (`Ctrl+V` / `Cmd+V`) or drag and drop an image file into your note. 
GalleryView catches the image, saves it into `.gallery/`, and inserts a clean wikilink:
```markdown
![[Pasted image 20261021 125519.png]]
```
The file never touches your visible root folder.

### 2. Opening the Gallery View
You have three ways to open it:
- Click the **image icon** in the left ribbon.
- Open the Command Palette (`Ctrl+P`) and run `GalleryView: Open Gallery View`.
- Open in a new tab or floating window with `GalleryView: Open Gallery View in new window`.

### 3. Browsing and organizing folders
Inside the Gallery View:
- Click **Folder** in the top toolbar to create a new subfolder.
- Double-click any folder card to enter it.
- Use the clickable breadcrumbs at the top (e.g. `Gallery / Wallpapers / Nature`) or the back button to navigate.
- Drag any image card onto a folder card to move it into that folder.

### 4. Working with images
- **Favourite**: Click the star icon on any card to toggle favourite status. Click the star in the top toolbar to filter by favourites only.
- **Fullscreen view**: Click any image to open the lightbox. Use `+` and `-` to zoom, click and drag to pan, and press `Left` or `Right` arrow keys to jump between images. Press `Esc` to close.
- **Right-click menu**: Right-click any card to:
  - Insert into active note or canvas
  - Copy wikilink embed
  - Copy markdown link
  - Copy image to clipboard (actual image data)
  - Move to folder
  - Rename image
  - Delete image

### 5. Inserting images into your notes or canvas
While you are inside any note or canvas:
1. Press `Ctrl+P` (or `Cmd+P`).
2. Type `GalleryView: Insert image from gallery`.
3. A search modal pops up with image thumbnails, filenames, folders, and dates.
4. Type to search, highlight the one you want, and hit `Enter`. It drops right into your cursor position.

---

## Settings

Go to **Settings** > **GalleryView** to customize your setup:

- **Gallery Root Folder**: The hidden folder where all gallery files live. Default is `.gallery`.
- **Default Attachment Folder**: Choose whether new pasted images land in root `.gallery` or a specific subfolder.
- **Link Format**: Choose between:
  - `Standard Wikilink ![[image.png]]` (Recommended, clean and handles spaces natively)
  - `Path Wikilink ![[.gallery/image.png]]`
  - `Standard Markdown ![name](.gallery/...)` (URL-encoded)
- **Default Grid Size**: Small, Medium, or Large thumbnail cards.
- **Show Notifications**: Toggle the quick notification popup when an image is saved.

---

## Support & Feedback

If you run into any bugs or have ideas to make this better, please open an issue on the [GitHub repository](https://github.com/ProgrammerDSJ/gallery-view/issues).

---

## License

MIT License. Feel free to use it, tweak it, and share it.
