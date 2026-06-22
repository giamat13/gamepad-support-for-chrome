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
    [BTN.B]:          { type: 'vkb_toggle' },
    [BTN.X]:          { type: 'playpause' },
    [BTN.Y]:          { type: 'fullscreen' },
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

  // ── Virtual keyboard state ────────────────────────────────────────────────
  let vkbOpen = false;
  let vkbEl = null;
  let vkbRow = 0;
  let vkbCol = 0;
  let vkbShift = false;
  let vkbCapsLock = false;
  let vkbLang = 'en'; // 'en' | 'he'

  // Rows are ordered bottom→top (row 0 = bottom row, displayed last → appears at bottom).
  // D-Pad UP increases vkbRow (moves visually upward), DOWN decreases it.
  const VKB_ROWS_EN = [
    ['עב',' ','←','→'],                                          // row 0 – bottom
    ['⇧','z','x','c','v','b','n','m',',','.','/',  '⇧'],        // row 1
    ['⇪','a','s','d','f','g','h','j','k','l',';',"'",'↵'],      // row 2
    ['q','w','e','r','t','y','u','i','o','p','[',']','\\'],      // row 3
    ['`','1','2','3','4','5','6','7','8','9','0','-','=','⌫'],   // row 4 – top
  ];

  // Hebrew layout — QWERTY positions map to Hebrew letters
  // Row order: bottom→top (same convention)
  const VKB_ROWS_HE = [
    ['EN',' ','←','→'],
    ['⇧','ז','ס','ב','ה','נ','מ','צ','ת','ץ','.',  '⇧'],
    ['⇪','ש','ד','ג','כ','ע','י','ח','ל','ך','פ','ף','↵'],
    ['ק','ו','א','ר','ט','ז','ו','ן','ם','פ',']','[','\\'],
    ['`','1','2','3','4','5','6','7','8','9','0','-','=','⌫'],
  ];

  // Proper Hebrew QWERTY mapping (standard Israeli keyboard)
  const HE_MAP = {
    q:'/', w:"'", e:'ק', r:'ר', t:'א', y:'ט', u:'ו', i:'ן', o:'ם', p:'פ',
    a:'ש', s:'ד', d:'ג', f:'כ', g:'ע', h:'י', j:'ח', k:'ל', l:'ך',
    z:'ז', x:'ס', c:'ב', v:'ה', b:'נ', n:'מ', m:'צ',
    ',':'ת', '.':'ץ', '/':'.',
    '[':']', ']':'[',
  };

  // Build Hebrew rows from EN rows, replacing letters with Hebrew equivalents
  function buildHeRows() {
    return VKB_ROWS_EN.map((row, ri) => {
      if (ri === 0) return ['EN', ' ', '←', '→'];
      return row.map(k => {
        if (k.length === 1 && HE_MAP[k.toLowerCase()]) return HE_MAP[k.toLowerCase()];
        return k;
      });
    });
  }

  const VKB_ROWS_HE_BUILT = buildHeRows();

  function vkbRows() {
    return vkbLang === 'he' ? VKB_ROWS_HE_BUILT : VKB_ROWS_EN;
  }

  const VKB_SHIFT_MAP = {
    '`':'~','1':'!','2':'@','3':'#','4':'$','5':'%','6':'^',
    '7':'&','8':'*','9':'(','0':')','-':'_','=':'+',
    '[':'{',']':'}','\\':'|',';':':','\'':'"',',':'<','.':'>','/':'?',
  };

  const VKB_KEY_MAP = {
    '⌫': { key: 'Backspace',  code: 'Backspace'  },
    '↵': { key: 'Enter',      code: 'Enter'      },
    '←': { key: 'ArrowRight', code: 'ArrowRight' }, // RTL: visual left = logical right
    '→': { key: 'ArrowLeft',  code: 'ArrowLeft'  }, // RTL: visual right = logical left
  };

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
      } else {
        // Site has native gamepad support: stay fully out of its way and only
        // watch for the Back+Start escape combo so the user isn't trapped.
        startEscapeWatcher(activeGamepadIndex);
      }
    }, DETECTION_WINDOW_MS);
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === activeGamepadIndex) {
      stopEmulation();
      stopEscapeWatcher();
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

  // ── Escape watcher (site has native gamepad support) ───────────────────────
  // When the page polls the Gamepad API itself, we disable the extension
  // completely in this tab — no virtual cursor, no emulated mouse/keyboard
  // input — so we never interfere with a site that already handles the pad.
  // The only thing we still listen for is a deliberate escape gesture: pressing
  // Back + Start together ESCAPE_COMBO_COUNT times switches to the next tab, so
  // the user can leave the page without reaching for the mouse.

  const ESCAPE_COMBO_COUNT = 5;
  const ESCAPE_COMBO_RESET_MS = 2000; // forget progress if presses are too slow
  let escapeRafId = null;
  let escapeCount = 0;
  let escapeLastTime = 0;
  let escapeComboPrev = false;

  function startEscapeWatcher(index) {
    if (escapeRafId !== null) return;

    const loop = () => {
      let gamepads;
      try {
        gamepads = nativeGetGamepads();
      } catch (_) {
        escapeRafId = requestAnimationFrame(loop);
        return;
      }

      const gp = gamepads[index];
      if (gp) {
        const comboDown =
          !!gp.buttons[BTN.SELECT]?.pressed && !!gp.buttons[BTN.START]?.pressed;

        // Count only the rising edge of the combo (both pressed this frame,
        // not the previous one) so a single hold isn't counted repeatedly.
        if (comboDown && !escapeComboPrev) {
          const now = Date.now();
          if (now - escapeLastTime > ESCAPE_COMBO_RESET_MS) escapeCount = 0;
          escapeLastTime = now;
          escapeCount++;
          showEscapeToast(escapeCount);

          if (escapeCount >= ESCAPE_COMBO_COUNT) {
            escapeCount = 0;
            try {
              chrome.runtime.sendMessage({ type: 'switchTab', direction: 'next' });
            } catch (_) {}
          }
        }
        escapeComboPrev = comboDown;
      }

      escapeRafId = requestAnimationFrame(loop);
    };

    escapeRafId = requestAnimationFrame(loop);
  }

  function stopEscapeWatcher() {
    if (escapeRafId !== null) {
      cancelAnimationFrame(escapeRafId);
      escapeRafId = null;
    }
    escapeCount = 0;
    escapeComboPrev = false;
    removeEscapeToast();
  }

  // Brief, non-interactive feedback so the user knows the escape combo is
  // registering and how many presses remain. Auto-dismisses after a moment.
  let escapeToastEl = null;
  let escapeToastTimer = null;

  function showEscapeToast(count) {
    if (!escapeToastEl) {
      escapeToastEl = document.createElement('div');
      escapeToastEl.id = '__gp4chrome_escape__';
      Object.assign(escapeToastEl.style, {
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: '2147483647',
        background: 'rgba(20,20,26,0.92)',
        color: '#e8e8e8',
        font: '600 13px system-ui, -apple-system, sans-serif',
        padding: '8px 12px',
        borderRadius: '8px',
        pointerEvents: 'none',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        direction: 'rtl',
      });
      (document.body || document.documentElement).appendChild(escapeToastEl);
    }
    escapeToastEl.textContent = `🎮 ${count}/${ESCAPE_COMBO_COUNT} — מעבר לטאב הבא`;
    clearTimeout(escapeToastTimer);
    escapeToastTimer = setTimeout(removeEscapeToast, 1500);
  }

  function removeEscapeToast() {
    clearTimeout(escapeToastTimer);
    escapeToastTimer = null;
    if (escapeToastEl) {
      escapeToastEl.remove();
      escapeToastEl = null;
    }
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
  let xHeld = false;
  let startHeld = false;

  // Normal reload — like F5 / clicking refresh.
  function reloadPage() {
    location.reload();
  }

  // Hard reload that bypasses the cache — like Ctrl+F5.
  // location.reload(true) is deprecated and the forceGet flag is ignored in
  // Chrome, so we force a fresh fetch by appending a unique cache-busting query
  // parameter (a timestamp), which the browser treats as a distinct URL.
  function hardReload() {
    const url = new URL(location.href);
    url.searchParams.set('__gp4chrome_cb', Date.now().toString());
    location.replace(url.toString());
  }

  function onButtonDown(index) {
    // ── Virtual keyboard intercepts B, D-Pad, and A when open ────────────────
    if (index === BTN.B) {
      vkbToggle();
      return;
    }

    if (vkbOpen) {
      if (index === BTN.DPAD_UP)    { vkbMove(-1, 0); return; }
      if (index === BTN.DPAD_DOWN)  { vkbMove( 1, 0); return; }
      if (index === BTN.DPAD_LEFT)  { vkbMove( 0,-1); return; }
      if (index === BTN.DPAD_RIGHT) { vkbMove( 0, 1); return; }
      if (index === BTN.A)          { vkbPress();      return; }
    }

    if (index === BTN.X) {
      xHeld = true;
      // X alone still handles playpause — will be dispatched if released without combo
      return;
    }

    if (index === BTN.START) {
      startHeld = true;
      // START still fires Enter below; don't return.
    }

    // Back button: reload the page. Back + Start: hard reload (bypass cache).
    if (index === BTN.SELECT) {
      if (startHeld) hardReload(); else reloadPage();
      return;
    }

    if (xHeld && index === BTN.DPAD_LEFT)  { history.back();    return; }
    if (xHeld && index === BTN.DPAD_RIGHT) { history.forward(); return; }
    if (xHeld && (index === BTN.DPAD_UP || index === BTN.DPAD_DOWN)) return;

    // YouTube: DPAD without X controls the video player directly
    if (IS_YOUTUBE && !xHeld) {
      if (index === BTN.DPAD_UP)    { adjustYouTubeVolume(0.1);          return; }
      if (index === BTN.DPAD_DOWN)  { adjustYouTubeVolume(-0.1);         return; }
      if (index === BTN.DPAD_LEFT)  { youTubePlayerKey('ArrowLeft');     return; }
      if (index === BTN.DPAD_RIGHT) { youTubePlayerKey('ArrowRight');    return; }
    }

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
    } else if (action.type === 'fullscreen') {
      // Only on YouTube watch pages (https://www.youtube.com/watch?v=...)
      if (IS_YOUTUBE && location.pathname === '/watch' && location.search.includes('v=')) {
        const fsBtn = document.querySelector('.ytp-fullscreen-button');
        if (fsBtn) {
          fsBtn.click();
        } else {
          // Fallback: the 'f' key is YouTube's native fullscreen shortcut
          document.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true, cancelable: true, key: 'f', code: 'KeyF',
          }));
        }
      } else {
        // On all other pages, fall back to Tab behaviour
        dispatchKey('keydown', { key: 'Tab', code: 'Tab' });
        dispatchKey('keyup',   { key: 'Tab', code: 'Tab' });
      }
    } else if (action.type === 'youtube') {
      // YouTube's like/dislike buttons already toggle: clicking again removes
      // the rating, which gives the "press again to cancel" behaviour for free.
      if (IS_YOUTUBE) clickYouTubeRating(action.target);
    }
  }

  function onButtonUp(index) {
    // B is handled fully on keydown (toggle); skip on up
    if (index === BTN.B) return;

    if (index === BTN.START) startHeld = false;

    // SELECT (Back) is handled fully on keydown (reload); skip on up
    if (index === BTN.SELECT) return;

    // While VKB is open, D-Pad and A are consumed on keydown; skip on up
    if (vkbOpen && (
      index === BTN.DPAD_UP || index === BTN.DPAD_DOWN ||
      index === BTN.DPAD_LEFT || index === BTN.DPAD_RIGHT ||
      index === BTN.A
    )) return;

    if (index === BTN.X) {
      if (xHeld) {
        // X released without a DPAD combo → treat as play/pause
        xHeld = false;
        if (!toggleYouTubePlayPause()) {
          document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ', code: 'Space' }));
          document.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, cancelable: true, key: ' ', code: 'Space' }));
        }
      }
      return;
    }
    // If X is still held and DPAD was released, do nothing (xHeld stays true)
    if (xHeld && (index === BTN.DPAD_LEFT || index === BTN.DPAD_RIGHT || index === BTN.DPAD_UP || index === BTN.DPAD_DOWN)) {
      return;
    }

    // YouTube DPAD (no X) was handled fully on keydown; skip keyup
    if (IS_YOUTUBE && !xHeld && (
      index === BTN.DPAD_UP || index === BTN.DPAD_DOWN ||
      index === BTN.DPAD_LEFT || index === BTN.DPAD_RIGHT
    )) return;

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

  // ── YouTube play / pause ───────────────────────────────────────────────────

  // Toggles play/pause of the current YouTube video by operating directly on the
  // <video> element. Dispatching the Space key works on Shorts but is unreliable
  // on regular /watch pages (it only pauses when the player has focus), so on
  // YouTube we control the media element directly. Returns true if it handled the
  // toggle, false to let the caller fall back to dispatching Space.
  function toggleYouTubePlayPause() {
    if (!IS_YOUTUBE) return false;
    const video = document.querySelector('video');
    if (!video) return false;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
    return true;
  }

  // ── YouTube seek ──────────────────────────────────────────────────────────

  // Seeks the YouTube video by delta seconds. Operates directly on the <video>
  // element's native currentTime — the player API (seekTo) lives in the page's
  // JS world and isn't reachable from the content script's isolated world.
  function youTubePlayerKey(key) {
    const video = document.querySelector('video');
    if (!video) return;
    const delta = key === 'ArrowRight' ? 5 : -5;
    video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + delta));
  }

  // ── YouTube volume ─────────────────────────────────────────────────────────

  // Adjusts the volume of the currently playing YouTube video by delta (-1..1).
  // Operates directly on the <video> element's native volume property — the
  // player API lives in the page's JS world and isn't reachable from the
  // content script's isolated world.
  function adjustYouTubeVolume(delta) {
    const video = document.querySelector('video');
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, video.volume + delta));
    if (delta > 0 && video.muted) video.muted = false;
  }

  // ── YouTube like / dislike ─────────────────────────────────────────────────

  // Clicks the like or dislike button on the current YouTube watch page or
  // Shorts page. Shorts uses a different component tree (ytd-reel-video-renderer)
  // and may have several renderers pre-loaded in the DOM at once, so we scope
  // the search to the active renderer.
  function clickYouTubeRating(target) {
    // ── Shorts page ──
    if (location.pathname.startsWith('/shorts/')) {
      // The active short's renderer carries the is-active attribute.
      const activeRenderer =
        document.querySelector('ytd-reel-video-renderer[is-active]') ??
        document.querySelector('ytd-reel-video-renderer');

      if (activeRenderer) {
        const shortsBtn = activeRenderer.querySelector(
          target === 'like'
            ? 'like-button-view-model button, #like-button button'
            : 'dislike-button-view-model button, #dislike-button button'
        );
        if (shortsBtn) { shortsBtn.click(); return; }
      }

      // Broader fallback for layout variants (e.g. reel-player-overlay)
      const shortsFallbackSelectors = target === 'like'
        ? [
            'ytd-reel-player-overlay-renderer like-button-view-model button',
            'ytd-reel-player-overlay-renderer #like-button button',
          ]
        : [
            'ytd-reel-player-overlay-renderer dislike-button-view-model button',
            'ytd-reel-player-overlay-renderer #dislike-button button',
          ];

      for (const sel of shortsFallbackSelectors) {
        const btn = document.querySelector(sel);
        if (btn) { btn.click(); return; }
      }
    }

    // ── Regular watch page ──
    const selectors = target === 'like'
      ? [
          'like-button-view-model button',
          '#segmented-like-button button',
          '#top-level-buttons-computed ytd-toggle-button-renderer:first-of-type button',
        ]
      : [
          'dislike-button-view-model button',
          '#segmented-dislike-button button',
          '#top-level-buttons-computed ytd-toggle-button-renderer:nth-of-type(2) button',
        ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) { btn.click(); return; }
    }
  }

  // ── Virtual keyboard ──────────────────────────────────────────────────────

  function vkbToggle() {
    if (vkbOpen) {
      vkbClose();
    } else {
      vkbOpenKeyboard();
    }
  }

  function vkbOpenKeyboard() {
    if (vkbEl) return;
    vkbOpen = true;
    vkbRow = 2; // home row (row index 2 from bottom = 'a s d f ...' / 'ש ד ג כ ...')
    vkbCol = 1;

    vkbEl = document.createElement('div');
    vkbEl.id = '__gp4chrome_vkb__';
    Object.assign(vkbEl.style, {
      position: 'fixed',
      bottom: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483646',
      background: 'rgba(30,30,36,0.97)',
      borderRadius: '14px',
      padding: '10px 12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
      userSelect: 'none',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      gap: '5px',
      minWidth: '420px',
    });

    vkbRender();
    (document.body || document.documentElement).appendChild(vkbEl);
  }

  function vkbClose() {
    vkbOpen = false;
    if (vkbEl) { vkbEl.remove(); vkbEl = null; }
  }

  function vkbRender() {
    if (!vkbEl) return;
    vkbEl.innerHTML = '';

    // Add language indicator header
    const header = document.createElement('div');
    Object.assign(header.style, {
      textAlign: 'center',
      fontSize: '11px',
      color: 'rgba(255,255,255,0.4)',
      marginBottom: '2px',
      letterSpacing: '0.5px',
    });
    header.textContent = vkbLang === 'he' ? '🇮🇱 עברית — B לסגור' : '🇺🇸 English — B to close';
    vkbEl.appendChild(header);

    const rows = vkbRows();
    // Render top→bottom visually = high row index first
    for (let ri = rows.length - 1; ri >= 0; ri--) {
      const row = rows[ri];
      const rowEl = document.createElement('div');
      Object.assign(rowEl.style, {
        display: 'flex',
        gap: '4px',
        justifyContent: 'center',
        direction: 'ltr', // always LTR so key positions stay consistent with D-Pad
      });

      row.forEach((key, ci) => {
        const keyEl = document.createElement('div');
        const isSelected = ri === vkbRow && ci === vkbCol;
        const isWide = key === ' ' || key === '⌫' || key === '↵' || key === '⇧' || key === '⇪' || key === 'עב' || key === 'EN';
        const displayKey = vkbLang === 'en' && (vkbShift || vkbCapsLock) && VKB_SHIFT_MAP[key]
          ? VKB_SHIFT_MAP[key] : key;
        const isCapsActive = vkbCapsLock && key === '⇪';
        const isShiftActive = vkbShift && key === '⇧';
        const isLangKey = key === 'עב' || key === 'EN';

        Object.assign(keyEl.style, {
          minWidth:  key === ' ' ? '100px' : isWide ? '52px' : '28px',
          height:    '34px',
          borderRadius: '6px',
          display:   'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize:  key.length > 1 ? '11px' : '13px',
          fontWeight: '500',
          cursor:    'pointer',
          transition: 'none',
          color:     isSelected ? '#111'
            : (isCapsActive || isShiftActive) ? '#f9c74f'
            : isLangKey ? '#74c0fc'
            : '#e0e0e0',
          background: isSelected
            ? '#f0f0f0'
            : (isCapsActive || isShiftActive)
              ? 'rgba(249,199,79,0.18)'
              : isLangKey
                ? 'rgba(116,192,252,0.15)'
                : 'rgba(255,255,255,0.09)',
          border:    isSelected ? '2px solid #fff' : '2px solid transparent',
          boxShadow: isSelected ? '0 0 0 2px #1a73e8' : 'none',
          flexShrink: '0',
        });
        keyEl.textContent = displayKey;
        rowEl.appendChild(keyEl);
      });

      vkbEl.appendChild(rowEl);
    }
  }

  function vkbMove(dr, dc) {
    if (!vkbOpen) return;
    const rows = vkbRows();
    if (dr !== 0) {
      // D-Pad UP (-1 from caller) moves visually up = higher row index, so negate dr
      vkbRow = Math.max(0, Math.min(rows.length - 1, vkbRow - dr));
      vkbCol = Math.min(vkbCol, rows[vkbRow].length - 1);
    } else {
      const rowLen = rows[vkbRow].length;
      vkbCol = (vkbCol + dc + rowLen) % rowLen;
    }
    vkbRender();
  }

  function vkbPress() {
    if (!vkbOpen) return;
    const key = vkbRows()[vkbRow][vkbCol];

    if (key === '⇧') {
      vkbShift = !vkbShift;
      vkbRender();
      return;
    }
    if (key === '⇪') {
      vkbCapsLock = !vkbCapsLock;
      vkbShift = false;
      vkbRender();
      return;
    }
    if (key === 'עב' || key === 'EN') {
      vkbLang = vkbLang === 'en' ? 'he' : 'en';
      vkbShift = false;
      vkbCapsLock = false;
      // Clamp col in case new row is shorter
      vkbCol = Math.min(vkbCol, vkbRows()[vkbRow].length - 1);
      vkbRender();
      return;
    }

    const target = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : document.elementFromPoint(virtualX, virtualY) ?? document.body;

    if (VKB_KEY_MAP[key]) {
      const { key: k, code } = VKB_KEY_MAP[key];
      target.dispatchEvent(new KeyboardEvent('keydown',  { bubbles: true, cancelable: true, key: k, code }));
      target.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: k, code }));
      target.dispatchEvent(new KeyboardEvent('keyup',    { bubbles: true, cancelable: true, key: k, code }));
    } else {
      // Printable character
      let ch = key;
      if (vkbLang === 'en') {
        // English: apply shift/caps
        if (VKB_SHIFT_MAP[key] && vkbShift) ch = VKB_SHIFT_MAP[key];
        else if (ch.length === 1 && (vkbShift || vkbCapsLock)) ch = ch.toUpperCase();
      }
      // Hebrew letters have no case — use as-is

      // Insert into editable targets directly; dispatch key events elsewhere
      if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        target.dispatchEvent(new KeyboardEvent('keydown',  { bubbles: true, cancelable: true, key: ch }));
        target.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch }));
        if ((target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && typeof target.selectionStart === 'number') {
          const s = target.selectionStart;
          const e = target.selectionEnd;
          target.value = target.value.slice(0, s) + ch + target.value.slice(e);
          target.selectionStart = target.selectionEnd = s + ch.length;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
        target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: ch }));
      } else {
        target.dispatchEvent(new KeyboardEvent('keydown',  { bubbles: true, cancelable: true, key: ch }));
        target.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: ch }));
        target.dispatchEvent(new KeyboardEvent('keyup',    { bubbles: true, cancelable: true, key: ch }));
      }

      // Auto-cancel shift after one character (English only)
      if (vkbShift && vkbLang === 'en') { vkbShift = false; }
    }
    vkbRender();
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