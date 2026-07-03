/**
 * Служебный скрипт host-ai.site
 * 1. В production-режиме (не iframe): отправляет beacon аналитики просмотров
 * 2. В dev-режиме (iframe + develop_mode=true): выделение элементов и отправка селекторов
 * Автоматически инициализируется после загрузки страницы
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') {
    return;
  }

  // --- Универсальная подмена картинок на host-ai прокси ---
  // images.unsplash.com → images.host-ai.site
  // picsum.photos       → picsum.host-ai.site
  // Запускаем и в production (опубликованный сайт), и в dev-iframe — везде, где
  // подключён этот скрипт. Сохраняем полный path/query/hash, меняем только домен.
  // Покрытие: <img src>, <img srcset>, <source src/srcset> (внутри <picture>),
  // плюс отслеживаем динамически добавленные и переписанные элементы через
  // MutationObserver (lazy-load, гидрация фреймворков, слайдеры).
  (function setupImageRewriter() {
    // Префиксы: начало строки, пробел или запятая — нужно для srcset, где URL'ы
    // разделены запятой и пробелом. Без этого можем неаккуратно зацепить что-то
    // в середине строки. Протокол `https:` опционален, чтобы покрыть `//images.unsplash.com/...`.
    var REWRITES = [
      {
        marker: 'images.unsplash.com',
        re: /(^|\s|,)(https?:)?\/\/images\.unsplash\.com\//gi,
        replacement: '$1https://images.host-ai.site/',
      },
      {
        marker: 'picsum.photos',
        re: /(^|\s|,)(https?:)?\/\/picsum\.photos\//gi,
        replacement: '$1https://picsum.host-ai.site/',
      },
    ];

    function rewriteValue(value) {
      if (!value || typeof value !== 'string') return value;
      var next = value;
      for (var i = 0; i < REWRITES.length; i++) {
        var r = REWRITES[i];
        if (next.indexOf(r.marker) === -1) continue;
        next = next.replace(r.re, r.replacement);
      }
      return next;
    }

    function maybeRewriteAttr(el, attrName) {
      try {
        var value = el.getAttribute(attrName);
        if (!value) return;
        var next = rewriteValue(value);
        // Меняем атрибут только если результат отличается — иначе MutationObserver
        // будет триггерить сам себя на каждой записи.
        if (next !== value) el.setAttribute(attrName, next);
      } catch (e) {
        // ignore
      }
    }

    function processElement(el) {
      if (!el || el.nodeType !== 1) return;
      var tag = el.tagName;
      if (tag === 'IMG') {
        maybeRewriteAttr(el, 'src');
        maybeRewriteAttr(el, 'srcset');
      } else if (tag === 'SOURCE') {
        maybeRewriteAttr(el, 'srcset');
        maybeRewriteAttr(el, 'src');
      }
    }

    function processSubtree(root) {
      if (!root || root.nodeType !== 1) return;
      processElement(root);
      try {
        var imgs = root.getElementsByTagName ? root.getElementsByTagName('img') : [];
        for (var i = 0; i < imgs.length; i++) processElement(imgs[i]);
        var sources = root.getElementsByTagName ? root.getElementsByTagName('source') : [];
        for (var j = 0; j < sources.length; j++) processElement(sources[j]);
      } catch (e) {
        // ignore
      }
    }

    function initialScan() {
      processSubtree(document.body || document.documentElement);
    }

    // Запуск переписывания и observer'а откладываем на 1 сек после window.load.
    // Иначе rewrite успевает попасть в DOM ДО React hydration, и React падает с
    // ошибкой #418 (text content / hydration mismatch — он ожидает увидеть тот же
    // DOM, который отрендерил SSR). К моменту load+1сек hydration гарантированно
    // завершён, и подмена атрибутов уже не ломает реактовый diff.
    var REWRITE_START_DELAY_MS = 1000;
    var rewriteStarted = false;

    function startRewriter() {
      if (rewriteStarted) return;
      rewriteStarted = true;
      initialScan();
      try {
        if (typeof MutationObserver === 'function') {
          var observer = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
              var m = mutations[i];
              if (m.type === 'attributes') {
                if (m.target && m.target.nodeType === 1) processElement(m.target);
              } else if (m.type === 'childList') {
                for (var j = 0; j < m.addedNodes.length; j++) {
                  var node = m.addedNodes[j];
                  if (node && node.nodeType === 1) processSubtree(node);
                }
              }
            }
          });
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['src', 'srcset'],
          });
        }
      } catch (e) {
        // MutationObserver не поддерживается / запрещён — без динамического слежения.
      }
    }

    function scheduleStart() {
      setTimeout(startRewriter, REWRITE_START_DELAY_MS);
    }

    if (document.readyState === 'complete') {
      scheduleStart();
    } else {
      window.addEventListener('load', scheduleStart, { once: true });
    }
  })();

  // --- Analytics (production) ---
  // Отправляем beacon аналитики, если страница открыта напрямую (не в iframe dev-редактора)
  if (window.self === window.top) {
    (function () {
      // Базовая фильтрация ботов по User-Agent
      if (/bot|crawl|spider|slurp|lighthouse|headless/i.test(navigator.userAgent)) return;

      var data = JSON.stringify({ h: window.location.hostname, p: window.location.pathname });

      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon('https://host-ai.site/api/v1/public/track', new Blob([data], { type: 'application/json' }));
        } else {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', 'https://host-ai.site/api/v1/public/track', true);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.send(data);
        }
      } catch (e) {
        // Ошибки трекинга не должны влиять на работу сайта
      }
    })();
    return; // Не продолжаем к dev-функциональности
  }

  // --- Dev mode (iframe) ---
  // Работаем только когда загружены в iframe
  if (window.self === window.top) {
    return;
  }

  // Проверяем наличие develop_mode в URL только один раз при первой загрузке
  // Сохраняем флаг в sessionStorage, чтобы он работал при навигации внутри iframe
  let isDevMode = false;
  const devModeKey = 'host-ai-dev-mode';

  // Проверяем sessionStorage для develop_mode
  try {
    const storedDev = sessionStorage.getItem(devModeKey);
    if (storedDev === 'true') {
      isDevMode = true;
    } else if (window.location.href.includes('develop_mode=true')) {
      // Если параметр есть в URL, сохраняем флаг
      isDevMode = true;
      sessionStorage.setItem(devModeKey, 'true');
    }
  } catch (e) {
    // Если sessionStorage недоступен, проверяем URL напрямую
    isDevMode = window.location.href.includes('develop_mode=true');
  }

  if (!isDevMode) {
    return;
  }

  // Маркер версии — проверить в DevTools iframe, что загружена свежая версия скрипта.
  // Если этой строки в консоли iframe нет — значит сайт клиента раздаёт старую копию
  // host-ai-scripts.js (либо CDN-кэш, либо backend ещё не передеплоил).
  try {
    console.log('[host-ai-scripts v3] dev-mode reporter active');
  } catch (e) {
    // ignore
  }

  // ── Heartbeat и репорт ошибок наверх (только dev-mode внутри iframe) ──
  // Цели:
  //  1) heartbeat — позволяет родителю детектировать «зависание» main thread сайта;
  //  2) error/unhandledrejection — складываем баги превью в очередь задач редактора,
  //     чтобы пользователь мог отправить их AI как новые сообщения.
  // Все ветки обёрнуты в try/catch — баг самого репортера не должен ронять сайт клиента.
  (function setupHostAiReporter() {
    if (!window.parent || window.parent === window.self) {
      return;
    }

    function postSafe(payload) {
      try {
        window.parent.postMessage(payload, '*');
      } catch (e) {
        // ignore
      }
    }

    try {
      setInterval(function () {
        postSafe({ type: 'host-ai-heartbeat', ts: Date.now() });
      }, 1000);
    } catch (e) {
      // ignore
    }

    // Дедупликация одинаковых ошибок (30s) + общий rate-limit (≤5 событий/мин).
    const DEDUPE_WINDOW_MS = 30000;
    const RATE_LIMIT_MAX = 5;
    const RATE_LIMIT_WINDOW_MS = 60000;
    const lastSentByKey = Object.create(null);
    let sentTimestamps = [];

    function shouldSend(key) {
      const now = Date.now();
      const last = lastSentByKey[key];
      if (last && now - last < DEDUPE_WINDOW_MS) return false;
      sentTimestamps = sentTimestamps.filter(function (t) { return now - t < RATE_LIMIT_WINDOW_MS; });
      if (sentTimestamps.length >= RATE_LIMIT_MAX) return false;
      lastSentByKey[key] = now;
      sentTimestamps.push(now);
      return true;
    }

    function clip(s, max) {
      if (typeof s !== 'string') return undefined;
      return s.length > max ? s.slice(0, max) : s;
    }

    function reportError(payload) {
      try {
        // payload._k — явный ключ дедупа (если задан). Иначе строим из kind|message|source|lineno.
        // _k не уходит наверх — это внутреннее поле дедупа.
        var key = payload._k || ((payload.kind || '') + '|' + (payload.message || '') + '|' + (payload.source || '') + '|' + (payload.lineno || ''));
        if (payload._k) delete payload._k;
        if (!shouldSend(key)) return;
        postSafe(payload);
      } catch (e) {
        // ignore
      }
    }

    try {
      window.addEventListener('error', function (e) {
        try {
          const msg = e && e.message ? String(e.message) : 'Unknown error';
          reportError({
            type: 'host-ai-error',
            kind: 'error',
            message: clip(msg, 500),
            source: clip(e && e.filename, 300),
            lineno: e && typeof e.lineno === 'number' ? e.lineno : undefined,
            colno: e && typeof e.colno === 'number' ? e.colno : undefined,
            stack: clip(e && e.error && e.error.stack ? String(e.error.stack) : '', 1000),
            url: clip(window.location ? window.location.href : '', 500),
          });
        } catch (err) {
          // ignore
        }
      });
    } catch (e) {
      // ignore
    }

    try {
      window.addEventListener('unhandledrejection', function (e) {
        try {
          const reason = e && e.reason;
          let msg = '';
          let stack = '';
          if (reason instanceof Error) {
            msg = reason.message || String(reason);
            stack = reason.stack ? String(reason.stack) : '';
          } else if (typeof reason === 'string') {
            msg = reason;
          } else {
            try { msg = JSON.stringify(reason); } catch (_) { msg = String(reason); }
          }
          reportError({
            type: 'host-ai-error',
            kind: 'unhandled-rejection',
            message: clip(msg, 500),
            stack: clip(stack, 1000),
            url: clip(window.location ? window.location.href : '', 500),
          });
        } catch (err) {
          // ignore
        }
      });
    } catch (e) {
      // ignore
    }

    // ── console.error → host-ai-error (kind:'console-error') ──
    // Ловит ошибки, которые фреймворки (например Angular ErrorHandler) печатают
    // через console.error, не бросая исключение и не оставляя unhandledrejection.
    // HTTP-ошибки Angular («Http failure response …») пропускаем — их точнее ловит
    // обёртка XHR/fetch ниже (иначе один 402 попал бы в список дважды).
    try {
      var origConsoleError = console.error.bind(console);
      console.error = function () {
        try {
          var parts = [];
          for (var i = 0; i < arguments.length; i++) {
            var a = arguments[i];
            if (a instanceof Error) parts.push(String(a.message || a) + (a.stack ? '\n' + a.stack : ''));
            else if (typeof a === 'string') parts.push(a);
            else { try { parts.push(JSON.stringify(a)); } catch (_) { parts.push(String(a)); } }
          }
          var cmsg = parts.join(' ').trim();
          if (cmsg && !/Http failure response/i.test(cmsg)) {
            reportError({
              type: 'host-ai-error',
              kind: 'console-error',
              message: clip(cmsg, 500),
              url: clip(window.location ? window.location.href : '', 500),
            });
          }
        } catch (err) {
          // ignore
        }
        return origConsoleError.apply(console, arguments);
      };
    } catch (e) {
      // ignore
    }

    // ── fetch / XMLHttpRequest с не-OK HTTP-статусом (>=400) → host-ai-error (kind:'http-error') ──
    // Ответ 402/4xx/5xx сам по себе не порождает ни 'error', ни 'unhandledrejection',
    // поэтому без этих обёрток сетевые ошибки превью невидимы. Angular HttpClient ходит через XHR.
    function reportHttpError(method, url, status) {
      try {
        if (!url || typeof status !== 'number' || status < 400) return;
        // 502/503/504 — шлюзовые ответы во время деплоя / холодного старта / перезапуска
        // сайта клиента. Это инфраструктурные транзиентные ошибки, не баги кода — не репортим.
        if (status === 502 || status === 503 || status === 504) return;
        if (String(url).indexOf('/public/track') !== -1) return; // свой аналитический бакон
        var m = method ? String(method).toUpperCase() : '';
        // Дедуп по пути БЕЗ query — иначе cache-buster (?_=<timestamp>) и прочие
        // меняющиеся параметры плодят дубли одного и того же эндпоинта.
        var path = String(url).split('?')[0];
        reportError({
          type: 'host-ai-error',
          kind: 'http-error',
          status: status,
          method: m || undefined,
          requestUrl: clip(String(url), 500),
          message: clip('HTTP ' + status + ' ' + (m ? m + ' ' : '') + String(url), 500),
          url: clip(window.location ? window.location.href : '', 500),
          _k: 'http-error|' + status + '|' + path,
        });
      } catch (e) {
        // ignore
      }
    }

    try {
      if (typeof window.fetch === 'function') {
        var origFetch = window.fetch.bind(window);
        window.fetch = function (input, init) {
          var method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
          var url = '';
          try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) { url = ''; }
          return origFetch(input, init).then(function (response) {
            try { if (response && !response.ok) reportHttpError(method, url, response.status); } catch (_) {}
            return response;
          });
        };
      }
    } catch (e) {
      // ignore
    }

    try {
      var XHR = window.XMLHttpRequest;
      if (XHR && XHR.prototype) {
        var origOpen = XHR.prototype.open;
        var origSend = XHR.prototype.send;
        XHR.prototype.open = function (method, url) {
          try { this.__hostAiMethod = method; this.__hostAiUrl = url; } catch (_) {}
          return origOpen.apply(this, arguments);
        };
        XHR.prototype.send = function () {
          try {
            var xhr = this;
            this.addEventListener('loadend', function () {
              try { if (xhr.status >= 400) reportHttpError(xhr.__hostAiMethod, xhr.__hostAiUrl, xhr.status); } catch (_) {}
            });
          } catch (_) {}
          return origSend.apply(this, arguments);
        };
      }
    } catch (e) {
      // ignore
    }
  })();

  let isEnabled = false;
  let hoveredElement = null;
  let selectedElement = null;
  let overlay = null;
  let viewportCheckInterval = null;
  let lastViewportSize = { width: 0, height: 0 };
  let isCursorInsideFrame = true; // Флаг для отслеживания, находится ли курсор внутри фрейма
  let handlersAttached = false; // Флаг для отслеживания, прикреплены ли обработчики

  // Функция для построения селектора одного элемента
  function buildElementSelector(el) {
    // Если у элемента есть id - используем его
    if (el.id) {
      return '#' + el.id;
    }

    let selector = el.tagName.toLowerCase();
    // Добавляем классы
    if (el.className && typeof el.className === 'string') {
      const classes = el.className
        .split(' ')
        .filter(function (c) {
          return c.trim();
        })
        .map(function (c) {
          return '.' + c.trim();
        })
        .join('');
      if (classes) {
        selector += classes;
      }
    }

    return selector;
  }

  // Функция для генерации селектора элемента
  function generateSelector(element) {
    const maxDepth = 10; // Максимальная глубина поиска - 10 элементов

    // Собираем путь из максимум 10 элементов вверх
    const path = [];
    let current = element;
    let depth = 0;

    // Поднимаемся вверх максимум на 10 уровней
    while (current && current !== document.body && current !== document.documentElement && depth < maxDepth) {
      path.push(current);
      current = current.parentElement;
      depth++;
    }

    let elementWithId = null;
    let maxClassListLength = 0;
    let elementWithLongestClassList = null;
    for (let i = 0; i < path.length; i++) {
      const el = path[i];
      if (!elementWithId && el.id) {
        elementWithId = el;
      }
      const classListLength = el.className && typeof el.className === 'string'
        ? el.className.split(' ').filter(function (c) { return c.trim(); }).length
        : 0;
      if (classListLength > maxClassListLength) {
        maxClassListLength = classListLength;
        elementWithLongestClassList = el;
      }
    }

    if ((elementWithId || elementWithLongestClassList) === element) {
      return buildElementSelector(element);
    }

    return buildElementSelector(elementWithId || elementWithLongestClassList) + ' > ' + buildElementSelector(element);
  }

  function getElementBounds(element) {
    const rect = element.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    return {
      top: rect.top + scrollY,
      left: rect.left + scrollX,
      width: rect.width,
      height: rect.height,
    };
  }

  // Функция для обновления overlay
  function updateOverlay(element) {
    if (!overlay || !element) {
      if (overlay) {
        overlay.style.display = 'none';
      }
      return;
    }

    const bounds = getElementBounds(element);

    overlay.style.display = 'block';
    overlay.style.top = bounds.top + 'px';
    overlay.style.left = bounds.left + 'px';
    overlay.style.width = bounds.width + 'px';
    overlay.style.height = bounds.height + 'px';
  }

  // Инициализация overlay
  function initOverlay() {
    if (overlay) {
      return;
    }

    overlay = document.createElement('div');
    overlay.setAttribute('data-selector-overlay', 'true');
    // Используем absolute позиционирование - координаты будут относительно body
    overlay.style.position = 'absolute';
    overlay.style.pointerEvents = 'none';
    overlay.style.border = '2px dashed #3b82f6';
    overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'none';
    overlay.style.transition = 'all 0.1s ease';

    // Добавляем overlay в body
    document.body.appendChild(overlay);
  }

  // Обработчик движения мыши
  function handleMouseMove(e) {
    if (!isEnabled) {
      // Дополнительно скрываем overlay и очищаем состояние при отключении
      if (overlay) {
        overlay.style.display = 'none';
      }
      hoveredElement = null;
      return;
    }

    // Проверяем, находится ли курсор в пределах фрейма
    const cursorX = e.clientX;
    const cursorY = e.clientY;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Отправляем координаты курсора в родительское окно
    if (window.parent && window.parent !== window.self) {
      let iframeOffsetX = 0;
      let iframeOffsetY = 0;

      try {
        const frameElement = window.frameElement;
        if (frameElement) {
          const iframeRect = frameElement.getBoundingClientRect();
          iframeOffsetX = iframeRect.left;
          iframeOffsetY = iframeRect.top;
        }
      } catch (e) {
        // Игнорируем ошибки CORS
      }

      // Отправляем координаты курсора относительно родительского окна
      window.parent.postMessage(
        {
          type: 'cursor-move',
          cursorX: cursorX + iframeOffsetX,
          cursorY: cursorY + iframeOffsetY,
        },
        '*'
      );
    }

    // Если курсор вышел за границы фрейма, скрываем overlay
    if (cursorX < 0 || cursorY < 0 || cursorX > viewportWidth || cursorY > viewportHeight) {
      isCursorInsideFrame = false;
      if (overlay) {
        overlay.style.display = 'none';
      }
      hoveredElement = null;
      return;
    }

    // Курсор внутри фрейма
    isCursorInsideFrame = true;

    const target = e.target;
    if (!target || target === overlay) return;

    // Пропускаем служебные элементы
    if (target.closest && target.closest('[data-selector-overlay]')) return;

    hoveredElement = target;
    updateOverlay(target);
  }

  // Обработчик клика
  function handleClick(e) {
    if (!isEnabled) return;

    e.preventDefault();
    e.stopPropagation();

    const target = e.target;
    if (!target || target === overlay) return;

    if (target.closest && target.closest('[data-selector-overlay]')) return;

    selectedElement = target;
    const selector = generateSelector(target);
    const rect = target.getBoundingClientRect();

    // Получаем координаты относительно viewport
    const bounds = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };

    // Координаты курсора относительно viewport
    const cursorX = e.clientX;
    const cursorY = e.clientY;

    // Отправляем в родительское окно через postMessage
    if (window.parent && window.parent !== window.self) {
      // Получаем позицию iframe относительно родительского окна
      let iframeOffsetX = 0;
      let iframeOffsetY = 0;

      try {
        const frameElement = window.frameElement;
        if (frameElement) {
          const iframeRect = frameElement.getBoundingClientRect();
          iframeOffsetX = iframeRect.left;
          iframeOffsetY = iframeRect.top;
        }
      } catch (e) {
        // Если доступ к frameElement запрещен, используем 0
        console.warn('Cannot access frameElement:', e);
      }

      window.parent.postMessage(
        {
          type: 'element-selected',
          selector: selector,
          bounds: {
            x: bounds.x + iframeOffsetX,
            y: bounds.y + iframeOffsetY,
            width: bounds.width,
            height: bounds.height,
          },
          cursorX: cursorX + iframeOffsetX,
          cursorY: cursorY + iframeOffsetY,
          elementInfo: {
            tagName: target.tagName.toLowerCase(),
            text: (target.textContent || '').slice(0, 100),
            className: target.className || '',
            id: target.id || '',
          },
        },
        '*' // В dev режиме разрешаем любые источники
      );
    }

    // Визуально выделяем выбранный элемент
    updateOverlay(target);
  }

  // Обработчик выхода мыши за пределы фрейма
  function handleMouseLeave(e) {
    // Проверяем, вышел ли курсор за границы фрейма
    // relatedTarget может быть null, если курсор вышел за пределы окна
    if (!e.relatedTarget || (e.relatedTarget && !document.contains(e.relatedTarget))) {
      // Скрываем overlay при выходе курсора за границы фрейма
      isCursorInsideFrame = false;
      if (overlay) {
        overlay.style.display = 'none';
      }
      hoveredElement = null;
    }
  }

  // Обработчик прокрутки для обновления overlay
  function handleScroll() {
    // Обновляем overlay только если курсор внутри фрейма
    if (!isCursorInsideFrame) {
      return;
    }
    if (selectedElement) {
      updateOverlay(selectedElement);
    } else if (hoveredElement) {
      updateOverlay(hoveredElement);
    }
  }

  // Включение/выключение режима выделения
  function setEnabled(enabled) {
    // Если состояние не изменилось, ничего не делаем
    if (isEnabled === enabled && handlersAttached === enabled) {
      return;
    }

    isEnabled = enabled;

    if (enabled) {
      // Добавляем обработчики только если они еще не добавлены
      if (!handlersAttached) {
        initOverlay();
        document.body.style.cursor = 'crosshair';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('click', handleClick, true);
        document.addEventListener('mouseleave', handleMouseLeave);
        window.addEventListener('scroll', handleScroll, true);
        handlersAttached = true;
      }
    } else {
      // Удаляем обработчики только если они были добавлены
      if (handlersAttached) {
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('click', handleClick, true);
        document.removeEventListener('mouseleave', handleMouseLeave);
        window.removeEventListener('scroll', handleScroll, true);
        handlersAttached = false;
      }
      if (overlay) {
        overlay.style.display = 'none';
      }
      // Очищаем выделенные элементы при отключении
      hoveredElement = null;
      selectedElement = null;
    }
  }

  // Обработчик сообщений от родительского окна
  function handleMessage(event) {
    // Логируем все входящие сообщения для отладки
    console.log('[host-ai-scripts] Received message:', event.data, 'from origin:', event.origin);

    if (event.data && event.data.type === 'toggle-selector') {
      console.log('[host-ai-scripts] Toggle selector message received, enabled:', event.data.enabled);
      setEnabled(event.data.enabled === true);
    }

    if (event.data && event.data.type === 'request-current-path') {
      // Отправляем текущий путь по запросу
      sendCurrentPath();
    }
  }

  // Обработчик изменения размера окна
  function handleResize() {
    if (isCursorInsideFrame) {
      if (selectedElement) {
        updateOverlay(selectedElement);
      } else if (hoveredElement) {
        updateOverlay(hoveredElement);
      }
    }
    // Обновляем последний известный размер
    lastViewportSize.width = window.innerWidth;
    lastViewportSize.height = window.innerHeight;
  }

  // Функция для получения текущего пути страницы (без параметра develop_mode)
  function getCurrentPath() {
    try {
      const location = window.location;
      let pathname = location.pathname;
      let search = location.search;
      let hash = location.hash;

      if (search) {
        const params = new URLSearchParams(search);
        params.delete('develop_mode');
        params.delete('targetWidth');
        params.delete('asset_v');
        params.delete('_b');
        search = params.toString() ? '?' + params.toString() : '';
      }

      return pathname + search + hash;
    } catch (e) {
      console.warn('Failed to get current path:', e);
      return null;
    }
  }

  // Функция для отправки текущего URL родительскому окну
  function sendCurrentPath() {
    if (window.parent && window.parent !== window.self) {
      const currentPath = getCurrentPath();
      if (currentPath) {
        window.parent.postMessage(
          {
            type: 'iframe-path-changed',
            path: currentPath,
          },
          '*'
        );
      }
    }
  }

  // Инициализация после загрузки DOM
  function init() {
    // Инициализируем размер viewport
    lastViewportSize.width = window.innerWidth;
    lastViewportSize.height = window.innerHeight;

    // Слушаем изменения размера окна
    window.addEventListener('resize', handleResize);

    // Отслеживаем изменения URL через History API
    // Перехватываем pushState и replaceState
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
      originalPushState.apply(history, arguments);
      sendCurrentPath();
      // При навигации переинициализируем обработчики, если они были отключены
      if (isEnabled && !handlersAttached) {
        setEnabled(true);
      }
    };

    history.replaceState = function () {
      originalReplaceState.apply(history, arguments);
      sendCurrentPath();
      // При навигации переинициализируем обработчики, если они были отключены
      if (isEnabled && !handlersAttached) {
        setEnabled(true);
      }
    };

    // Отслеживаем событие popstate (навигация назад/вперед)
    window.addEventListener('popstate', function () {
      sendCurrentPath();
      // При навигации переинициализируем обработчики, если они были отключены
      if (isEnabled && !handlersAttached) {
        setEnabled(true);
      }
    });

    // Отправляем текущий путь при инициализации
    sendCurrentPath();

    // // Запускаем интервал проверки viewport
    // startViewportCheckInterval();

    // Уведомляем родительское окно о готовности
    if (window.parent && window.parent !== window.self) {
      window.parent.postMessage(
        {
          type: 'selector-ready',
        },
        '*'
      );
    }
  }

  // Регистрируем обработчик сообщений СРАЗУ, до инициализации
  // чтобы он мог принимать сообщения в любой момент
  window.addEventListener('message', handleMessage);

  // Запускаем инициализацию после загрузки DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM уже загружен
    init();
  }

  window.addEventListener('load', function () {
    sendCurrentPath();
    // Уведомляем родительское окно о готовности после полной загрузки
    // (на случай, если это была перезагрузка страницы внутри iframe)
    if (window.parent && window.parent !== window.self) {
      window.parent.postMessage(
        {
          type: 'selector-ready',
        },
        '*'
      );
    }
  });
})();

