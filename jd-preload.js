// 京东 API 响应拦截（preload 注入，确保在页面 JS 之前运行）
(function () {
  if (window.__jdApiHooked) return;
  window.__jdApiHooked = true;
  window.__jdApiResponses = [];

  function isJdApi(url) {
    return (
      typeof url === "string" &&
      (url.indexOf("api.m.jd.com") !== -1 ||
        url.indexOf("api.jd.com") !== -1)
    );
  }

  // fetch
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function () {
      const url =
        typeof arguments[0] === "string"
          ? arguments[0]
          : (arguments[0] && arguments[0].url) || "";
      const p = origFetch.apply(this, arguments);
      if (isJdApi(url)) {
        p.then(function (resp) {
          try {
            const clone = resp.clone();
            clone.text().then(function (text) {
              window.__jdApiResponses.push({ url, body: text, time: Date.now() });
            });
          } catch (e) {}
        });
      }
      return p;
    };
  }

  // XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__jdUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const url = this.__jdUrl || "";
    if (isJdApi(url)) {
      this.addEventListener("load", function () {
        try {
          window.__jdApiResponses.push({ url, body: this.responseText, time: Date.now() });
        } catch (e) {}
      });
    }
    return origSend.apply(this, arguments);
  };
})();
