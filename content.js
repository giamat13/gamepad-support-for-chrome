(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────

  const DEADZONE = 0.15;
  const MOUSE_SPEED = 10;
  const SCROLL_SPEED = 8;
  // How long after gamepad connects to wait before deciding site has no support
  const DETECTION_WINDOW_MS = 800;

  // YouTube-only features are gated on the hostname.
  const IS_YOUTUBE = /(^|\.)youtube\.com$/.test(location.hostname);

  // Standard Gamepad button indices (Xbox layout)
  const BTN = {
    A: 0, B: 1, X: 2, Y: 3,
    LB: 4, RB: 5,
    LT: 6, RT: 7,
    SELECT: 8, START: 9,
    L3: 10, R3: 11,
    DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
  };

  // Maps button index → action
  const BUTTON_MAP = {
    [BTN.A]:          { type: 'click',    mouseButton: 0 },
    [BTN.B]:          { type: 'key',      key: 'Escape',     code: 'Escape' },
    [BTN.X]:          { type: 'playpause' },
    [BTN.Y]:          { type: 'key',      key: 'Tab',        code: 'Tab' },
    [BTN.LB]:         { type: 'tab',      direction: 'prev' },
    [BTN.RB]:         { type: 'tab',      direction: 'next' },
    [BTN.L3]:         { type: 'youtube',  target: 'like' },
    [BTN.R3]:         { type: 'youtube',  target: 'dislike' },
    [BTN.LT]:         { type: 'click',    mouseButton: 2 },
    [BTN.RT]:         { type: 'click',    mouseButton: 0 },
    [BTN.SELECT]:     { type: 'key',      key: 'Escape',     code: 'Escape' },
    [BTN.START]:      { type: 'key',      key: 'Enter',      code: 'Enter' },
    [BTN.DPAD_UP]:    { type: 'key',      key: 'ArrowUp',    code: 'ArrowUp' },
    [BTN.DPAD_DOWN]:  { type: 'key',      key: 'ArrowDown',  code: 'ArrowDown' },
    [BTN.DPAD_LEFT]:  { type: 'key',      key: 'ArrowLeft',  code: 'ArrowLeft' },
    [BTN.DPAD_RIGHT]: { type: 'key',      key: 'ArrowRight', code: 'ArrowRight' },
  };

  // ── State ─────────────────────────────────────────────────────────────────

  let siteUsesGamepadAPI = false;
  let emulationActive = false;
  let rafId = null;
  let prevButtonStates = [];
  let cursorEl = null;
  let virtualX = 0;
  let virtualY = 0;
  let activeGamepadIndex = null;

  // Save the native getGamepads before any page script can run (document_start)
  const nativeGetGamepads = navigator.getGamepads
    ? navigator.getGamepads.bind(navigator)
    : () => [];

  // ── Gamepad API interception ───────────────────────────────────────────────
  // Wrap navigator.getGamepads so we can detect whether the page polls it.
  // Must run at document_start to intercept before page scripts execute.

  try {
    const descriptor = {
      value: function getGamepads() {
        siteUsesGamepadAPI = true;
        return nativeGetGamepads();
      },
      writable: true,
      configurable: true,
    };
    Object.defineProperty(Navigator.prototype, 'getGamepads', descriptor);
  } catch (_) {
    // Some pages may have locked the prototype; interception failed silently.
  }

  // ── Gamepad connection events ──────────────────────────────────────────────

  window.addEventListener('gamepadconnected', (e) => {
    activeGamepadIndex = e.gamepad.index;
    siteUsesGamepadAPI = false; // reset per connection

    setTimeout(() => {
      if (!siteUsesGamepadAPI) {
        startEmulation(activeGamepadIndex);
      }
    }, DETECTION_WINDOW_MS);
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === activeGamepadIndex) {
      stopEmulation();
      activeGamepadIndex = null;
      siteUsesGamepadAPI = false;
    }
  });

  // ── Emulation lifecycle ───────────────────────────────────────────────────

  function startEmulation(index) {
    if (emulationActive) return;
    emulationActive = true;
    prevButtonStates = [];

    const init = () => {
      virtualX = window.innerWidth / 2;
      virtualY = window.innerHeight / 2;
      createCursor();
      schedulePoll(index);
    };

    if (document.body) {
      init();
    } else {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    }
  }

  function stopEmulation() {
    emulationActive = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    removeCursor();
  }

  // ── Virtual cursor ─────────────────────────────────────────────────────────

  function createCursor() {
    if (cursorEl) return;
    cursorEl = document.createElement('div');
    cursorEl.setAttribute('id', '__gp4chrome_cursor__');
    Object.assign(cursorEl.style, {
      position: 'fixed',
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.92)',
      border: '2.5px solid rgba(30,30,30,0.75)',
      boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
      pointerEvents: 'none',
      zIndex: '2147483647',
      transform: 'translate(-50%,-50%)',
      left: virtualX + 'px',
      top: virtualY + 'px',
      transition: 'none',
    });
    (document.body || document.documentElement).appendChild(cursorEl);
  }

  function removeCursor() {
    if (cursorEl) {
      cursorEl.remove();
      cursorEl = null;
    }
  }

  function moveCursor(dx, dy) {
    virtualX = Math.max(0, Math.min(window.innerWidth - 1, virtualX + dx));
    virtualY = Math.max(0, Math.min(window.innerHeight - 1, virtualY + dy));
    if (cursorEl) {
      cursorEl.style.left = virtualX + 'px';
      cursorEl.style.top = virtualY + 'px';
    }
  }

  // ── Polling loop ───────────────────────────────────────────────────────────

  function schedulePoll(index) {
    rafId = requestAnimationFrame(() => poll(index));
  }

  function poll(index) {
    if (!emulationActive) return;

    let gamepads;
    try {
      gamepads = nativeGetGamepads();
    } catch (_) {
      schedulePoll(index);
      return;
    }

    const gp = gamepads[index];

    if (!gp) {
      schedulePoll(index);
      return;
    }

    try {
      processAxes(gp);
      processButtons(gp);
    } finally {
      prevButtonStates = gp.buttons.map((b) => b.pressed);
      schedulePoll(index);
    }
  }

  // ── Axes → mouse / scroll ─────────────────────────────────────────────────

  function processAxes(gp) {
    const lx = applyDeadzone(gp.axes[0] ?? 0);
    const ly = applyDeadzone(gp.axes[1] ?? 0);
    const [rxAxis, ryAxis] = pickRightStickAxes(gp);
    const rx = applyDeadzone(gp.axes[rxAxis] ?? 0);
    const ry = applyDeadzone(gp.axes[ryAxis] ?? 0);

    // Left stick → move virtual cursor + fire mousemove
    if (lx !== 0 || ly !== 0) {
      moveCursor(lx * MOUSE_SPEED, ly * MOUSE_SPEED);
      const target = elementAtCursor();
      if (target) {
        target.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientX: virtualX,
          clientY: virtualY,
          screenX: virtualX,
          screenY: virtualY,
        }));
      }
    }

    // Right stick → scroll
    if (rx !== 0 || ry !== 0) {
      scrollAtCursor(rx * SCROLL_SPEED, ry * SCROLL_SPEED);
    } else {
      // Diagnostic: right stick moved but our chosen axes read zero → wrong indices.
      // Fires only on mismatch, so it won't flood the console.
      const otherAxisActive = gp.axes.some((a, i) => i > 1 && Math.abs(a) > DEADZONE);
      if (otherAxisActive) {
        console.warn('[GP] right-stick axes mismatch — raw axes:',
          gp.axes.map((a) => a.toFixed(2)), '| mapping:', gp.mapping || '(empty)');
      }
    }
  }

  // ── Buttons ───────────────────────────────────────────────────────────────

  function processButtons(gp) {
    gp.buttons.forEach((btn, i) => {
      const wasPressed = prevButtonStates[i] ?? false;
      if (btn.pressed && !wasPressed) onButtonDown(i);
      if (!btn.pressed && wasPressed) onButtonUp(i);
    });
  }

  const COMBO_WINDOW_MS = 500;
  let lastLBTime = 0;
  let lastRBTime = 0;

  function onButtonDown(index) {
    if (index === BTN.LB || index === BTN.RB) {
      const now = Date.now();
      const other = index === BTN.LB ? lastRBTime : lastLBTime;
      if (index === BTN.LB) lastLBTime = now; else lastRBTime = now;

      if (other > 0 && now - other <= COMBO_WINDOW_MS) {
        lastLBTime = 0;
        lastRBTime = 0;
        try { chrome.runtime.sendMessage({ type: 'closeTab' }); } catch (_) {}
      }
      // tab action fires on button up, not down
      return;
    }

    const action = BUTTON_MAP[index];
    if (!action) return;

    if (action.type === 'key') {
      dispatchKey('keydown', action);
    } else if (action.type === 'click') {
      const target = elementAtCursor();
      if (target) {
        target.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true,
          clientX: virtualX, clientY: virtualY,
          screenX: virtualX, screenY: virtualY,
        }));
        target.dispatchEvent(new MouseEvent('mousedown', mouseEventInit(action.mouseButton)));
      }
    } else if (action.type === 'playpause') {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: ' ',
        code: 'Space',
      }));
    } else if (action.type === 'youtube') {
      // YouTube's like/dislike buttons already toggle: clicking again removes
      // the rating, which gives the "press again to cancel" behaviour for free.
      if (IS_YOUTUBE) clickYouTubeRating(action.target);
    }
  }

  function onButtonUp(index) {
    if (index === BTN.LB || index === BTN.RB) {
      const wasCombo = index === BTN.LB ? lastLBTime === 0 : lastRBTime === 0;
      if (!wasCombo) {
        const action = BUTTON_MAP[index];
        if (action?.type === 'tab') {
          try { chrome.runtime.sendMessage({ type: 'switchTab', direction: action.direction }); } catch (_) {}
        }
      }
      if (index === BTN.LB) lastLBTime = 0; else lastRBTime = 0;
      return;
    }

    const action = BUTTON_MAP[index];
    if (!action) return;

    if (action.type === 'key') {
      dispatchKey('keyup', action);
      dispatchKey('keypress', action);
    } else if (action.type === 'click') {
      const target = elementAtCursor();
      if (target) {
        target.dispatchEvent(new MouseEvent('mouseup', mouseEventInit(action.mouseButton)));
        target.dispatchEvent(new MouseEvent('click', mouseEventInit(action.mouseButton)));
        if (action.mouseButton === 2) {
          target.dispatchEvent(new MouseEvent('contextmenu', mouseEventInit(2)));
        }
      }
    } else if (action.type === 'playpause') {
      document.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        key: ' ',
        code: 'Space',
      }));
    }
  }

  // ── Event helpers ─────────────────────────────────────────────────────────

  function dispatchKey(type, action) {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key: action.key,
      code: action.code,
      shiftKey: action.shiftKey ?? false,
    }));
  }

  function mouseEventInit(button) {
    return {
      bubbles: true,
      cancelable: true,
      button,
      buttons: button === 0 ? 1 : button === 2 ? 2 : 0,
      clientX: virtualX,
      clientY: virtualY,
      screenX: virtualX,
      screenY: virtualY,
    };
  }

  // ── YouTube like / dislike ─────────────────────────────────────────────────

  // Clicks the like or dislike button on the current YouTube watch page.
  // Selectors cover the current view-model markup with older-layout fallbacks;
  // aria-label text is avoided because it is localized.
  function clickYouTubeRating(target) {
    const selectors = target === 'like'
      ? ['like-button-view-model button', '#segmented-like-button button', '#top-level-buttons-computed ytd-toggle-button-renderer:first-of-type button']
      : ['dislike-button-view-model button', '#segmented-dislike-button button', '#top-level-buttons-computed ytd-toggle-button-renderer:nth-of-type(2) button'];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        return;
      }
    }
  }

  // ── DOM utilities ─────────────────────────────────────────────────────────

  function elementAtCursor() {
    return document.elementFromPoint(virtualX, virtualY) ?? document.body;
  }

  // Right stick axis indices vary by controller. Standard mapping (and most
  // 4-axis pads) put it on 2/3; common non-standard pads (e.g. PlayStation,
  // 6 axes where 2 & 5 are triggers) put it on 3/4.
  function pickRightStickAxes(gp) {
    if (gp.mapping === 'standard' || gp.axes.length <= 4) return [2, 3];
    return [3, 4];
  }

  // Scroll the nearest ancestor of the cursor that can actually move in the
  // requested direction; fall back to scrolling the whole page.
  function scrollAtCursor(dx, dy) {
    let el = document.elementFromPoint(virtualX, virtualY);
    while (el && el !== document.body && el !== document.documentElement) {
      if (canScroll(el, dx, dy)) {
        el.scrollLeft += dx;
        el.scrollTop += dy;
        return;
      }
      el = el.parentElement;
    }
    window.scrollBy(dx, dy);
  }

  function canScroll(el, dx, dy) {
    const style = getComputedStyle(el);
    const scrollableY = /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    const scrollableX = /auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    return (dy !== 0 && scrollableY) || (dx !== 0 && scrollableX);
  }

  function applyDeadzone(value) {
    if (Math.abs(value) < DEADZONE) return 0;
    return (value - Math.sign(value) * DEADZONE) / (1 - DEADZONE);
  }
})();
