// inject.js — chay trong "MAIN world" (context cua trang).
// 1) Neu nut Reviewed bung confirm()/alert() lam treo vong lap tu dong -> tu cho qua khi dang chay.
// 2) Theo doi so request XHR/fetch dang bay -> phat su kien "SZ_NET_IDLE" khi mang ranh,
//    de content.js biet chac Reviewed da LUU XONG roi moi truy van lai trang.
// Content script bat/tat che do tu dong bang CustomEvent "SZ_AUTO_SET".
(function () {
  if (window.__SZ_INJECTED__) return;
  window.__SZ_INJECTED__ = true;

  // ---- (1) Tu dong dong confirm/alert khi dang chay ----
  var auto = false;
  window.addEventListener("SZ_AUTO_SET", function (e) {
    auto = !!(e && e.detail);
  });

  var _confirm = window.confirm;
  window.confirm = function (msg) {
    if (auto) return true;          // tu dong dong y khi dang chay
    return _confirm.call(window, msg);
  };

  var _alert = window.alert;
  window.alert = function (msg) {
    if (auto) return undefined;     // bo qua alert khi dang chay
    return _alert.call(window, msg);
  };

  // ---- Ap dung Saved Filter bang chinh jQuery cua trang (kich hoat dung handler SpamZilla) ----
  // content.js (isolated world) khong goi duoc handler jQuery cua trang -> nho MAIN world lam.
  window.addEventListener("SZ_APPLY_FILTER", function (e) {
    var val = e && e.detail ? e.detail.value : null;
    if (val == null) return;
    var sel = document.querySelector('select[name="quick-filters"]');
    if (!sel) return;
    sel.value = val;
    var jq = window.jQuery || window.$;
    if (jq) {
      try { jq(sel).val(val).trigger("change"); return; } catch (err) {}
    }
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // ---- (2) Dem request dang bay -> bao "mang ranh" ----
  var pending = 0;
  var idleTimer = null;
  function announce() {
    if (idleTimer) clearTimeout(idleTimer);
    if (pending <= 0) {
      // "ranh" = 250ms khong con request nao dang bay
      idleTimer = setTimeout(function () {
        window.dispatchEvent(new CustomEvent("SZ_NET_IDLE"));
      }, 250);
    }
  }

  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    this.addEventListener("loadend", function () {
      pending = Math.max(0, pending - 1);
      announce();
    });
    pending++;
    return _open.apply(this, arguments);
  };

  var _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = function () {
      pending++;
      return _fetch.apply(this, arguments).finally(function () {
        pending = Math.max(0, pending - 1);
        announce();
      });
    };
  }
})();
