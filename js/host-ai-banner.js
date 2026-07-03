/*!
 * ХостAI — самовосстанавливающийся бренд-баннер.
 *
 * Особенности:
 *  - Компактный pill-баннер фиксированно слева снизу.
 *  - Контент рендерится в Shadow DOM (mode: 'closed') — внешний CSS изолирован.
 *  - Все стили хост-элемента inline `!important`, плюс `all: initial` чтобы
 *    обнулить наследование от страницы.
 *  - Кнопка закрытия реагирует только на event.isTrusted === true: программный
 *    el.click() / dispatchEvent — не закрывают.
 *  - Watchdog: MutationObserver на childList body (мгновенно ловит удаление)
 *    + MutationObserver на attributes хоста (style/class/id, восстанавливает)
 *    + setInterval (2с, fallback). Все три механизма крайне лёгкие.
 *  - Закрытие НЕ персистится — перезагрузка страницы возвращает баннер.
 */
(function () {
  'use strict';

  // ──────────────────────────── CONFIG ────────────────────────────

  var HOST_ID = 'host-ai-banner';
  var LINK_URL = 'https://host-ai.site';
  var WATCHDOG_INTERVAL_MS = 2000;

  // Простая локализация: русский, если основной язык браузера начинается с
  // "ru" (ru, ru-RU, ru-UA и т.п.), иначе — английский. Берём navigator.language
  // как самый стабильный сигнал; navigator.languages[0] подстраховывает.
  function isRussianUI() {
    try {
      var lang = (
        (typeof navigator !== 'undefined' && (navigator.language ||
          (navigator.languages && navigator.languages[0]))) || ''
      ).toLowerCase();
      return lang.indexOf('ru') === 0;
    } catch (_) {
      return false;
    }
  }

  var STRINGS = isRussianUI()
    ? {
        caption: 'Сделано на',
        ariaLabel: 'ХостAI',
        linkTitle: 'Создано на ХостAI — открыть host-ai.site',
        closeAria: 'Скрыть баннер',
        closeTitle: 'Скрыть',
      }
    : {
        caption: 'Made with',
        ariaLabel: 'HostAI',
        linkTitle: 'Made with ХостAI — open host-ai.site',
        closeAria: 'Hide banner',
        closeTitle: 'Hide',
      };

  // Перезащищаемся через MutationObserver, но если кто-то перезаписал style
  // в одном кадре несколько раз — debounce-флаг защищает от рекурсии.
  var SELF_MUTATION_FLAG = '__hostAiSelfMutation__';

  // ──────────────────────────── STATE ─────────────────────────────

  /** @type {HTMLElement|null} */ var hostEl = null;
  /** @type {ShadowRoot|null} */ var shadowRoot = null;
  /** Закрыто пользователем в этой сессии — больше не воссоздаём. */
  var closedByUser = false;
  /** Идёт ли создание элемента (защита от гонок recreate). */
  var creating = false;
  /** @type {MutationObserver|null} */ var parentObserver = null;
  /** @type {MutationObserver|null} */ var attrObserver = null;
  /** @type {number|null} */ var watchdogTimer = null;

  // ──────────────────────────── SHADOW DOM CONTENT ─────────────────

  function buildShadowContent(shadow) {
    var style = document.createElement('style');
    style.textContent = [
      ':host { all: initial; }',
      '.bar {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  padding: 4px 6px 4px 14px;',
      '  background: linear-gradient(135deg, #9333ea 0%, #2563eb 100%);',
      '  border-radius: 999px;',
      '  box-shadow: 0 10px 32px rgba(91, 33, 182, 0.38), 0 2px 8px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.18);',
      '  color: #fff;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
      '  font-size: 13px;',
      '  line-height: 1;',
      '  user-select: none;',
      '  -webkit-tap-highlight-color: transparent;',
      '}',
      '.caption {',
      '  font-size: 9px;',
      '  font-weight: 700;',
      '  letter-spacing: 1.2px;',
      '  text-transform: uppercase;',
      '  opacity: 0.75;',
      '  white-space: nowrap;',
      '}',
      '.divider {',
      '  width: 1px;',
      '  height: 14px;',
      '  background: rgba(255,255,255,0.25);',
      '  flex-shrink: 0;',
      '}',
      '.link {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  color: #fff;',
      '  text-decoration: none;',
      '  padding: 6px 8px;',
      '  border-radius: 999px;',
      '  transition: background-color 0.18s ease, transform 0.12s ease;',
      '}',
      '.link:hover { background-color: rgba(255,255,255,0.14); }',
      '.link:active { transform: scale(0.97); }',
      '.link:focus-visible { outline: 2px solid rgba(255,255,255,0.85); outline-offset: 2px; }',
      '.logo {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  width: 18px;',
      '  height: 18px;',
      '  border-radius: 6px;',
      '  background: rgba(255,255,255,0.18);',
      '  font-size: 12px;',
      '  font-weight: 700;',
      '}',
      '.text { font-weight: 600; letter-spacing: 0.2px; }',
      '.dot { opacity: 0.75; font-weight: 400; margin: 0 2px; }',
      '.close {',
      '  all: unset;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  width: 22px;',
      '  height: 22px;',
      '  border-radius: 999px;',
      '  background: rgba(255,255,255,0.14);',
      '  color: #fff;',
      '  font-size: 16px;',
      '  line-height: 1;',
      '  cursor: pointer;',
      '  transition: background-color 0.18s ease;',
      '}',
      '.close:hover { background-color: rgba(255,255,255,0.28); }',
      '.close:active { background-color: rgba(255,255,255,0.18); }',
      '.close:focus-visible { outline: 2px solid rgba(255,255,255,0.85); outline-offset: 2px; }',
      '@media (max-width: 480px) {',
      '  .bar { padding: 3px 5px 3px 11px; font-size: 12px; gap: 6px; }',
      '  .caption { font-size: 9px; letter-spacing: 1px; }',
      '  .divider { height: 12px; }',
      '  .logo { width: 16px; height: 16px; font-size: 11px; }',
      '  .link { padding: 5px 6px; gap: 5px; }',
      '  .close { width: 20px; height: 20px; font-size: 15px; }',
      '}',
      '@media (prefers-reduced-motion: reduce) {',
      '  .link, .close { transition: none; }',
      '}',
    ].join('\n');
    shadow.appendChild(style);

    var bar = document.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('role', 'complementary');
    bar.setAttribute('aria-label', STRINGS.ariaLabel);

    var caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = STRINGS.caption;

    var divider = document.createElement('span');
    divider.className = 'divider';
    divider.setAttribute('aria-hidden', 'true');

    var link = document.createElement('a');
    link.className = 'link';
    link.href = LINK_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = STRINGS.linkTitle;

    var logo = document.createElement('span');
    logo.className = 'logo';
    logo.setAttribute('aria-hidden', 'true');
    logo.textContent = '⚡';

    var text = document.createElement('span');
    text.className = 'text';
    text.textContent = 'ХостAI';

    link.appendChild(logo);
    link.appendChild(text);

    var close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.setAttribute('aria-label', STRINGS.closeAria);
    close.title = STRINGS.closeTitle;
    close.textContent = '×';
    // Защита от программного клика: реагируем только на доверенные события.
    close.addEventListener('click', function (e) {
      if (!e || !e.isTrusted) return;
      destroy();
    });

    bar.appendChild(caption);
    bar.appendChild(divider);
    bar.appendChild(link);
    bar.appendChild(close);
    shadow.appendChild(bar);
  }

  // ──────────────────────────── HOST STYLING ───────────────────────

  /**
   * Применяет inline-стили хоста с !important. Любая внешняя CSS-правка
   * перебивается inline + !important; mutation на attributes хоста
   * восстанавливает стили мгновенно.
   */
  function applyHostStyles() {
    if (!hostEl) return;
    hostEl[SELF_MUTATION_FLAG] = true;
    try {
      var s = hostEl.style;
      // Сбрасываем всё унаследованное со страницы.
      s.setProperty('all', 'initial', 'important');
      // Позиционирование.
      s.setProperty('position', 'fixed', 'important');
      s.setProperty('left', '16px', 'important');
      s.setProperty('bottom', '16px', 'important');
      s.setProperty('right', 'auto', 'important');
      s.setProperty('top', 'auto', 'important');
      s.setProperty('z-index', '2147483647', 'important');
      // Геометрия и отображение.
      s.setProperty('display', 'block', 'important');
      s.setProperty('width', 'auto', 'important');
      s.setProperty('height', 'auto', 'important');
      s.setProperty('max-width', 'calc(100vw - 32px)', 'important');
      s.setProperty('margin', '0', 'important');
      s.setProperty('padding', '0', 'important');
      s.setProperty('border', '0', 'important');
      s.setProperty('background', 'transparent', 'important');
      // Защита от внешних трюков сокрытия.
      s.setProperty('visibility', 'visible', 'important');
      s.setProperty('opacity', '1', 'important');
      s.setProperty('pointer-events', 'auto', 'important');
      s.setProperty('transform', 'none', 'important');
      s.setProperty('clip', 'auto', 'important');
      s.setProperty('clip-path', 'none', 'important');
      s.setProperty('filter', 'none', 'important');
      // Изоляция от внешнего layout/reflow.
      s.setProperty('contain', 'layout style', 'important');
      s.setProperty('isolation', 'isolate', 'important');
    } finally {
      // Снимаем флаг в следующем тике — observer'у достаточно времени
      // пропустить наши собственные мутации.
      setTimeout(function () {
        if (hostEl) hostEl[SELF_MUTATION_FLAG] = false;
      }, 0);
    }
  }

  // ──────────────────────────── WATCHDOGS ──────────────────────────

  function watchHostAttrs() {
    if (!hostEl) return;
    if (attrObserver) attrObserver.disconnect();
    attrObserver = new MutationObserver(function (records) {
      if (!hostEl || hostEl[SELF_MUTATION_FLAG]) return;
      for (var i = 0; i < records.length; i++) {
        var name = records[i].attributeName;
        if (name === 'style' || name === 'class' || name === 'id' || name === 'hidden') {
          // id могли подменить — восстановим, остальное переприменим стилями.
          if (hostEl.id !== HOST_ID) hostEl.id = HOST_ID;
          if (hostEl.hasAttribute('hidden')) hostEl.removeAttribute('hidden');
          applyHostStyles();
          return;
        }
      }
    });
    attrObserver.observe(hostEl, {
      attributes: true,
      attributeFilter: ['style', 'class', 'id', 'hidden'],
    });
  }

  function watchParent() {
    if (parentObserver) parentObserver.disconnect();
    if (!document.body) return;
    parentObserver = new MutationObserver(function () {
      if (closedByUser) return;
      if (!hostEl || !hostEl.isConnected) {
        // Лёгкая ветка: только пере-аппенд, без пересоздания узла, если
        // хост ещё цел. Если узел потерян (его очистили) — пересоздаём.
        if (hostEl && document.body) {
          try {
            document.body.appendChild(hostEl);
            return;
          } catch (_) {
            /* пересоздадим ниже */
          }
        }
        recreate();
      }
    });
    parentObserver.observe(document.body, { childList: true });
  }

  function startWatchdog() {
    if (watchdogTimer) clearInterval(watchdogTimer);
    // Fallback на случай, если observer'ы по какой-то причине отвалятся
    // (frozen tab restore, devtools throttling, ручной disconnect и т.п.).
    // Дешёвая проверка раз в 2 секунды.
    watchdogTimer = setInterval(function () {
      if (closedByUser) return;
      if (!document.body) return;
      if (!hostEl || !hostEl.isConnected) recreate();
    }, WATCHDOG_INTERVAL_MS);
  }

  // ──────────────────────────── LIFECYCLE ──────────────────────────

  function recreate() {
    if (creating || closedByUser) return;
    create();
  }

  function create() {
    if (closedByUser) return;
    if (creating) return;
    if (!document.body) {
      // Если скрипт подключён в head — дождёмся body.
      var onReady = function () { create(); };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady, { once: true });
      } else {
        // body может быть null в редких случаях между событиями — пробуем чуть позже.
        setTimeout(onReady, 0);
      }
      return;
    }

    creating = true;
    try {
      // Если по какой-то причине остался старый узел с нашим id — выкинем.
      var existing = document.getElementById(HOST_ID);
      if (existing && existing !== hostEl) {
        try { existing.remove(); } catch (_) {}
      }

      hostEl = document.createElement('div');
      hostEl.id = HOST_ID;
      applyHostStyles();
      shadowRoot = hostEl.attachShadow({ mode: 'closed' });
      buildShadowContent(shadowRoot);
      document.body.appendChild(hostEl);

      watchHostAttrs();
      watchParent();
    } finally {
      creating = false;
    }
  }

  function destroy() {
    closedByUser = true;
    if (attrObserver) { attrObserver.disconnect(); attrObserver = null; }
    if (parentObserver) { parentObserver.disconnect(); parentObserver = null; }
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
    if (hostEl) {
      try { hostEl.remove(); } catch (_) {}
    }
    hostEl = null;
    shadowRoot = null;
  }

  // ──────────────────────────── INIT ───────────────────────────────

  function init() {
    create();
    startWatchdog();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
