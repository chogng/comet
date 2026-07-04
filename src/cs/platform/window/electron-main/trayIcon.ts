import { Menu, Tray, app, nativeImage } from 'electron';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';

const trayTooltip = 'Comet Studio';
let tray: Tray | null = null;
let menuBarIconEnabled = false;
let trayMainWindow: BrowserWindow | null = null;

function createTrayImage() {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <rect x="1.5" y="2" width="5.5" height="12" rx="1.2" fill="#000000"/>
  <rect x="9" y="2" width="5.5" height="12" rx="1.2" fill="#000000"/>
  <path d="M8 3V13" stroke="#ffffff" stroke-width="1"/>
</svg>
`.trim();
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = nativeImage.createFromDataURL(dataUrl);

  if (process.platform === 'darwin') {
    image.setTemplateImage(true);
  }

  return image;
}

function resolveTrayMainWindow() {
  if (!trayMainWindow || trayMainWindow.isDestroyed()) {
    return null;
  }

  return trayMainWindow;
}

function focusTrayMainWindow() {
  const window = resolveTrayMainWindow();
  if (!window) {
    if (process.platform === 'darwin') {
      app.emit('activate');
    }
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.focus();
}

function buildTrayMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Open Comet Studio',
      click: () => {
        focusTrayMainWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Comet Studio',
      click: () => {
        app.quit();
      },
    },
  ];

  return Menu.buildFromTemplate(template);
}

function destroyTray() {
  if (!tray) {
    return;
  }

  tray.destroy();
  tray = null;
}

function ensureTray() {
  if (tray || !menuBarIconEnabled) {
    return;
  }

  tray = new Tray(createTrayImage());
  tray.setToolTip(trayTooltip);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    focusTrayMainWindow();
  });
  tray.on('double-click', () => {
    focusTrayMainWindow();
  });
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }

  tray.setContextMenu(buildTrayMenu());
}

export function setMenuBarIconEnabled(enabled: boolean) {
  menuBarIconEnabled = Boolean(enabled);
  if (menuBarIconEnabled) {
    ensureTray();
    refreshTrayMenu();
    return;
  }

  destroyTray();
}

export function setTrayMainWindow(window: BrowserWindow | null) {
  trayMainWindow = window && !window.isDestroyed() ? window : null;
  refreshTrayMenu();
}
