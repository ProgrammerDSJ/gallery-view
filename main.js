const {
  Plugin,
  ItemView,
  WorkspaceLeaf,
  Modal,
  SuggestModal,
  Notice,
  Setting,
  PluginSettingTab,
  Menu,
  setIcon,
  normalizePath,
  TFile
} = require("obsidian");

const VIEW_TYPE_GALLERY = "gallery-view";

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"
]);

const DEFAULT_SETTINGS = {
  galleryRoot: ".gallery",
  defaultFolder: ".gallery",
  linkFormat: "wikilink", // "wikilink" | "wikilink-path" | "markdown"
  defaultGridSize: "medium", // "small" | "medium" | "large"
  defaultSort: "mtime-desc",
  showNotifications: true,
  favorites: []
};

// Utilities
function isImage(filePath) {
  if (!filePath) return false;
  const ext = filePath.split(".").pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function getBaseName(filePath) {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.pop() || "";
}

function getParentPath(filePath) {
  const parts = filePath.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/") || ".";
}

// Main Plugin Class
class GalleryViewPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // In-memory virtual index of all files inside .gallery/
    this.virtualFiles = new Map();

    // Ensure .gallery folder exists
    await this.ensureDirectory(this.settings.galleryRoot);

    // Patch Obsidian metadataCache and vault link resolvers
    this.patchLinkResolvers();

    // Scan and build initial index of .gallery
    await this.refreshVirtualIndex();

    // Register custom Gallery View
    this.registerView(
      VIEW_TYPE_GALLERY,
      (leaf) => new GalleryView(leaf, this)
    );

    // Add ribbon icon to open Gallery View
    this.addRibbonIcon("image", "Open Gallery View", () => {
      this.activateGalleryView(false);
    });

    // Add Commands
    this.addCommand({
      id: "open-gallery-view",
      name: "Open Gallery View",
      callback: () => {
        this.activateGalleryView(false);
      }
    });

    this.addCommand({
      id: "open-gallery-view-new-tab",
      name: "Open Gallery View in new tab",
      callback: () => {
        this.activateGalleryView(true);
      }
    });

    this.addCommand({
      id: "open-gallery-view-window",
      name: "Open Gallery View in new window",
      callback: async () => {
        const leaf = this.app.workspace.openPopoutLeaf();
        await leaf.setViewState({
          type: VIEW_TYPE_GALLERY,
          active: true
        });
      }
    });

    this.addCommand({
      id: "insert-image-from-gallery",
      name: "Insert image from gallery",
      callback: () => {
        new GalleryImagePickerModal(this.app, this, (selectedImage) => {
          this.insertImageIntoActiveView(selectedImage);
        }).open();
      }
    });

    // Register Attachment Interceptors for Paste and Drop in notes
    this.registerAttachmentInterceptors();

    // Register DOM mutation observer and post-processor
    this.registerImageResolvers();

    // Settings tab
    this.addSettingTab(new GallerySettingTab(this.app, this));

    // Watch vault changes to auto-refresh index
    this.app.workspace.onLayoutReady(() => {
      this.refreshVirtualIndex();
      this.resolveAllVisibleEmbeds();
    });
  }

  async onunload() {
    // Restore original methods if patched
    if (this._origGetFirstLinkpathDest) {
      this.app.metadataCache.getFirstLinkpathDest = this._origGetFirstLinkpathDest;
    }
    if (this._origGetAbstractFileByPath) {
      this.app.vault.getAbstractFileByPath = this._origGetAbstractFileByPath;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!Array.isArray(this.settings.favorites)) {
      this.settings.favorites = [];
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  isFavorite(path) {
    return this.settings.favorites.includes(normalizePath(path));
  }

  async toggleFavorite(path) {
    const norm = normalizePath(path);
    const idx = this.settings.favorites.indexOf(norm);
    if (idx >= 0) {
      this.settings.favorites.splice(idx, 1);
    } else {
      this.settings.favorites.push(norm);
    }
    await this.saveSettings();
    this.refreshGalleryViews();
  }

  refreshGalleryViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GALLERY);
    for (const leaf of leaves) {
      if (leaf.view instanceof GalleryView) {
        leaf.view.loadGallery();
      }
    }
  }

  async ensureDirectory(dirPath) {
    const normalized = normalizePath(dirPath);
    const exists = await this.app.vault.adapter.exists(normalized);
    if (!exists) {
      try {
        await this.app.vault.adapter.mkdir(normalized);
      } catch (e) {
        console.error("Failed to create directory", normalized, e);
      }
    }
  }

  // Virtual TFile Indexing
  createVirtualTFile(filePath, stat, proto) {
    const name = filePath.split("/").pop();
    const dotIdx = name.lastIndexOf(".");
    const ext = dotIdx >= 0 ? name.slice(dotIdx + 1).toLowerCase() : "";
    const basename = dotIdx >= 0 ? name.slice(0, dotIdx) : name;

    const file = Object.create(proto);
    file.vault = this.app.vault;
    file.path = filePath;
    file.name = name;
    file.basename = basename;
    file.extension = ext;
    file.deleted = false;
    file.saving = false;
    file.parent = this.app.vault.getRoot();
    file.stat = stat || { ctime: Date.now(), mtime: Date.now(), size: 0 };
    return file;
  }

  async refreshVirtualIndex() {
    this.virtualFiles.clear();
    const files = this.app.vault.getFiles();
    const proto = files.length > 0 ? Object.getPrototypeOf(files[0]) : Object.prototype;

    const scan = async (dir) => {
      try {
        const list = await this.app.vault.adapter.list(dir);
        for (const f of list.files) {
          if (isImage(f)) {
            const stat = await this.app.vault.adapter.stat(f);
            const vFile = this.createVirtualTFile(f, stat, proto);

            // Index under multiple keys for resilient matching:
            // 1. Full path: ".gallery/Wallpapers/sunset.png"
            this.virtualFiles.set(f, vFile);
            this.virtualFiles.set(f.toLowerCase(), vFile);

            // 2. Relative without .gallery: "Wallpapers/sunset.png"
            const rel = f.replace(/^\.gallery\//, "");
            this.virtualFiles.set(rel, vFile);
            this.virtualFiles.set(rel.toLowerCase(), vFile);

            // 3. Filename only: "sunset.png"
            this.virtualFiles.set(vFile.name, vFile);
            this.virtualFiles.set(vFile.name.toLowerCase(), vFile);

            // 4. URL decoded & encoded
            this.virtualFiles.set(decodeURIComponent(vFile.name), vFile);
            this.virtualFiles.set(encodeURIComponent(vFile.name), vFile);
          }
        }
        for (const s of list.folders) {
          await scan(s);
        }
      } catch (e) {
        console.error("GalleryView index error:", e);
      }
    };

    await scan(this.settings.galleryRoot);
  }

  resolveVirtual(linkpath) {
    if (!linkpath) return null;
    let clean = linkpath.trim().replace(/^[\/\\]+/, "");

    // 1. Exact match
    if (this.virtualFiles.has(clean)) return this.virtualFiles.get(clean);
    if (this.virtualFiles.has(clean.toLowerCase())) return this.virtualFiles.get(clean.toLowerCase());

    // 2. Name only
    const name = clean.split("/").pop();
    if (this.virtualFiles.has(name)) return this.virtualFiles.get(name);
    if (this.virtualFiles.has(name.toLowerCase())) return this.virtualFiles.get(name.toLowerCase());

    // 3. URL decoded match
    try {
      const decoded = decodeURIComponent(clean);
      if (this.virtualFiles.has(decoded)) return this.virtualFiles.get(decoded);
      const decName = decoded.split("/").pop();
      if (this.virtualFiles.has(decName)) return this.virtualFiles.get(decName);
    } catch (e) {}

    // 4. Prefix match for markdown links truncated at space (e.g. "Screenshot 2026-10-21...")
    for (const [key, vFile] of this.virtualFiles.entries()) {
      if (key.startsWith(clean + " ") || key.startsWith(".gallery/" + name + " ") || key.startsWith(name + " ")) {
        return vFile;
      }
    }

    return null;
  }

  patchLinkResolvers() {
    this._origGetFirstLinkpathDest = this.app.metadataCache.getFirstLinkpathDest.bind(this.app.metadataCache);
    this._origGetAbstractFileByPath = this.app.vault.getAbstractFileByPath.bind(this.app.vault);

    this.app.metadataCache.getFirstLinkpathDest = (linkpath, sourcePath) => {
      const v = this.resolveVirtual(linkpath);
      if (v) return v;
      return this._origGetFirstLinkpathDest(linkpath, sourcePath);
    };

    this.app.vault.getAbstractFileByPath = (filePath) => {
      const v = this.resolveVirtual(filePath);
      if (v) return v;
      return this._origGetAbstractFileByPath(filePath);
    };
  }

  async activateGalleryView(inNewLeaf = false) {
    let leaf = null;
    const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GALLERY);
    if (existingLeaves.length > 0 && !inNewLeaf) {
      leaf = existingLeaves[0];
    } else {
      leaf = inNewLeaf
        ? this.app.workspace.getLeaf("tab")
        : this.app.workspace.getLeaf(false);
      await leaf.setViewState({
        type: VIEW_TYPE_GALLERY,
        active: true
      });
    }
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  // Intercept images pasted or dropped into Markdown editor or Canvas
  registerAttachmentInterceptors() {
    // 1. Editor Paste (Markdown note)
    this.registerEvent(
      this.app.workspace.on("editor-paste", async (evt, editor, info) => {
        const clipboard = evt.clipboardData;
        if (!clipboard) return;

        const imageFiles = [];
        if (clipboard.files && clipboard.files.length > 0) {
          for (let i = 0; i < clipboard.files.length; i++) {
            const f = clipboard.files[i];
            if (f.type.startsWith("image/")) {
              imageFiles.push(f);
            }
          }
        } else if (clipboard.items && clipboard.items.length > 0) {
          for (let i = 0; i < clipboard.items.length; i++) {
            const it = clipboard.items[i];
            if (it.type.startsWith("image/")) {
              const f = it.getAsFile();
              if (f) imageFiles.push(f);
            }
          }
        }

        if (imageFiles.length === 0) return;

        // Prevent Obsidian's native attachment saving to visible folders
        evt.preventDefault();
        evt.stopPropagation();

        for (const file of imageFiles) {
          await this.saveImageAndInsertToEditor(file, editor);
        }
      })
    );

    // 2. Editor Drop (Markdown note)
    this.registerEvent(
      this.app.workspace.on("editor-drop", async (evt, editor, info) => {
        const dataTransfer = evt.dataTransfer;
        if (!dataTransfer || !dataTransfer.files || dataTransfer.files.length === 0) return;

        const imageFiles = [];
        for (let i = 0; i < dataTransfer.files.length; i++) {
          const f = dataTransfer.files[i];
          if (f.type.startsWith("image/") || isImage(f.name)) {
            imageFiles.push(f);
          }
        }

        if (imageFiles.length === 0) return;

        evt.preventDefault();
        evt.stopPropagation();

        for (const file of imageFiles) {
          await this.saveImageAndInsertToEditor(file, editor);
        }
      })
    );

    // 3. Global DOM Paste & Drop for Canvas View
    this.registerDomEvent(document, "paste", async (evt) => {
      const activeLeaf = this.app.workspace.activeLeaf;
      if (!activeLeaf || !activeLeaf.view || activeLeaf.view.getViewType() !== "canvas") return;

      const clipboard = evt.clipboardData;
      if (!clipboard) return;

      const imageFiles = [];
      if (clipboard.files && clipboard.files.length > 0) {
        for (let i = 0; i < clipboard.files.length; i++) {
          if (clipboard.files[i].type.startsWith("image/")) {
            imageFiles.push(clipboard.files[i]);
          }
        }
      }

      if (imageFiles.length === 0) return;

      evt.preventDefault();
      evt.stopPropagation();

      for (const file of imageFiles) {
        await this.saveImageAndAddToCanvas(file, activeLeaf.view);
      }
    });

    this.registerDomEvent(document, "drop", async (evt) => {
      const activeLeaf = this.app.workspace.activeLeaf;
      if (!activeLeaf || !activeLeaf.view || activeLeaf.view.getViewType() !== "canvas") return;

      const dt = evt.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0) return;

      const imageFiles = [];
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files[i];
        if (f.type.startsWith("image/") || isImage(f.name)) {
          imageFiles.push(f);
        }
      }

      if (imageFiles.length === 0) return;

      evt.preventDefault();
      evt.stopPropagation();

      for (const file of imageFiles) {
        await this.saveImageAndAddToCanvas(file, activeLeaf.view);
      }
    });
  }

  async generateUniqueFilename(baseDir, originalName, ext) {
    let filename = "";
    if (originalName && originalName !== "image.png" && originalName !== "blob") {
      filename = originalName;
    } else {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      filename = `Pasted image ${stamp}.${ext || "png"}`;
    }

    const dotIdx = filename.lastIndexOf(".");
    const nameWithoutExt = dotIdx >= 0 ? filename.slice(0, dotIdx) : filename;
    const fileExt = dotIdx >= 0 ? filename.slice(dotIdx + 1) : ext || "png";

    let candidate = filename;
    let counter = 1;
    while (await this.app.vault.adapter.exists(normalizePath(`${baseDir}/${candidate}`))) {
      candidate = `${nameWithoutExt}-${counter}.${fileExt}`;
      counter++;
    }
    return candidate;
  }

  async saveImageAndInsertToEditor(file, editor) {
    const ext = file.name ? file.name.split(".").pop() : (file.type ? file.type.split("/").pop() : "png");
    const targetFolder = this.settings.defaultFolder || this.settings.galleryRoot;
    await this.ensureDirectory(targetFolder);

    const filename = await this.generateUniqueFilename(targetFolder, file.name, ext);
    const targetPath = normalizePath(`${targetFolder}/${filename}`);

    const buffer = await file.arrayBuffer();
    await this.app.vault.adapter.writeBinary(targetPath, buffer);

    // Immediately update index
    await this.refreshVirtualIndex();

    if (this.settings.showNotifications) {
      new Notice(`GalleryView: Image saved to ${targetPath}`);
    }

    // Insert link into markdown note
    const link = this.formatImageLink(targetPath, filename);
    editor.replaceSelection(link + "\n");

    this.refreshGalleryViews();
    this.resolveAllVisibleEmbeds();
  }

  async saveImageAndAddToCanvas(file, canvasView) {
    const ext = file.name ? file.name.split(".").pop() : "png";
    const targetFolder = this.settings.defaultFolder || this.settings.galleryRoot;
    await this.ensureDirectory(targetFolder);

    const filename = await this.generateUniqueFilename(targetFolder, file.name, ext);
    const targetPath = normalizePath(`${targetFolder}/${filename}`);

    const buffer = await file.arrayBuffer();
    await this.app.vault.adapter.writeBinary(targetPath, buffer);

    await this.refreshVirtualIndex();

    if (this.settings.showNotifications) {
      new Notice(`GalleryView: Image saved to ${targetPath}`);
    }

    this.addImageToCanvasView(canvasView, targetPath);
    this.refreshGalleryViews();
  }

  addImageToCanvasView(canvasView, filePath) {
    const canvas = canvasView.canvas;
    if (!canvas) return;

    const center = canvas.posCenter ? canvas.posCenter() : { x: 0, y: 0 };
    const width = 360;
    const height = 280;

    if (typeof canvas.createFileNode === "function") {
      canvas.createFileNode({
        file: filePath,
        pos: { x: center.x - width / 2, y: center.y - height / 2 },
        size: { width, height }
      });
      canvas.requestSave && canvas.requestSave();
    } else if (typeof canvas.createTextNode === "function") {
      canvas.createTextNode({
        text: `![image](${filePath})`,
        pos: { x: center.x - width / 2, y: center.y - height / 2 },
        size: { width, height }
      });
      canvas.requestSave && canvas.requestSave();
    }
  }

  formatImageLink(filePath, altText) {
    const cleanPath = filePath.replace(/\\/g, "/");
    const name = altText || getBaseName(cleanPath);

    if (this.settings.linkFormat === "wikilink") {
      // Natural wikilink (recommended: no space-escaping issues!)
      return `![[${name}]]`;
    } else if (this.settings.linkFormat === "wikilink-path") {
      return `![[${cleanPath}]]`;
    } else {
      // Markdown format with proper URL encoding for spaces
      const encoded = cleanPath.split("/").map(seg => encodeURIComponent(seg)).join("/");
      return `![${name}](${encoded})`;
    }
  }

  insertImageIntoActiveView(imageInfo) {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf || !activeLeaf.view) {
      new Notice("No active note or canvas to insert image into.");
      return;
    }

    const viewType = activeLeaf.view.getViewType();
    if (viewType === "markdown") {
      const editor = activeLeaf.view.editor;
      if (editor) {
        const link = this.formatImageLink(imageInfo.path, imageInfo.name);
        editor.replaceSelection(link);
        new Notice(`Inserted: ${imageInfo.name}`);
        setTimeout(() => this.resolveAllVisibleEmbeds(), 100);
      }
    } else if (viewType === "canvas") {
      this.addImageToCanvasView(activeLeaf.view, imageInfo.path);
      new Notice(`Added to Canvas: ${imageInfo.name}`);
    } else {
      new Notice("Active view is not a markdown note or canvas.");
    }
  }

  // DOM Resolver & Mutation Observer
  resolveElementEmbed(el) {
    const src = el.getAttribute("src");
    const alt = el.getAttribute("alt");
    const v = this.resolveVirtual(src) || this.resolveVirtual(alt);

    if (v) {
      const realUrl = this.app.vault.adapter.getResourcePath(v.path);
      if (el.tagName === "IMG") {
        if (el.src !== realUrl) {
          el.src = realUrl;
        }
      } else {
        el.empty();
        const img = document.createElement("img");
        img.src = realUrl;
        img.alt = v.name;
        el.appendChild(img);
        el.removeClass("mod-empty-attachment");
        el.removeClass("mod-empty");
        el.addClass("image-embed");
        el.addClass("is-loaded");
      }
      return true;
    }
    return false;
  }

  resolveAllVisibleEmbeds() {
    document.querySelectorAll(".internal-embed, img").forEach((el) => {
      this.resolveElementEmbed(el);
    });
  }

  registerImageResolvers() {
    // 1. Reading view post-processor
    this.registerMarkdownPostProcessor((element) => {
      element.querySelectorAll('.internal-embed, img').forEach((el) => {
        this.resolveElementEmbed(el);
      });
    });

    // 2. Live Preview and Canvas DOM Observer
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            if (n.classList && (n.classList.contains("internal-embed") || n.tagName === "IMG")) {
              this.resolveElementEmbed(n);
            }
            if (n.querySelectorAll) {
              n.querySelectorAll(".internal-embed, img").forEach((child) => {
                this.resolveElementEmbed(child);
              });
            }
            if (n.classList && (n.classList.contains("canvas-node") || n.classList.contains("canvas-node-content"))) {
              this.resolveCanvasNode(n);
            }
          }
        }
      }
    });

    this.app.workspace.onLayoutReady(() => {
      observer.observe(document.body, { childList: true, subtree: true });
      this.resolveAllVisibleEmbeds();
    });

    this.register(() => observer.disconnect());
  }

  resolveCanvasNode(nodeEl) {
    const emptyContainer = nodeEl.querySelector(".canvas-node-content.mod-canvas-empty");
    if (!emptyContainer) return;

    const labelEl = nodeEl.querySelector(".canvas-node-label") || nodeEl.querySelector(".canvas-empty-embed-label");
    const text = labelEl?.textContent || "";
    const v = this.resolveVirtual(text);

    if (v) {
      const realUrl = this.app.vault.adapter.getResourcePath(v.path);
      emptyContainer.empty();
      emptyContainer.removeClass("mod-canvas-empty");
      const img = document.createElement("img");
      img.src = realUrl;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      emptyContainer.appendChild(img);
    }
  }

  async copyImageBinaryToClipboard(imagePath) {
    try {
      const electron = require("electron");
      if (electron && electron.clipboard && electron.nativeImage) {
        const buffer = await this.app.vault.adapter.readBinary(normalizePath(imagePath));
        const uintBuffer = Buffer.from(buffer);
        const image = electron.nativeImage.createFromBuffer(uintBuffer);
        electron.clipboard.writeImage(image);
        new Notice("Copied image to clipboard!");
        return;
      }
    } catch (e) {
      console.warn("Electron clipboard write failed, falling back to blob", e);
    }

    try {
      const buffer = await this.app.vault.adapter.readBinary(normalizePath(imagePath));
      const ext = imagePath.split(".").pop().toLowerCase();
      const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      const blob = new Blob([buffer], { type: mime });
      await navigator.clipboard.write([
        new ClipboardItem({ [mime]: blob })
      ]);
      new Notice("Copied image to clipboard!");
    } catch (e) {
      console.error("Clipboard copy error:", e);
      new Notice("Could not copy image binary directly to clipboard.");
    }
  }

  async scanGallery(folderPath = this.settings.galleryRoot) {
    const normFolder = normalizePath(folderPath);
    await this.ensureDirectory(normFolder);

    const result = {
      currentFolder: normFolder,
      subfolders: [],
      images: []
    };

    try {
      const listing = await this.app.vault.adapter.list(normFolder);

      for (const folder of listing.folders) {
        result.subfolders.push(folder);
      }

      for (const file of listing.files) {
        if (isImage(file)) {
          const stat = await this.app.vault.adapter.stat(file);
          result.images.push({
            path: file,
            name: getBaseName(file),
            folder: normFolder,
            size: stat?.size || 0,
            mtime: stat?.mtime || 0
          });
        }
      }
    } catch (e) {
      console.error("Error scanning gallery folder", normFolder, e);
    }

    return result;
  }

  async scanAllImagesRecursive(folderPath = this.settings.galleryRoot) {
    const normFolder = normalizePath(folderPath);
    await this.ensureDirectory(normFolder);

    const allImages = [];
    const scanDir = async (dir) => {
      try {
        const listing = await this.app.vault.adapter.list(dir);
        for (const file of listing.files) {
          if (isImage(file)) {
            const stat = await this.app.vault.adapter.stat(file);
            allImages.push({
              path: file,
              name: getBaseName(file),
              folder: dir,
              size: stat?.size || 0,
              mtime: stat?.mtime || 0
            });
          }
        }
        for (const sub of listing.folders) {
          await scanDir(sub);
        }
      } catch (e) {
        console.error("Error reading dir", dir, e);
      }
    };

    await scanDir(normFolder);
    return allImages;
  }
}

