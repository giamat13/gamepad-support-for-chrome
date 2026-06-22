# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Gamepad for Chrome** is a Chrome extension that adds gamepad support to websites that lack native support. The extension automatically detects when a gamepad is connected, waits to see if the site uses the Gamepad API, and if it doesn't, activates a fallback emulation system that translates gamepad input into mouse/keyboard events and a virtual cursor.

## Architecture

The entire extension is a **single content script** (`content.js`) that:

1. **Detects gamepad support**: Wraps `navigator.getGamepads()` at `document_start` to detect whether the page actively polls the Gamepad API
2. **Determines if emulation is needed**: When a gamepad connects, waits 800ms; if the site hasn't called `getGamepads()` by then, assumes no native support and activates emulation. If the site *did* call `getGamepads()`, the extension disables itself completely in that tab (no cursor, no emulated input) and runs only an **escape watcher** — pressing **Back+Start together 5 times** switches to the next tab so the user isn't trapped on a site that already handles the pad
3. **Emulates gamepad input**: Uses `requestAnimationFrame` polling to:
   - Translate analog sticks into mouse movement and scrolling
   - Map physical buttons to keyboard and mouse events
   - Render a virtual cursor element on the page
4. **Cleans up gracefully**: Removes the cursor and stops polling when the gamepad disconnects

### Key Concepts

- **Deadzone** (0.15): Analog stick threshold below which input is ignored, preventing drift
- **MOUSE_SPEED** (10): Pixel multiplier for left stick movement per frame
- **SCROLL_SPEED** (8): Pixel multiplier for right stick scrolling per frame
- **DETECTION_WINDOW_MS** (800): Window after gamepad connect to detect native API usage

### Button Mapping

Follows Xbox layout (standard Gamepad API indices):
- **A, B, X, Y**: A=click, B=Escape, X=Space, Y=Tab
- **LB/RB**: Shift+Tab / Tab (back/forward in tab order)
- **LT/RT**: Right-click / Left-click
- **SELECT**: Freeze/unfreeze page interaction (press again to unfreeze)
- **START**: Enter key
- **D-Pad**: Arrow keys (↑↓←→)

### State Management

Global state variables:
- `siteUsesGamepadAPI`: Tracks whether page calls `navigator.getGamepads()` during the detection window
- `emulationActive`: Tracks if emulation is currently running
- `prevButtonStates`: Previous frame's button states (for edge detection)
- `activeGamepadIndex`: Index of the connected gamepad
- `virtualX/Y`: Virtual cursor position (clamped to viewport)

## Development Tasks

### Running the Extension

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory
4. Test with a connected gamepad on any website

### Testing Manually

- **Test site with native gamepad support**: Open a game like [Gamepad Tester](https://gamepad-tester.appspot.com/) — emulation should NOT activate
- **Test site without gamepad support**: Open a website with interactive elements (buttons, links) and connect a gamepad — emulation should activate and virtual cursor should appear

### Generating Icons

If you modify `icons/generate_icons.js`:
```bash
cd icons
npm install canvas
node generate_icons.js
```

This generates `icon16.png`, `icon48.png`, and `icon128.png`.

Otherwise, use pre-made PNG images (16×16, 48×48, 128×128) placed directly in the `icons/` directory.

## Manifest Configuration

The extension runs as a content script matching all URLs (`<all_urls>`), injected at `document_start` to intercept the Gamepad API before page scripts load. The early injection is critical for the detection mechanism to work.

## Code Organization

- **Constants (lines 4–20)**: Configuration and button mappings
- **State (lines 40–54)**: Global variables and native API binding
- **API Interception (lines 60–72)**: `navigator.getGamepads()` wrapping
- **Gamepad Events (lines 76–93)**: Connection/disconnection handlers
- **Lifecycle (lines 97–123)**: `startEmulation()` / `stopEmulation()`
- **Virtual Cursor (lines 127–163)**: DOM element rendering and movement
- **Polling & Axes (lines 167–220)**: `requestAnimationFrame` loop and analog stick processing
- **Buttons & Events (lines 224–289)**: Button state tracking and event dispatch
- **DOM Utilities (lines 293–311)**: Element detection and deadzone math

## Future Extensibility

- **Button remapping**: Modify `BUTTON_MAP` to customize key/action bindings
- **Speed tuning**: Adjust `MOUSE_SPEED`, `SCROLL_SPEED`, `DEADZONE` to taste
- **Detection window**: Increase `DETECTION_WINDOW_MS` if sites load gamepad code slowly
- **Cursor styling**: Customize cursor appearance in `createCursor()`'s inline styles
