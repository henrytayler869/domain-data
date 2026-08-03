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

  // ---- Tao & LUU 1 Saved Filter tu CSV (dat field trong #sz-filters form roi POST /filter/save/) ----
  // content.js (isolated world) khong goi duoc jQuery.serializeArray() + CSRF cua trang -> nho MAIN world lam.
  // Nhan payload JSON: { id, name, domains:[...] }. Tra ket qua qua "SZ_SAVE_FILTER_RESULT".
  window.addEventListener("SZ_SAVE_FILTER", function (e) {
    var payload;
    try { payload = JSON.parse(e && e.detail); } catch (err) { return; }
    var id = payload && payload.id;
    var name = (payload && payload.name) || "";
    var domains = (payload && payload.domains) || [];

    function reply(obj) {
      obj.id = id;
      window.dispatchEvent(new CustomEvent("SZ_SAVE_FILTER_RESULT", { detail: JSON.stringify(obj) }));
    }

    var $ = window.jQuery || window.$;
    if (!$) { reply({ ok: false, error: true, msg: "Trang chua nap jQuery." }); return; }

    try {
      var $form = $("#sz-filters form");
      if (!$form.length) { reply({ ok: false, error: true, msg: "Khong tim thay form #sz-filters." }); return; }

      // 1) Reset ve mac dinh (theo dung logic nut 'Reset Filter' cua SpamZilla, bo confirm + reload).
      $('input[name="quick_filter_id"]').val("");
      $('input[name="keyword_search"], input[name="keyword_search_xs"], input[name="Filter[keyword]"]').val("");
      $('#sz-filters select, #sz-filters input[type="number"], #sz-filters input[type="text"]').val("");
      $('#sz-filters input[type="checkbox"]').prop("checked", true);
      $('#sz-filters [name="Filter[google_index]"], '
        + '#sz-filters [name="Filter[processed_sz]"], '
        + '#sz-filters [name="Filter[expiry_period]"], '
        + '#sz-filters [name="Filter[remove_reviewed]"], '
        + '#sz-filters [name="Filter[remove_watchlist]"], '
        + '#sz-filters [name="Filter[has_gbp]"]').prop("checked", false);
      $('input[name="Filter[gbp_rating_from]"]').val(1);
      $('input[name="Filter[gbp_rating_to]"]').val(5);

      // 2) Ap dat cac tuy chon yeu cau.
      $('[name="Filter[sz_score_from]"]').val(0);   // SZ Score: Min 0
      $('[name="Filter[sz_score_to]"]').val("");    //           Max trong
      $('[name="Filter[sz_age_from]"]').val(3);     // SZ Age:   Min 3
      $('[name="Filter[sz_age_to]"]').val("");      //           Max trong
      $('[name="Filter[remove_reviewed]"]').prop("checked", true);   // Remove Reviewed: tick
      $('[name="Filter[include_domains]"]').val(domains.join(", "));  // Include Domains (<=20)

      // Domain Source: chi tick 'Expired Domains - Register Now!' + 'Pending Delete', bo het con lai.
      $('[name="Filter[domain_sources][]"]').prop("checked", false);
      $('[name="Filter[domain_sources][]"][value="expired"]').prop("checked", true);
      $('[name="Filter[domain_sources][]"][value="pending-delete"]').prop("checked", true);
      $('input[name="all_data_sources"]').prop("checked", false);

      // 3) Serialize form + POST /filter/save/ (giong het onSaveFilterFormSubmit cua trang).
      var data = $form.serializeArray();
      var params = {
        name: name,
        isDefault: 0,
        sendEmail: 0,
        selectedFilter: "",
        data: JSON.stringify(data)
      };
      // Them CSRF token (Yii) phong khi yii.js khong tu chen.
      var tokenMeta = document.querySelector('meta[name="csrf-token"]');
      var paramMeta = document.querySelector('meta[name="csrf-param"]');
      if (tokenMeta && paramMeta) {
        params[paramMeta.getAttribute("content")] = tokenMeta.getAttribute("content");
      }

      $.ajax({
        url: "/filter/save/",
        type: "POST",
        data: params,
        success: function (response) {
          if (response && response.error) {
            reply({ ok: false, error: true, msg: response.msg || "Server bao loi khi luu." });
          } else {
            reply({ ok: true, msg: (response && response.name) || name });
          }
        },
        error: function (xhr) {
          reply({ ok: false, error: true, msg: "HTTP " + (xhr && xhr.status) });
        }
      });
    } catch (err) {
      reply({ ok: false, error: true, msg: String((err && err.message) || err) });
    }
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
