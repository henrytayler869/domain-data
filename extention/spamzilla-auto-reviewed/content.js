// content.js — logic tu dong + bang dieu khien noi tren trang SpamZilla.
(function () {
  "use strict";
  if (window.__SZ_AUTO_REVIEWED__) return;
  window.__SZ_AUTO_REVIEWED__ = true;

  // ---------- CAU HINH SELECTOR (theo cau truc SpamZilla / Kartik GridView) ----------
  const SEL = {
    selectAll: 'input.select-on-check-all, th input[name="selection_all"]',
    rowChk:    'input.kv-row-checkbox, td.kv-row-select input[type="checkbox"], input[name="selection[]"]',
    reviewedBtn: 'a.reviewed-button',
    next:      'ul.pagination li.next > a',
    nextLi:    'ul.pagination li.next',
    first:     'ul.pagination li.first > a',
    firstLi:   'ul.pagination li.first',
    prev:      'ul.pagination li.prev > a, ul.pagination li.previous > a',
    summary:   '.summary',
    grid:      '#expired-domains',
    domainCell: 'td[data-col-seq="1"]',  // o chua ten domain (ngay sau checkbox)
    // Dropdown "Saved Filter" cua SpamZilla: <select name="quick-filters">
    filterSelect: 'select[name="quick-filters"], select[name*="filter" i], select[id*="filter" i], select[name*="saved" i]'
  };

  const STORE_KEY = "sz_collected_domains";

  // ---------- TRANG THAI ----------
  const state = {
    running: false,
    processed: 0,        // so lan bam Reviewed
    domainsDone: 0,      // tong so domain da review (uoc luong)
    delay: 1200,         // ms nghi giua moi vong
    maxBatches: 0,       // 0 = khong gioi han
    seen: new Set(),     // chu ky cac batch da xu ly (chong lap vo han)
    collected: new Set() // TOAN BO domain da gom (qua moi trang / moi filter) -> luu TXT
  };

  // ---------- HELPER ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const qsa = (s) => Array.from(document.querySelectorAll(s));
  const qs  = (s) => document.querySelector(s);

  function rowCheckboxes() { return qsa(SEL.rowChk); }
  function keySig() { return rowCheckboxes().map(c => c.value).join(","); }
  function summaryText() {
    const s = qs(SEL.summary);
    return s ? s.textContent.trim() : "";
  }
  function setAuto(on) {
    // bao cho inject.js (MAIN world) biet de tu dong dong confirm/alert
    window.dispatchEvent(new CustomEvent("SZ_AUTO_SET", { detail: !!on }));
  }

  // Cho toi khi mang "ranh" (inject.js phat SZ_NET_IDLE) hoac het gio.
  // Dung sau khi bam Reviewed de chac chan request da luu xong moi truy van lai trang.
  function waitNetworkIdle(timeout = 6000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (done) return; done = true; window.removeEventListener("SZ_NET_IDLE", onIdle); clearTimeout(t); resolve(ok); };
      const onIdle = () => finish(true);
      const t = setTimeout(() => finish(false), timeout);
      window.addEventListener("SZ_NET_IDLE", onIdle);
    });
  }

  // Chuan hoa domain -> chong trung: lowercase, tach dung token domain (bo DR/khoang
  // trang/xuong dong thua), bo "www." va dau "." cuoi. Tra "" neu khong phai domain.
  function normalizeDomain(raw) {
    const s = String(raw || "").toLowerCase().replace(/^https?:\/\//, "");
    const m = s.match(/[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+/);   // token domain dau tien
    if (!m) return "";
    return m[0].replace(/^www\./, "").replace(/\.$/, "");
  }

  // Lay ten domain (da chuan hoa, dedupe trong trang) cua tung dong tren trang hien tai
  function pageDomains(onlyChecked) {
    const seen = new Set();
    const out = [];
    rowCheckboxes().forEach(chk => {
      if (onlyChecked && !chk.checked) return;
      const tr = chk.closest("tr");
      if (!tr) return;
      let cell = tr.querySelector(SEL.domainCell);
      if (!cell) {                                  // du phong: o ngay sau o checkbox
        const chkTd = chk.closest("td");
        cell = chkTd ? chkTd.nextElementSibling : null;
      }
      if (!cell) return;
      const a = cell.querySelector("a");            // uu tien text trong <a> (ten domain)
      const d = normalizeDomain((a && a.textContent) || cell.textContent);
      if (d && !seen.has(d)) { seen.add(d); out.push(d); }
    });
    return out;
  }

  // ---------- BO NHO DOMAIN (persist qua reload / doi filter) ----------
  function persistCollected() {
    try { chrome.storage.local.set({ [STORE_KEY]: Array.from(state.collected) }); } catch (e) {}
  }
  function loadCollected() {
    try {
      chrome.storage.local.get(STORE_KEY, (r) => {
        const raw = (r && r[STORE_KEY]) || [];
        raw.forEach(d => {
          const n = normalizeDomain(d);            // chuan hoa + dedupe ca du lieu cu
          if (n) state.collected.add(n);
        });
        if (state.collected.size !== raw.length) persistCollected();   // co trung/rac -> ghi lai ban da lam sach
        refreshUI();
      });
    } catch (e) {}
  }
  function clearCollected() {
    if (state.collected.size && !confirm("Xoa " + state.collected.size + " domain trong bo nho?")) return;
    state.collected.clear();
    try { chrome.storage.local.remove(STORE_KEY); } catch (e) {}
    refreshUI();
    setStatus("Da xoa bo nho domain.", "warn");
  }
  // Gom domain trang hien tai vao bo nho. Tra ve so domain MOI them.
  function collectCurrentPage() {
    const before = state.collected.size;
    pageDomains(false).forEach(d => state.collected.add(d));
    const added = state.collected.size - before;
    if (added) persistCollected();
    return added;
  }
  function downloadTxt() {
    const list = Array.from(state.collected);
    if (!list.length) { setStatus("Chua co domain nao trong bo nho.", "warn"); return; }
    const blob = new Blob([list.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const ts = "" + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) +
               "_" + p(now.getHours()) + p(now.getMinutes());
    const a = document.createElement("a");
    a.href = url;
    a.download = "spamzilla_domains_" + ts + ".txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setStatus("Da luu " + list.length + " domain ra file .txt", "done");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) {}
      ta.remove();
      return ok;
    }
  }

  async function copyDomains() {
    const list = pageDomains(false);   // toan bo domain trong trang
    if (list.length === 0) { setStatus("Khong tim thay domain nao trong trang.", "warn"); return; }
    const ok = await copyText(list.join("\n"));
    setStatus((ok ? "Da copy " : "Copy that bai (") + list.length +
              (ok ? " domain vao clipboard." : " domain)."), ok ? "done" : "warn");
  }

  // Tich "chon tat ca". Tra ve so domain duoc tich.
  async function selectAll() {
    const rows = rowCheckboxes();
    if (rows.length === 0) return 0;

    const sa = qs(SEL.selectAll);
    if (sa) {
      if (!sa.checked) sa.click();         // 1 click -> Kartik tich het + bat nut
      await sleep(150);
    }

    let checked = rowCheckboxes().filter(c => c.checked).length;
    if (checked < rows.length) {
      rows.forEach(c => {
        if (!c.checked) {
          c.checked = true;
          c.dispatchEvent(new Event("click",  { bubbles: true }));
          c.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await sleep(120);
      checked = rowCheckboxes().filter(c => c.checked).length;
    }
    return checked;
  }

  async function waitReviewedEnabled(timeout = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const btn = qs(SEL.reviewedBtn);
      if (btn && !btn.classList.contains("disabled")) return btn;
      await sleep(120);
    }
    const btn = qs(SEL.reviewedBtn);
    if (btn) {
      btn.classList.remove("disabled");
      btn.removeAttribute("disabled");
    }
    return btn;
  }

  function clickReviewed(btn) {
    btn.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true, view: window
    }));
  }

  async function waitGridUpdate(prevSig, timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const rows = rowCheckboxes();
      if (rows.length === 0) return { empty: true };
      if (keySig() !== prevSig) return { changed: true };
      await sleep(250);
    }
    return { timeout: true };
  }

  async function goNextPage() {
    const li = qs(SEL.nextLi);
    const a  = qs(SEL.next);
    if (!a || (li && li.classList.contains("disabled"))) return false;
    const prev = keySig();
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    const res = await waitGridUpdate(prev, 15000);
    return !res.timeout;
  }

  // Ve TRANG 1 (pjax fetch lai) — dung de re-query sau khi Reviewed (domain reviewed bi loai).
  async function goFirstPage() {
    const firstLi = qs(SEL.firstLi);
    let link = (firstLi && firstLi.classList.contains("disabled")) ? null : qs(SEL.first);
    if (!link) link = qs(SEL.prev);                                  // du phong: nut Prev (tu trang 2 -> 1)
    if (!link) link = qsa("ul.pagination li a").find(a => a.textContent.trim() === "1");
    if (!link) return false;
    const prev = keySig();
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    const res = await waitGridUpdate(prev, 15000);
    return !res.timeout;
  }

  // ---------- SAVED FILTER (duyet qua tung filter) ----------
  function findSavedFilterControl() {
    // 1) Uu tien CHINH XAC select quick-filters cua SpamZilla (tranh bat nham
    //    cac select khac nhu loc niche "Adult/Gambling...").
    const exact = qs('select[name="quick-filters"]');
    if (exact && exact.options && exact.options.length > 1) return exact;
    // 2) Du phong: select co ten/id lien quan "filter/saved", uu tien cai NHIEU option nhat.
    const cands = qsa(SEL.filterSelect).filter(s => s.options && s.options.length > 1);
    if (cands.length) {
      cands.sort((a, b) => b.options.length - a.options.length);
      return cands[0];
    }
    const any = qsa("select").find(s => s.options && s.options.length > 1);
    return any || null;
  }
  function filterOptions(ctrl) {
    return Array.from(ctrl.options)
      .filter(o => o.value !== "" && !/^\s*(--|chọn|chon|select|all|tất cả|tat ca)/i.test(o.textContent))
      .map(o => ({ label: o.textContent.trim(), value: o.value }));
  }
  async function applyFilter(ctrl, opt) {
    const prev = keySig();
    ctrl.value = opt.value;                                  // cap nhat hien thi dropdown
    // Nho inject.js (MAIN world) goi dung handler SpamZilla: $(sel).val(v).trigger('change')
    window.dispatchEvent(new CustomEvent("SZ_APPLY_FILTER", { detail: { value: opt.value } }));
    ctrl.dispatchEvent(new Event("change", { bubbles: true }));   // du phong
    await waitNetworkIdle(8000);                             // cho request filter xong
    const res = await waitGridUpdate(prev, 20000);           // cho grid nap lai (PJAX)
    return !res.timeout;                                     // true = luoi da doi (filter da ap dung)
  }
  // In ung vien filter ra Console de dev chot selector neu auto-detect truot.
  function logFilterCandidates() {
    const selects = qsa("select").map(s => ({
      id: s.id, name: s.name, cls: s.className,
      options: Array.from(s.options).slice(0, 40).map(o => o.textContent.trim())
    }));
    const toggles = qsa("button, a, [data-toggle='dropdown'], .dropdown-toggle")
      .map(b => (b.textContent || "").trim())
      .filter(t => t && /filter|saved|bộ lọc|bo loc/i.test(t)).slice(0, 30);
    console.log("%c[SZ] <select> candidates:", "color:#4dabf7", selects);
    console.log("%c[SZ] toggles co chu filter:", "color:#4dabf7", toggles);
    setStatus("Da log ung vien filter ra Console (F12 → Console). Gui log cho dev.", "done");
  }

  // ---------- VONG LAP REVIEW 1 FILTER (tai su dung) ----------
  // Lap: gom domain -> chon tat ca -> Reviewed -> cho grid -> sang trang.
  // Ket thuc khi het domain / khong sang duoc trang. KHONG dung state.running lifecycle.
  // Filter co set "loai tru domain da reviewed": KHONG di tien len (se bi sot do domain
  // con lai don ve trang 1). Cach dung: review TRANG 1 -> re-query trang 1 (next roi first,
  // pjax fetch lai, reviewed da bi loai) -> 25 domain moi don len -> lap toi khi rong.
  async function reviewCurrentFilter() {
    let lastSig = null;
    while (state.running) {
      const rows = rowCheckboxes();
      if (rows.length === 0) { setStatus("Danh sach trong — filter nay xong.", "done"); return; }

      const sig = keySig();
      if (sig === lastSig) {
        setStatus("Trang 1 khong doi -> da het (hoac Reviewed chua kip luu: tang 'Nghi ms').", "done");
        return;
      }
      lastSig = sig;

      const added = collectCurrentPage();            // GOM domain truoc khi review
      refreshUI();
      setStatus("Gom +" + added + " (tong " + state.collected.size + ") · review trang 1...", "run");

      const picked = await selectAll();
      if (picked === 0) { setStatus("Khong tich duoc domain nao — dung.", "warn"); return; }

      const btn = await waitReviewedEnabled(4000);
      if (!btn) { setStatus("Khong tim thay nut Reviewed — dung.", "warn"); return; }

      clickReviewed(btn);
      state.processed += 1;
      state.domainsDone += picked;
      refreshUI();
      setStatus("Da Reviewed " + picked + " domain · cho luu xong...", "run");

      // Cho request Reviewed luu XONG (khong co auto-refresh) roi moi truy van lai.
      await waitNetworkIdle(7000);
      await sleep(Math.max(300, state.delay));

      // RE-QUERY trang 1: next -> first. Neu chi con 1 trang (next fail) thi thoi:
      // vong sau doc lai DOM cu, sig == lastSig -> ket thuc (domain da duoc Reviewed).
      const moved = await goNextPage();
      if (moved) await goFirstPage();

      if (state.maxBatches > 0 && state.processed >= state.maxBatches) {
        setStatus("Da dat gioi han " + state.maxBatches + " lan — dung.", "done");
        state.running = false;
        return;
      }
    }
  }

  // Chay 1 filter hien tai (nut "Bat dau")
  async function run() {
    state.running = true;
    setAuto(true);
    refreshUI();
    try {
      await reviewCurrentFilter();
    } catch (err) {
      console.error("[SZ Auto]", err);
      setStatus("Loi: " + (err && err.message ? err.message : err), "warn");
    } finally {
      state.running = false;
      setAuto(false);
      refreshUI();
    }
  }

  // Duyet TAT CA saved filter lan luot (nut "Duyet tat ca filter")
  async function runAllFilters() {
    const ctrl = findSavedFilterControl();
    if (!ctrl) {
      setStatus("Khong thay dropdown filter. Bam '🔎 Log filter' roi gui log; hoac chay tung filter thu cong.", "warn");
      logFilterCandidates();
      return;
    }
    const opts = filterOptions(ctrl);
    if (!opts.length) { setStatus("Dropdown filter rong / khong doc duoc option.", "warn"); return; }

    state.running = true;
    setAuto(true);
    refreshUI();
    try {
      for (let i = 0; i < opts.length; i++) {
        if (!state.running) break;
        const o = opts[i];
        setStatus("→ Filter " + (i + 1) + "/" + opts.length + ": " + o.label, "run");
        const applied = await applyFilter(ctrl, o);
        if (!applied) {
          setStatus("Filter '" + o.label + "' khong doi duoc luoi — bo qua (doi filter co the reload trang?).", "warn");
          await sleep(500);
          continue;
        }
        await sleep(600);
        await reviewCurrentFilter();
      }
      setStatus("Xong " + opts.length + " filter. Tong " + state.collected.size +
                " domain — bam '💾 Luu TXT'.", "done");
    } catch (err) {
      console.error("[SZ Auto]", err);
      setStatus("Loi: " + (err && err.message ? err.message : err), "warn");
    } finally {
      state.running = false;
      setAuto(false);
      refreshUI();
    }
  }

  function stop() {
    state.running = false;
    setAuto(false);
    setStatus("Da dung theo yeu cau.", "warn");
    refreshUI();
  }

  // ---------- GIAO DIEN (panel noi) ----------
  let elPanel, elStatus, elStart, elStop, elDelay, elMax, elCount, elCollected;

  function buildUI() {
    elPanel = document.createElement("div");
    elPanel.id = "sz-auto-panel";
    elPanel.innerHTML = `
      <div class="sz-head">
        <span class="sz-title">SpamZilla Auto Reviewed</span>
        <span class="sz-min" title="Thu gon">–</span>
      </div>
      <div class="sz-body">
        <div class="sz-row">
          <button id="sz-start" class="sz-btn sz-go">▶ Bat dau (filter nay)</button>
          <button id="sz-stop" class="sz-btn sz-stop" disabled>■ Dung</button>
        </div>
        <div class="sz-row">
          <button id="sz-all" class="sz-btn sz-all">⏩ Duyet TAT CA filter</button>
        </div>
        <div class="sz-row">
          <button id="sz-save" class="sz-btn sz-save">💾 Luu TXT</button>
          <button id="sz-copy" class="sz-btn sz-copy">⧉ Copy trang</button>
        </div>
        <div class="sz-row">
          <button id="sz-clear" class="sz-btn sz-clear">🗑 Xoa bo nho</button>
          <button id="sz-logf" class="sz-btn sz-logf">🔎 Log filter</button>
        </div>
        <div class="sz-row sz-cfg">
          <label>Nghi (ms)
            <input id="sz-delay" type="number" min="200" step="100" value="1200">
          </label>
          <label>Gioi han lan (0=∞)
            <input id="sz-max" type="number" min="0" step="1" value="0">
          </label>
        </div>
        <div id="sz-collected" class="sz-count">Bo nho: 0 domain</div>
        <div id="sz-count" class="sz-count">Da review: 0 lan · 0 domain</div>
        <div id="sz-status" class="sz-status sz-idle">San sang.</div>
      </div>
    `;
    document.body.appendChild(elPanel);

    const css = document.createElement("style");
    css.textContent = `
      #sz-auto-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;
        width:270px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        background:#1f2430;color:#e8edf4;border:1px solid #3a4150;border-radius:10px;
        box-shadow:0 8px 26px rgba(0,0,0,.4);overflow:hidden;font-size:13px}
      #sz-auto-panel .sz-head{display:flex;justify-content:space-between;align-items:center;
        padding:9px 12px;background:#161b24;cursor:default;user-select:none}
      #sz-auto-panel .sz-title{font-weight:600;font-size:13px;letter-spacing:.2px}
      #sz-auto-panel .sz-min{cursor:pointer;font-weight:700;padding:0 6px;opacity:.7}
      #sz-auto-panel .sz-min:hover{opacity:1}
      #sz-auto-panel .sz-body{padding:11px 12px;display:flex;flex-direction:column;gap:9px}
      #sz-auto-panel .sz-row{display:flex;gap:8px}
      #sz-auto-panel .sz-btn{flex:1;border:0;border-radius:7px;padding:8px 6px;font-size:12.5px;
        font-weight:600;cursor:pointer;color:#fff}
      #sz-auto-panel .sz-go{background:#2f9e44}
      #sz-auto-panel .sz-go:hover{background:#37b24d}
      #sz-auto-panel .sz-all{background:#7048e8}
      #sz-auto-panel .sz-all:hover{background:#845ef7}
      #sz-auto-panel .sz-stop{background:#495057}
      #sz-auto-panel .sz-stop:not([disabled]){background:#e03131}
      #sz-auto-panel .sz-stop:not([disabled]):hover{background:#f03e3e}
      #sz-auto-panel .sz-save{background:#0ca678}
      #sz-auto-panel .sz-save:hover{background:#12b886}
      #sz-auto-panel .sz-copy{background:#1971c2}
      #sz-auto-panel .sz-copy:hover{background:#1c7ed6}
      #sz-auto-panel .sz-clear{background:#5c5f66}
      #sz-auto-panel .sz-clear:hover{background:#6c6f76}
      #sz-auto-panel .sz-logf{background:#5c5f66}
      #sz-auto-panel .sz-logf:hover{background:#6c6f76}
      #sz-auto-panel .sz-btn[disabled]{opacity:.5;cursor:not-allowed}
      #sz-auto-panel .sz-cfg{gap:8px}
      #sz-auto-panel .sz-cfg label{flex:1;display:flex;flex-direction:column;gap:3px;
        font-size:11px;color:#aeb6c4}
      #sz-auto-panel .sz-cfg input{background:#11151c;border:1px solid #3a4150;color:#e8edf4;
        border-radius:6px;padding:5px 6px;font-size:12px;width:100%;box-sizing:border-box}
      #sz-auto-panel .sz-count{font-size:12px;color:#9aa4b2}
      #sz-auto-panel #sz-collected{color:#63e6be;font-weight:600}
      #sz-auto-panel .sz-status{font-size:12px;padding:7px 9px;border-radius:6px;line-height:1.4;
        word-break:break-word}
      #sz-auto-panel .sz-idle{background:#222a36;color:#aeb6c4}
      #sz-auto-panel .sz-run{background:#1c3b2e;color:#69db7c}
      #sz-auto-panel .sz-done{background:#1c2f3b;color:#74c0fc}
      #sz-auto-panel .sz-warn{background:#3b2420;color:#ffa94d}
      #sz-auto-panel.sz-collapsed .sz-body{display:none}
    `;
    document.head.appendChild(css);

    elStatus    = qs("#sz-status");
    elStart     = qs("#sz-start");
    elStop      = qs("#sz-stop");
    elDelay     = qs("#sz-delay");
    elMax       = qs("#sz-max");
    elCount     = qs("#sz-count");
    elCollected = qs("#sz-collected");

    function startSingle() {
      if (state.running) return;
      state.delay = Math.max(200, parseInt(elDelay.value, 10) || 1200);
      state.maxBatches = Math.max(0, parseInt(elMax.value, 10) || 0);
      state.seen.clear();
      run();
    }
    function startAll() {
      if (state.running) return;
      state.delay = Math.max(200, parseInt(elDelay.value, 10) || 1200);
      state.maxBatches = Math.max(0, parseInt(elMax.value, 10) || 0);
      state.seen.clear();
      runAllFilters();
    }

    elStart.addEventListener("click", startSingle);
    qs("#sz-all").addEventListener("click", startAll);
    elStop.addEventListener("click", stop);
    qs("#sz-save").addEventListener("click", downloadTxt);
    qs("#sz-copy").addEventListener("click", copyDomains);
    qs("#sz-clear").addEventListener("click", clearCollected);
    qs("#sz-logf").addEventListener("click", logFilterCandidates);
    elPanel.querySelector(".sz-min").addEventListener("click", () => {
      elPanel.classList.toggle("sz-collapsed");
    });

    loadCollected();   // khoi phuc bo nho domain da gom
  }

  function setStatus(msg, kind) {
    if (!elStatus) return;
    elStatus.textContent = msg;
    elStatus.className = "sz-status " + ({
      run: "sz-run", done: "sz-done", warn: "sz-warn"
    }[kind] || "sz-idle");
  }

  function refreshUI() {
    if (!elStart) return;
    const busy = state.running;
    elStart.disabled = busy;
    elStop.disabled  = !busy;
    elDelay.disabled = busy;
    elMax.disabled   = busy;
    qs("#sz-all").disabled = busy;
    elCount.textContent = "Da review: " + state.processed + " lan · " +
                          state.domainsDone + " domain";
    elCollected.textContent = "Bo nho: " + state.collected.size + " domain";
  }

  // Khoi tao
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildUI);
  } else {
    buildUI();
  }
})();