// Gallery ItemView
class GalleryView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentFolder = this.plugin.settings.galleryRoot;
    this.searchQuery = "";
    this.favoritesOnly = false;
    this.sortOrder = this.plugin.settings.defaultSort || "mtime-desc";
    this.gridSize = this.plugin.settings.defaultGridSize || "medium";

    this.subfolders = [];
    this.images = [];
    this.folderImageCounts = {};
  }

  getViewType() {
    return VIEW_TYPE_GALLERY;
  }

  getDisplayText() {
    return "Gallery";
  }

  getIcon() {
    return "image";
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("galleryview-container");
    await this.loadGallery();
  }

  async loadGallery() {
    const data = await this.plugin.scanGallery(this.currentFolder);
    this.subfolders = data.subfolders;
    this.images = data.images;

    for (const sub of this.subfolders) {
      try {
        const subData = await this.plugin.scanGallery(sub);
        this.folderImageCounts[sub] = subData.images.length;
      } catch (e) {
        this.folderImageCounts[sub] = 0;
      }
    }

    this.render();
  }

  render() {
    this.contentEl.empty();

    // 1. Toolbar
    const toolbar = this.contentEl.createDiv({ cls: "galleryview-toolbar" });
    this.renderToolbar(toolbar);

    // 2. Main Scrollable Body
    const body = this.contentEl.createDiv({ cls: "galleryview-body" });

    // Drag-and-drop into gallery to upload
    body.addEventListener("dragover", (e) => {
      e.preventDefault();
      body.addClass("is-drag-over");
    });
    body.addEventListener("dragleave", () => {
      body.removeClass("is-drag-over");
    });
    body.addEventListener("drop", async (e) => {
      e.preventDefault();
      body.removeClass("is-drag-over");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const f = e.dataTransfer.files[i];
          if (f.type.startsWith("image/") || isImage(f.name)) {
            await this.importFileToCurrentFolder(f);
          }
        }
        await this.loadGallery();
      }
    });

    // Filter images
    let filteredImages = this.images.filter((img) => {
      if (this.favoritesOnly && !this.plugin.isFavorite(img.path)) {
        return false;
      }
      if (this.searchQuery) {
        return img.name.toLowerCase().includes(this.searchQuery.toLowerCase());
      }
      return true;
    });

    // Sort images
    filteredImages.sort((a, b) => {
      switch (this.sortOrder) {
        case "mtime-desc":
          return b.mtime - a.mtime;
        case "mtime-asc":
          return a.mtime - b.mtime;
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "size-desc":
          return b.size - a.size;
        case "size-asc":
          return a.size - b.size;
        default:
          return b.mtime - a.mtime;
      }
    });

    // 3. Subfolders Section
    if (this.subfolders.length > 0 && !this.favoritesOnly) {
      const folderSection = body.createDiv({ cls: "galleryview-folders-section" });
      const folderHeader = folderSection.createDiv({ cls: "galleryview-section-header" });
      folderHeader.createSpan({ cls: "galleryview-section-title", text: "Folders" });
      folderHeader.createSpan({
        cls: "galleryview-section-badge",
        text: String(this.subfolders.length)
      });

      const foldersGrid = folderSection.createDiv({ cls: "galleryview-folders-grid" });
      for (const folderPath of this.subfolders) {
        this.renderFolderCard(foldersGrid, folderPath);
      }
    }

    // 4. Images Section
    const imageSection = body.createDiv({ cls: "galleryview-images-section" });
    const imageHeader = imageSection.createDiv({ cls: "galleryview-section-header" });
    imageHeader.createSpan({ cls: "galleryview-section-title", text: "Images" });
    imageHeader.createSpan({
      cls: "galleryview-section-badge",
      text: `${filteredImages.length} ${filteredImages.length === 1 ? "image" : "images"}`
    });

    if (filteredImages.length === 0) {
      const empty = imageSection.createDiv({ cls: "galleryview-empty-state" });
      const iconWrap = empty.createDiv({ cls: "galleryview-empty-icon" });
      setIcon(iconWrap, "image");
      empty.createDiv({
        cls: "galleryview-empty-title",
        text: this.favoritesOnly
          ? "No favourite images yet"
          : this.searchQuery
          ? "No images match your search"
          : "No images in this folder"
      });
      empty.createDiv({
        cls: "galleryview-empty-desc",
        text: "Paste an image in any note, drop image files here, or use the Add Image button to import."
      });
    } else {
      const imagesGrid = imageSection.createDiv({
        cls: `galleryview-images-grid grid-size-${this.gridSize}`
      });
      filteredImages.forEach((img, idx) => {
        this.renderImageCard(imagesGrid, img, filteredImages, idx);
      });
    }
  }

  renderToolbar(toolbar) {
    const left = toolbar.createDiv({ cls: "galleryview-toolbar-left" });

    const isRoot = this.currentFolder === this.plugin.settings.galleryRoot;
    if (!isRoot) {
      const backBtn = left.createEl("button", {
        cls: "galleryview-icon-btn",
        attr: { title: "Go Back" }
      });
      setIcon(backBtn, "arrow-left");
      backBtn.onclick = () => {
        const parent = getParentPath(this.currentFolder);
        this.currentFolder = parent.startsWith(this.plugin.settings.galleryRoot)
          ? parent
          : this.plugin.settings.galleryRoot;
        this.loadGallery();
      };
    }

    // Breadcrumbs
    const breadcrumbs = left.createDiv({ cls: "galleryview-breadcrumbs" });
    const parts = this.currentFolder.split("/");
    let accum = "";
    parts.forEach((part, index) => {
      accum = accum ? `${accum}/${part}` : part;
      const targetPath = accum;

      if (index > 0) {
        breadcrumbs.createSpan({ cls: "galleryview-breadcrumb-separator", text: "/" });
      }

      const item = breadcrumbs.createSpan({ cls: "galleryview-breadcrumb-item" });
      if (index === 0) {
        const rootIcon = item.createSpan();
        setIcon(rootIcon, "image");
        item.createSpan({ text: "Gallery" });
      } else {
        item.createSpan({ text: part });
      }

      item.onclick = () => {
        if (this.currentFolder !== targetPath) {
          this.currentFolder = targetPath;
          this.loadGallery();
        }
      };
    });

    // Center: Search input
    const center = toolbar.createDiv({ cls: "galleryview-toolbar-center" });
    const searchWrapper = center.createDiv({ cls: "galleryview-search-wrapper" });
    const searchIcon = searchWrapper.createSpan({ cls: "galleryview-search-icon" });
    setIcon(searchIcon, "search");
    const searchInput = searchWrapper.createEl("input", {
      cls: "galleryview-search-input",
      attr: { type: "text", placeholder: "Search images in this folder..." }
    });
    searchInput.value = this.searchQuery;
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value;
      this.render();
    };

    // Right: Actions
    const right = toolbar.createDiv({ cls: "galleryview-toolbar-right" });

    // Favorites Filter Toggle
    const favBtn = right.createEl("button", {
      cls: `galleryview-icon-btn ${this.favoritesOnly ? "is-active" : ""}`,
      attr: { title: "Show Favourites Only" }
    });
    setIcon(favBtn, "star");
    favBtn.onclick = () => {
      this.favoritesOnly = !this.favoritesOnly;
      this.render();
    };

    // New Subfolder
    const newFolderBtn = right.createEl("button", {
      cls: "galleryview-btn",
      text: "Folder"
    });
    const folderIcon = newFolderBtn.createSpan();
    setIcon(folderIcon, "folder-plus");
    newFolderBtn.prepend(folderIcon);
    newFolderBtn.onclick = () => {
      new NewFolderModal(this.app, this.plugin, this.currentFolder, () => {
        this.loadGallery();
      }).open();
    };

    // Add Images Button (file picker)
    const addImgBtn = right.createEl("button", {
      cls: "galleryview-btn mod-accent",
      text: "Add Images"
    });
    const plusIcon = addImgBtn.createSpan();
    setIcon(plusIcon, "upload");
    addImgBtn.prepend(plusIcon);

    const fileInput = right.createEl("input", {
      attr: { type: "file", multiple: "true", accept: "image/*", style: "display: none" }
    });
    addImgBtn.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      if (fileInput.files && fileInput.files.length > 0) {
        for (let i = 0; i < fileInput.files.length; i++) {
          await this.importFileToCurrentFolder(fileInput.files[i]);
        }
        await this.loadGallery();
      }
    };

    // Sort Dropdown
    const sortSelect = right.createEl("select", { cls: "galleryview-select" });
    const sortOptions = [
      { value: "mtime-desc", text: "Newest First" },
      { value: "mtime-asc", text: "Oldest First" },
      { value: "name-asc", text: "Name (A-Z)" },
      { value: "name-desc", text: "Name (Z-A)" },
      { value: "size-desc", text: "Size (Largest)" },
      { value: "size-asc", text: "Size (Smallest)" }
    ];
    for (const opt of sortOptions) {
      const optionEl = sortSelect.createEl("option", { value: opt.value, text: opt.text });
      if (opt.value === this.sortOrder) optionEl.selected = true;
    }
    sortSelect.onchange = (e) => {
      this.sortOrder = e.target.value;
      this.render();
    };

    // Grid Size Toggle
    const sizeSelect = right.createEl("select", { cls: "galleryview-select" });
    const sizeOptions = [
      { value: "small", text: "Small Grid" },
      { value: "medium", text: "Medium Grid" },
      { value: "large", text: "Large Grid" }
    ];
    for (const opt of sizeOptions) {
      const optionEl = sizeSelect.createEl("option", { value: opt.value, text: opt.text });
      if (opt.value === this.gridSize) optionEl.selected = true;
    }
    sizeSelect.onchange = (e) => {
      this.gridSize = e.target.value;
      this.render();
    };

    // Refresh Button
    const refreshBtn = right.createEl("button", {
      cls: "galleryview-icon-btn",
      attr: { title: "Refresh Gallery" }
    });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.onclick = () => {
      this.plugin.refreshVirtualIndex();
      this.loadGallery();
    };
  }

  renderFolderCard(container, folderPath) {
    const card = container.createDiv({ cls: "galleryview-folder-card" });
    const folderName = getBaseName(folderPath);
    const count = this.folderImageCounts[folderPath] || 0;

    const iconWrap = card.createDiv({ cls: "galleryview-folder-icon" });
    setIcon(iconWrap, "folder");

    const info = card.createDiv({ cls: "galleryview-folder-info" });
    info.createDiv({ cls: "galleryview-folder-name", text: folderName });
    info.createDiv({ cls: "galleryview-folder-count", text: `${count} ${count === 1 ? "image" : "images"}` });

    card.onclick = () => {
      this.currentFolder = folderPath;
      this.loadGallery();
    };

    // Drag-and-drop target to move images into this folder
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.addClass("is-drag-over");
    });
    card.addEventListener("dragleave", () => {
      card.removeClass("is-drag-over");
    });
    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      card.removeClass("is-drag-over");
      const imagePath = e.dataTransfer.getData("text/plain");
      if (imagePath && imagePath !== folderPath) {
        await this.moveImageToFolder(imagePath, folderPath);
      }
    });

    card.oncontextmenu = (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) => {
        item.setTitle("Rename folder").setIcon("edit").onClick(() => {
          new RenameFolderModal(this.app, this.plugin, folderPath, () => {
            this.plugin.refreshVirtualIndex();
            this.loadGallery();
          }).open();
        });
      });
      menu.addItem((item) => {
        item.setTitle("Delete folder").setIcon("trash").onClick(async () => {
          await this.deleteFolder(folderPath);
        });
      });
      menu.showAtMouseEvent(e);
    };
  }

  renderImageCard(container, img, allImages, index) {
    const card = container.createDiv({ cls: "galleryview-image-card" });
    const realUrl = this.app.vault.adapter.getResourcePath(img.path);
    const isFav = this.plugin.isFavorite(img.path);

    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", img.path);
    });

    const thumbContainer = card.createDiv({ cls: "galleryview-image-thumb-container" });
    const imageEl = thumbContainer.createEl("img", {
      cls: "galleryview-image-thumb",
      attr: { src: realUrl, loading: "lazy", alt: img.name }
    });

    const favBtn = thumbContainer.createDiv({
      cls: `galleryview-fav-btn ${isFav ? "is-favorite" : ""}`
    });
    setIcon(favBtn, "star");
    favBtn.onclick = (e) => {
      e.stopPropagation();
      this.plugin.toggleFavorite(img.path);
    };

    const overlay = thumbContainer.createDiv({ cls: "galleryview-image-overlay" });

    const insertBtn = overlay.createEl("button", {
      cls: "galleryview-overlay-btn",
      text: "Insert"
    });
    insertBtn.onclick = (e) => {
      e.stopPropagation();
      this.plugin.insertImageIntoActiveView(img);
    };

    const copyBtn = overlay.createEl("button", {
      cls: "galleryview-overlay-btn",
      text: "Copy"
    });
    copyBtn.onclick = async (e) => {
      e.stopPropagation();
      const link = this.plugin.formatImageLink(img.path, img.name);
      await navigator.clipboard.writeText(link);
      new Notice("Copied embed link!");
    };

    const footer = card.createDiv({ cls: "galleryview-image-footer" });
    footer.createDiv({ cls: "galleryview-image-title", text: img.name, attr: { title: img.name } });

    const meta = footer.createDiv({ cls: "galleryview-image-meta" });
    meta.createSpan({ text: formatBytes(img.size) });
    meta.createSpan({ text: formatDate(img.mtime) });

    card.onclick = () => {
      new GalleryLightboxModal(this.app, this.plugin, allImages, index, (updatedList) => {
        this.loadGallery();
      }).open();
    };

    card.oncontextmenu = (e) => {
      e.preventDefault();
      this.showImageContextMenu(e, img);
    };
  }

  showImageContextMenu(evt, img) {
    const menu = new Menu();

    menu.addItem((item) => {
      item.setTitle("Insert into Active Note / Canvas")
        .setIcon("arrow-down-left")
        .onClick(() => {
          this.plugin.insertImageIntoActiveView(img);
        });
    });

    menu.addItem((item) => {
      item.setTitle("Copy Wikilink Embed")
        .setIcon("copy")
        .onClick(async () => {
          const link = `![[${img.name}]]`;
          await navigator.clipboard.writeText(link);
          new Notice("Copied: " + link);
        });
    });

    menu.addItem((item) => {
      item.setTitle("Copy Markdown Embed")
        .setIcon("code")
        .onClick(async () => {
          const encoded = img.path.split("/").map(seg => encodeURIComponent(seg)).join("/");
          const link = `![${img.name}](${encoded})`;
          await navigator.clipboard.writeText(link);
          new Notice("Copied: " + link);
        });
    });

    menu.addItem((item) => {
      item.setTitle("Copy Image to Clipboard")
        .setIcon("image")
        .onClick(async () => {
          await this.plugin.copyImageBinaryToClipboard(img.path);
        });
    });

    menu.addItem((item) => {
      item.setTitle("Copy Path")
        .setIcon("link")
        .onClick(async () => {
          await navigator.clipboard.writeText(img.path);
          new Notice("Copied: " + img.path);
        });
    });

    menu.addSeparator();

    const isFav = this.plugin.isFavorite(img.path);
    menu.addItem((item) => {
      item.setTitle(isFav ? "Remove from Favourites" : "Mark as Favourite")
        .setIcon("star")
        .onClick(() => {
          this.plugin.toggleFavorite(img.path);
        });
    });

    menu.addItem((item) => {
      item.setTitle("Move to Folder...")
        .setIcon("folder")
        .onClick(() => {
          new MoveImageModal(this.app, this.plugin, img, async () => {
            await this.plugin.refreshVirtualIndex();
            await this.loadGallery();
          }).open();
        });
    });

    menu.addItem((item) => {
      item.setTitle("Rename Image...")
        .setIcon("edit")
        .onClick(() => {
          new RenameImageModal(this.app, this.plugin, img, async () => {
            await this.plugin.refreshVirtualIndex();
            await this.loadGallery();
          }).open();
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item.setTitle("Delete Image")
        .setIcon("trash")
        .onClick(async () => {
          new ConfirmModal(
            this.app,
            "Delete Image",
            `Are you sure you want to permanently delete "${img.name}"?`,
            async () => {
              try {
                await this.app.vault.adapter.remove(normalizePath(img.path));
                await this.plugin.refreshVirtualIndex();
                new Notice(`Deleted: ${img.name}`);
                await this.loadGallery();
              } catch (e) {
                new Notice("Failed to delete image: " + e.message);
              }
            }
          ).open();
        });
    });

    menu.showAtMouseEvent(evt);
  }

  async importFileToCurrentFolder(file) {
    const ext = file.name ? file.name.split(".").pop() : "png";
    const filename = await this.plugin.generateUniqueFilename(this.currentFolder, file.name, ext);
    const targetPath = normalizePath(`${this.currentFolder}/${filename}`);
    const buffer = await file.arrayBuffer();
    await this.app.vault.adapter.writeBinary(targetPath, buffer);
    await this.plugin.refreshVirtualIndex();
    if (this.plugin.settings.showNotifications) {
      new Notice(`Added image: ${filename}`);
    }
  }

  async moveImageToFolder(sourcePath, targetFolder) {
    const filename = getBaseName(sourcePath);
    let targetPath = normalizePath(`${targetFolder}/${filename}`);

    if (await this.app.vault.adapter.exists(targetPath)) {
      const ext = filename.split(".").pop();
      targetPath = normalizePath(`${targetFolder}/${await this.plugin.generateUniqueFilename(targetFolder, filename, ext)}`);
    }

    try {
      await this.app.vault.adapter.rename(normalizePath(sourcePath), targetPath);
      if (this.plugin.isFavorite(sourcePath)) {
        await this.plugin.toggleFavorite(sourcePath);
        await this.plugin.toggleFavorite(targetPath);
      }
      await this.plugin.refreshVirtualIndex();
      new Notice(`Moved to ${targetFolder}`);
      await this.loadGallery();
    } catch (e) {
      new Notice("Error moving image: " + e.message);
    }
  }

  async deleteFolder(folderPath) {
    const sub = await this.plugin.scanGallery(folderPath);
    const count = sub.images.length + sub.subfolders.length;

    new ConfirmModal(
      this.app,
      "Delete Folder",
      count > 0
        ? `"${getBaseName(folderPath)}" contains ${count} items. Delete everything inside?`
        : `Delete folder "${getBaseName(folderPath)}"?`,
      async () => {
        try {
          await this.app.vault.adapter.rmdir(normalizePath(folderPath), true);
          await this.plugin.refreshVirtualIndex();
          new Notice(`Deleted folder: ${getBaseName(folderPath)}`);
          await this.loadGallery();
        } catch (e) {
          new Notice("Failed to delete folder: " + e.message);
        }
      }
    ).open();
  }
}

// Lightbox Modal for Fullscreen Image Viewing
class GalleryLightboxModal extends Modal {
  constructor(app, plugin, images, initialIndex = 0, onUpdate) {
    super(app);
    this.plugin = plugin;
    this.images = images;
    this.currentIndex = initialIndex;
    this.onUpdate = onUpdate;
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
  }

  onOpen() {
    this.modalEl.empty();
    this.modalEl.addClass("galleryview-lightbox-modal");

    this.keyHandler = (e) => {
      if (e.key === "ArrowLeft") {
        this.prevImage();
      } else if (e.key === "ArrowRight") {
        this.nextImage();
      } else if (e.key === "Escape") {
        this.close();
      } else if (e.key === "+" || e.key === "=") {
        this.zoom(0.2);
      } else if (e.key === "-") {
        this.zoom(-0.2);
      } else if (e.key === "0") {
        this.resetZoom();
      }
    };
    window.addEventListener("keydown", this.keyHandler);

    this.renderLightbox();
  }

  onClose() {
    window.removeEventListener("keydown", this.keyHandler);
    if (this.onUpdate) this.onUpdate();
  }

  getCurrentImage() {
    return this.images[this.currentIndex];
  }

  prevImage() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.resetZoom();
      this.renderLightbox();
    }
  }

  nextImage() {
    if (this.currentIndex < this.images.length - 1) {
      this.currentIndex++;
      this.resetZoom();
      this.renderLightbox();
    }
  }

  zoom(delta) {
    this.zoomLevel = Math.max(0.5, Math.min(5, this.zoomLevel + delta));
    this.updateTransform();
  }

  resetZoom() {
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
    this.updateTransform();
  }

  updateTransform() {
    if (this.imgWrapper) {
      this.imgWrapper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
    }
  }

  renderLightbox() {
    this.modalEl.empty();
    const current = this.getCurrentImage();
    if (!current) {
      this.close();
      return;
    }

    const realUrl = this.app.vault.adapter.getResourcePath(current.path);
    const isFav = this.plugin.isFavorite(current.path);

    const header = this.modalEl.createDiv({ cls: "galleryview-lightbox-header" });
    const titleWrap = header.createDiv({ cls: "galleryview-lightbox-title" });
    titleWrap.createSpan({ text: current.name });
    titleWrap.createSpan({
      cls: "galleryview-section-badge",
      text: `${this.currentIndex + 1} / ${this.images.length}`,
      attr: { style: "margin-left: 8px;" }
    });

    const headerActions = header.createDiv({ cls: "galleryview-lightbox-header-actions" });

    const zoomInBtn = headerActions.createEl("button", {
      cls: "galleryview-icon-btn",
      attr: { title: "Zoom In (+)" }
    });
    setIcon(zoomInBtn, "zoom-in");
    zoomInBtn.onclick = () => this.zoom(0.25);

    const zoomOutBtn = headerActions.createEl("button", {
      cls: "galleryview-icon-btn",
      attr: { title: "Zoom Out (-)" }
    });
    setIcon(zoomOutBtn, "zoom-out");
    zoomOutBtn.onclick = () => this.zoom(-0.25);

    const resetZoomBtn = headerActions.createEl("button", {
      cls: "galleryview-icon-btn",
      attr: { title: "Reset Zoom (0)" }
    });
    setIcon(resetZoomBtn, "maximize");
    resetZoomBtn.onclick = () => this.resetZoom();

    const closeBtn = headerActions.createEl("button", {
      cls: "galleryview-icon-btn",
      attr: { title: "Close (Esc)" }
    });
    setIcon(closeBtn, "x");
    closeBtn.onclick = () => this.close();

    const body = this.modalEl.createDiv({ cls: "galleryview-lightbox-body" });

    if (this.currentIndex > 0) {
      const prevBtn = body.createEl("button", {
        cls: "galleryview-lightbox-nav nav-prev",
        attr: { title: "Previous image (Left Arrow)" }
      });
      setIcon(prevBtn, "chevron-left");
      prevBtn.onclick = (e) => {
        e.stopPropagation();
        this.prevImage();
      };
    }

    if (this.currentIndex < this.images.length - 1) {
      const nextBtn = body.createEl("button", {
        cls: "galleryview-lightbox-nav nav-next",
        attr: { title: "Next image (Right Arrow)" }
      });
      setIcon(nextBtn, "chevron-right");
      nextBtn.onclick = (e) => {
        e.stopPropagation();
        this.nextImage();
      };
    }

    this.imgWrapper = body.createDiv({ cls: "galleryview-lightbox-img-wrapper" });
    const imgEl = this.imgWrapper.createEl("img", {
      cls: "galleryview-lightbox-img",
      attr: { src: realUrl, alt: current.name }
    });

    body.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.2 : -0.2;
      this.zoom(delta);
    }, { passive: false });

    imgEl.addEventListener("mousedown", (e) => {
      if (this.zoomLevel > 1) {
        this.isDragging = true;
        this.startX = e.clientX - this.panX;
        this.startY = e.clientY - this.panY;
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (this.isDragging) {
        this.panX = e.clientX - this.startX;
        this.panY = e.clientY - this.startY;
        this.updateTransform();
      }
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    const footer = this.modalEl.createDiv({ cls: "galleryview-lightbox-footer" });
    const meta = footer.createDiv({ cls: "galleryview-lightbox-meta" });
    meta.createSpan({ text: formatBytes(current.size) });
    meta.createSpan({ text: formatDate(current.mtime) });
    meta.createSpan({ text: current.path, attr: { style: "opacity: 0.7;" } });

    const actions = footer.createDiv({ cls: "galleryview-lightbox-actions" });

    const favBtn = actions.createEl("button", {
      cls: `galleryview-btn ${isFav ? "is-active" : ""}`,
      text: isFav ? "Favourited" : "Favourite"
    });
    const starIcon = favBtn.createSpan();
    setIcon(starIcon, "star");
    favBtn.prepend(starIcon);
    favBtn.onclick = async () => {
      await this.plugin.toggleFavorite(current.path);
      this.renderLightbox();
    };

    const insertBtn = actions.createEl("button", {
      cls: "galleryview-btn mod-accent",
      text: "Insert to Note/Canvas"
    });
    const insertIcon = insertBtn.createSpan();
    setIcon(insertIcon, "arrow-down-left");
    insertBtn.prepend(insertIcon);
    insertBtn.onclick = () => {
      this.plugin.insertImageIntoActiveView(current);
      this.close();
    };

    const copyEmbedBtn = actions.createEl("button", {
      cls: "galleryview-btn",
      text: "Copy Embed"
    });
    const copyIcon = copyEmbedBtn.createSpan();
    setIcon(copyIcon, "copy");
    copyEmbedBtn.prepend(copyIcon);
    copyEmbedBtn.onclick = async () => {
      const link = `![[${current.name}]]`;
      await navigator.clipboard.writeText(link);
      new Notice("Copied: " + link);
    };

    const copyImageBtn = actions.createEl("button", {
      cls: "galleryview-btn",
      text: "Copy Image"
    });
    const imgIcon = copyImageBtn.createSpan();
    setIcon(imgIcon, "image");
    copyImageBtn.prepend(imgIcon);
    copyImageBtn.onclick = async () => {
      await this.plugin.copyImageBinaryToClipboard(current.path);
    };

    const deleteBtn = actions.createEl("button", {
      cls: "galleryview-btn",
      text: "Delete",
      attr: { style: "color: var(--text-error);" }
    });
    const trashIcon = deleteBtn.createSpan();
    setIcon(trashIcon, "trash");
    deleteBtn.prepend(trashIcon);
    deleteBtn.onclick = () => {
      new ConfirmModal(
        this.app,
        "Delete Image",
        `Permanently delete "${current.name}"?`,
        async () => {
          try {
            await this.app.vault.adapter.remove(normalizePath(current.path));
            await this.plugin.refreshVirtualIndex();
            new Notice(`Deleted: ${current.name}`);
            this.images.splice(this.currentIndex, 1);
            if (this.images.length === 0) {
              this.close();
            } else {
              if (this.currentIndex >= this.images.length) {
                this.currentIndex = this.images.length - 1;
              }
              this.renderLightbox();
            }
          } catch (e) {
            new Notice("Failed to delete: " + e.message);
          }
        }
      ).open();
    };
  }
}

// Modal for Command Palette: Quick Image Picker & Search
class GalleryImagePickerModal extends SuggestModal {
  constructor(app, plugin, onChoose) {
    super(app);
    this.plugin = plugin;
    this.onChoose = onChoose;
    this.allImages = [];
    this.setPlaceholder("Search any image in .gallery folder to insert...");
  }

  async onOpen() {
    super.onOpen();
    this.allImages = await this.plugin.scanAllImagesRecursive();
    this.allImages.sort((a, b) => b.mtime - a.mtime);
    this.updateSuggestions();
  }

  getSuggestions(query) {
    const q = query.toLowerCase().trim();
    if (!q) return this.allImages;
    return this.allImages.filter((img) =>
      img.name.toLowerCase().includes(q) || img.path.toLowerCase().includes(q)
    );
  }

  renderSuggestion(img, el) {
    el.empty();
    el.addClass("galleryview-suggest-item");

    const realUrl = this.app.vault.adapter.getResourcePath(img.path);
    el.createEl("img", {
      cls: "galleryview-suggest-thumb",
      attr: { src: realUrl, loading: "lazy" }
    });

    const info = el.createDiv({ cls: "galleryview-suggest-info" });
    const nameLine = info.createDiv({ cls: "galleryview-suggest-name" });
    nameLine.createSpan({ text: img.name });

    if (this.plugin.isFavorite(img.path)) {
      const star = nameLine.createSpan({ cls: "galleryview-suggest-star" });
      setIcon(star, "star");
    }

    info.createDiv({
      cls: "galleryview-suggest-path",
      text: `${img.folder} • ${formatBytes(img.size)} • ${formatDate(img.mtime)}`
    });
  }

  onChooseSuggestion(img, evt) {
    this.onChoose(img);
  }
}

// Modal for Creating a New Subfolder
class NewFolderModal extends Modal {
  constructor(app, plugin, parentFolder, onSuccess) {
    super(app);
    this.plugin = plugin;
    this.parentFolder = parentFolder;
    this.onSuccess = onSuccess;
  }

  onOpen() {
    this.contentEl.empty();
    this.titleEl.setText("Create New Folder");

    let folderName = "";

    new Setting(this.contentEl)
      .setName("Folder Name")
      .setDesc(`Will be created inside ${this.parentFolder}`)
      .addText((text) => {
        text.setPlaceholder("e.g. Wallpapers, Screenshots")
          .onChange((value) => {
            folderName = value.trim();
          });
        text.inputEl.focus();
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") createBtn.buttonEl.click();
        });
      });

    const createBtn = new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText("Create Folder")
          .setCta()
          .onClick(async () => {
            if (!folderName) {
              new Notice("Please enter a folder name.");
              return;
            }
            const target = normalizePath(`${this.parentFolder}/${folderName}`);
            const exists = await this.app.vault.adapter.exists(target);
            if (exists) {
              new Notice("A folder with this name already exists.");
              return;
            }
            await this.app.vault.adapter.mkdir(target);
            await this.plugin.refreshVirtualIndex();
            new Notice(`Created folder: ${folderName}`);
            this.close();
            if (this.onSuccess) this.onSuccess();
          });
      })
      .addButton((btn) => {
        btn.setButtonText("Cancel").onClick(() => this.close());
      });
  }
}

