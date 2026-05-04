# FlowPaster

[中文文档](./README.zh-CN.md)

FlowPaster is a Windows clipboard and Quick Paste app based on PasteBar. It keeps PasteBar as the foundation, takes component-level inspiration from Flow Launcher, and rewrites the Quick Paste page and interaction model around a native Windows experience.

The main goal is to make frequent clipboard actions fast, keyboard-first, and highly configurable.

## What's New

- Redesigned Quick Paste page: rebuilt layout, visual style, and keyboard interaction.
- Native Windows feel: Quick Paste uses a translucent acrylic-style surface by default.
- Number-key paste: press `Alt+V` to open Quick Paste, then press a number key to paste the matching item.
- Multi-item paste: press multiple number keys, such as `123`, to paste items 1, 2, and 3 in list order with the configured separator between them.
- Text and image clipboard support: Quick Paste works with both text clips and image clips.
- Search mode: press `/` to move focus into the search box, then press `Enter` to return focus to list control.
- Expanded customization: settings have been reorganized and extended for themes, hotkeys, and paste behavior.
- Separate settings pages: theme settings and hotkey settings are now independent menu pages.

## Quick Paste Basics

1. Press `Alt+V` to open Quick Paste.
2. Find the number shown on the right side of each clipboard item.
3. Press a number key, such as `1`, to paste that item immediately.
4. To paste multiple items at once, press multiple number keys, such as `123`.
5. Multi-item paste follows the current list order and applies the configured separator between items.

## Search And Paste

Press `/` inside Quick Paste to enter search mode:

1. Focus moves to the search box.
2. Type keywords to filter clipboard items.
3. Press `Enter` to leave search input and return focus to list control.
4. Use number keys to paste from the filtered results.

This keeps large clipboard histories searchable while preserving a keyboard-first paste flow.

## Customization

The settings experience has been reorganized and expanded:

- Theme settings: configure appearance, transparency, and visual style.
- Hotkey settings: customize in-app shortcuts and global hotkeys.
- Paste behavior settings: configure separators and multi-item paste behavior.

## Development

Install dependencies:

```bash
npm install
```

Start the development app:

```bash
npm run dev
```

Build the app:

```bash
npm run build
```

## Project Origin

FlowPaster is mainly based on PasteBar and references Flow Launcher for parts of the component and interaction experience. Current development focuses on a Windows-first Quick Paste workflow, simplified keyboard operation, and deeper customization.
