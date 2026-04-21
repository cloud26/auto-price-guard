// 淘宝 mtop 响应拦截
// 同时覆盖三种可能的传输：
//   1) JSONP：<script src="...&callback=mtopjsonpN"> —— hook src 设置 + 回调赋值
//   2) XMLHttpRequest
//   3) fetch
// 所有命中 h5api.m.taobao.com / mtop.taobao.com 的响应，
// 以 {api, data, time, via} 形式写入 window.__tbMtopResponses
(function () {
  if (window.__tbHooked) return;
  window.__tbHooked = true;
  window.__tbMtopResponses = [];

  function isMtop(url) {
    return (
      typeof url === "string" &&
      (url.indexOf("h5api.m.taobao.com") !== -1 ||
        url.indexOf("mtop.taobao.com") !== -1 ||
        url.indexOf("acs.m.taobao.com") !== -1)
    );
  }

  function parseApi(url) {
    try {
      const u = new URL(url, location.href);
      const pathMatch = u.pathname.match(/\/h5\/([^/]+)\//);
      const api = u.searchParams.get("api") || (pathMatch && pathMatch[1]);
      const cb = u.searchParams.get("callback");
      return { api, cb };
    } catch (e) {
      return { api: null, cb: null };
    }
  }

  function push(entry) {
    try {
      window.__tbMtopResponses.push(entry);
    } catch (e) {}
  }

  // ─── 1) JSONP 回调拦截 ──────────────────────────────────────
  function installCallbackTrap(url) {
    if (!isMtop(url)) return;
    const { api, cb } = parseApi(url);
    if (!api || !cb) return;

    function wrap(fn) {
      const wrapped = function (data) {
        push({ api, data, time: Date.now(), via: "jsonp" });
        return fn.apply(this, arguments);
      };
      wrapped.__tbWrapped = true;
      return wrapped;
    }

    const existing = window[cb];
    if (typeof existing === "function") {
      if (!existing.__tbWrapped) window[cb] = wrap(existing);
      return;
    }

    // 还没定义 —— 拦截将来的赋值
    let stored;
    try {
      Object.defineProperty(window, cb, {
        configurable: true,
        get: function () {
          return stored;
        },
        set: function (fn) {
          stored = typeof fn === "function" && !fn.__tbWrapped ? wrap(fn) : fn;
        },
      });
    } catch (e) {}
  }

  try {
    const desc =
      Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src") ||
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, "src");
    if (desc && desc.set) {
      const origSet = desc.set;
      Object.defineProperty(HTMLScriptElement.prototype, "src", {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (v) {
          installCallbackTrap(v);
          return origSet.call(this, v);
        },
      });
    }
  } catch (e) {}

  const origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name === "src" && this.tagName === "SCRIPT") {
      installCallbackTrap(value);
    }
    return origSetAttr.apply(this, arguments);
  };

  // ─── 2) XMLHttpRequest ─────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__tbUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const url = this.__tbUrl || "";
    if (isMtop(url)) {
      const { api } = parseApi(url);
      this.addEventListener("load", function () {
        let data;
        try {
          data = JSON.parse(this.responseText);
        } catch (e) {
          data = this.responseText;
        }
        push({ api: api || url, data, time: Date.now(), via: "xhr" });
      });
    }
    return origSend.apply(this, arguments);
  };

  // ─── 3) fetch ──────────────────────────────────────────────
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function () {
      const url =
        typeof arguments[0] === "string"
          ? arguments[0]
          : (arguments[0] && arguments[0].url) || "";
      const p = origFetch.apply(this, arguments);
      if (isMtop(url)) {
        const { api } = parseApi(url);
        p.then(function (resp) {
          try {
            const clone = resp.clone();
            clone.text().then(function (text) {
              let data;
              try {
                data = JSON.parse(text);
              } catch (e) {
                data = text;
              }
              push({ api: api || url, data, time: Date.now(), via: "fetch" });
            });
          } catch (e) {}
        });
      }
      return p;
    };
  }
})();