// Modal for Moving an Image to a Subfolder
class MoveImageModal extends Modal {
  constructor(app, plugin, image, onSuccess) {
    super(app);
    this.plugin = plugin;
    this.image = image;
    this.onSuccess = onSuccess;
  }

  async onOpen() {
    this.contentEl.empty();
    this.titleEl.setText(`Move "${this.image.name}" to Folder`);

    const allFolders = [this.plugin.settings.galleryRoot];
    const scanDirs = async (dir) => {
      const listing = await this.app.vault.adapter.list(dir);
      for (const sub of listing.folders) {
        allFolders.push(sub);
        await scanDirs(sub);
      }
    };
    await scanDirs(this.plugin.settings.galleryRoot);

    let selectedFolder = this.image.folder;

    new Setting(this.contentEl)
      .setName("Select Destination Folder")
      .addDropdown((dropdown) => {
        for (const folder of allFolders) {
          dropdown.addOption(folder, folder === this.plugin.settings.galleryRoot ? "Gallery Root (.gallery)" : folder);
        }
        dropdown.setValue(selectedFolder);
        dropdown.onChange((val) => {
          selectedFolder = val;
        });
      });

    new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText("Move")
          .setCta()
          .onClick(async () => {
            if (selectedFolder === this.image.folder) {
              new Notice("Image is already in this folder.");
              return;
            }

            let targetPath = normalizePath(`${selectedFolder}/${this.image.name}`);
            if (await this.app.vault.adapter.exists(targetPath)) {
              const ext = this.image.name.split(".").pop();
              const unique = await this.plugin.generateUniqueFilename(selectedFolder, this.image.name, ext);
              targetPath = normalizePath(`${selectedFolder}/${unique}`);
            }

            try {
              await this.app.vault.adapter.rename(normalizePath(this.image.path), targetPath);
              if (this.plugin.isFavorite(this.image.path)) {
                await this.plugin.toggleFavorite(this.image.path);
                await this.plugin.toggleFavorite(targetPath);
              }
              await this.plugin.refreshVirtualIndex();
              new Notice(`Moved to ${selectedFolder}`);
              this.close();
              if (this.onSuccess) this.onSuccess();
            } catch (e) {
              new Notice("Error moving image: " + e.message);
            }
          });
      })
      .addButton((btn) => {
        btn.setButtonText("Cancel").onClick(() => this.close());
      });
  }
}

// Modal for Renaming an Image
class RenameImageModal extends Modal {
  constructor(app, plugin, image, onSuccess) {
    super(app);
    this.plugin = plugin;
    this.image = image;
    this.onSuccess = onSuccess;
  }

  onOpen() {
    this.contentEl.empty();
    this.titleEl.setText("Rename Image");

    let newName = this.image.name;

    new Setting(this.contentEl)
      .setName("New Image Name")
      .addText((text) => {
        text.setValue(this.image.name)
          .onChange((val) => {
            newName = val.trim();
          });
        text.inputEl.focus();
        text.inputEl.select();
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") saveBtn.buttonEl.click();
        });
      });

    const saveBtn = new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText("Rename")
          .setCta()
          .onClick(async () => {
            if (!newName) {
              new Notice("Filename cannot be empty.");
              return;
            }
            if (newName === this.image.name) {
              this.close();
              return;
            }

            if (!newName.includes(".")) {
              const ext = this.image.name.split(".").pop();
              newName = `${newName}.${ext}`;
            }

            const targetPath = normalizePath(`${this.image.folder}/${newName}`);
            if (await this.app.vault.adapter.exists(targetPath)) {
              new Notice("A file with this name already exists in this folder.");
              return;
            }

            try {
              await this.app.vault.adapter.rename(normalizePath(this.image.path), targetPath);
              if (this.plugin.isFavorite(this.image.path)) {
                await this.plugin.toggleFavorite(this.image.path);
                await this.plugin.toggleFavorite(targetPath);
              }
              await this.plugin.refreshVirtualIndex();
              new Notice(`Renamed to ${newName}`);
              this.close();
              if (this.onSuccess) this.onSuccess();
            } catch (e) {
              new Notice("Failed to rename: " + e.message);
            }
          });
      })
      .addButton((btn) => {
        btn.setButtonText("Cancel").onClick(() => this.close());
      });
  }
}

// Modal for Renaming a Folder
class RenameFolderModal extends Modal {
  constructor(app, plugin, folderPath, onSuccess) {
    super(app);
    this.plugin = plugin;
    this.folderPath = folderPath;
    this.onSuccess = onSuccess;
  }

  onOpen() {
    this.contentEl.empty();
    const currentName = getBaseName(this.folderPath);
    this.titleEl.setText(`Rename Folder "${currentName}"`);

    let newName = currentName;

    new Setting(this.contentEl)
      .setName("New Folder Name")
      .addText((text) => {
        text.setValue(currentName).onChange((v) => (newName = v.trim()));
        text.inputEl.focus();
        text.inputEl.select();
      });

    new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText("Rename")
          .setCta()
          .onClick(async () => {
            if (!newName || newName === currentName) {
              this.close();
              return;
            }
            const parent = getParentPath(this.folderPath);
            const target = normalizePath(`${parent}/${newName}`);
            if (await this.app.vault.adapter.exists(target)) {
              new Notice("A folder with this name already exists.");
              return;
            }
            try {
              await this.app.vault.adapter.rename(normalizePath(this.folderPath), target);
              await this.plugin.refreshVirtualIndex();
              new Notice(`Renamed folder to ${newName}`);
              this.close();
              if (this.onSuccess) this.onSuccess();
            } catch (e) {
              new Notice("Failed to rename folder: " + e.message);
            }
          });
      })
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
  }
}

// Generic Confirmation Modal
class ConfirmModal extends Modal {
  constructor(app, title, message, onConfirm) {
    super(app);
    this.title = title;
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.contentEl.empty();
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.message });

    new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText("Confirm")
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          });
      })
      .addButton((btn) => {
        btn.setButtonText("Cancel").onClick(() => this.close());
      });
  }
}

// Plugin Setting Tab
class GallerySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "GalleryView Settings" });

    new Setting(containerEl)
      .setName("Gallery Root Folder")
      .setDesc("The hidden folder where gallery images and folders are stored. (Must start with a dot . to stay hidden from File Explorer)")
      .addText((text) => {
        text.setValue(this.plugin.settings.galleryRoot).onChange(async (val) => {
          this.plugin.settings.galleryRoot = val.trim() || ".gallery";
          await this.plugin.saveSettings();
          await this.plugin.refreshVirtualIndex();
        });
      });

    new Setting(containerEl)
      .setName("Default Attachment Folder")
      .setDesc("Where pasted/dropped images in notes should be saved initially.")
      .addText((text) => {
        text.setValue(this.plugin.settings.defaultFolder).onChange(async (val) => {
          this.plugin.settings.defaultFolder = val.trim() || ".gallery";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Link Format")
      .setDesc("Format inserted into notes when copying/pasting images. Wikilink ![[image.png]] handles spaces naturally without breaking.")
      .addDropdown((drop) => {
        drop.addOption("wikilink", "Standard Wikilink ![[image.png]] (Recommended)");
        drop.addOption("wikilink-path", "Path Wikilink ![[.gallery/image.png]]");
        drop.addOption("markdown", "Standard Markdown ![name](.gallery/...)");
        drop.setValue(this.plugin.settings.linkFormat);
        drop.onChange(async (val) => {
          this.plugin.settings.linkFormat = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Default Grid Size")
      .setDesc("Size of thumbnail cards in the Gallery View.")
      .addDropdown((drop) => {
        drop.addOption("small", "Small");
        drop.addOption("medium", "Medium");
        drop.addOption("large", "Large");
        drop.setValue(this.plugin.settings.defaultGridSize);
        drop.onChange(async (val) => {
          this.plugin.settings.defaultGridSize = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Show Notifications")
      .setDesc("Show a notice when an image is pasted/saved into .gallery.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showNotifications).onChange(async (val) => {
          this.plugin.settings.showNotifications = val;
          await this.plugin.saveSettings();
        });
      });
  }
}

module.exports = GalleryViewPlugin;
