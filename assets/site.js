(function () {
  "use strict";

  var root = document.documentElement;
  var lang = function () { return root.dataset.lang === "en" ? "en" : "ko"; };

  // ── 언어 전환 ────────────────────────────
  var toggle = document.getElementById("lang-toggle");
  toggle.addEventListener("click", function () {
    var next = lang() === "ko" ? "en" : "ko";
    root.dataset.lang = next;
    root.lang = next;
    try { localStorage.setItem("ml-lang", next); } catch (e) {}
    try {
      var u = new URL(location.href);
      if (u.searchParams.has("lang")) { u.searchParams.delete("lang"); history.replaceState(null, "", u.pathname + u.search + u.hash); }
    } catch (e) {}
    relabel();
    say(lastMsg);
  });

  var LABELS = {
    nav: { ko: "주 메뉴", en: "Main" },
    toggle: { ko: "Switch to English", en: "한국어로 보기" },
    board: { ko: "타일 보드", en: "Tile board" },
    tray: { ko: "보관함", en: "Tray" }
  };

  // ── 3매치 보드 ───────────────────────────
  var KINDS = {
    readmon: { shape: "sh-circle", name: "Readmon" },
    ordo: { shape: "sh-diamond", name: "Ordo" },
    dejavu: { shape: "sh-triangle", name: "Dejavu" },
    tile: { shape: "sh-square", name: "Triple Tile" }
  };
  // 아래층 8칸, 가운데층 3칸, 꼭대기 1칸 — 위에 덮인 타일은 못 집는다
  var SPOTS = [
    [0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1],
    [0, 1, 1], [1, 1, 1], [2, 1, 1], [3, 1, 1],
    [0.5, 0.5, 2], [1.5, 0.5, 2], [2.5, 0.5, 2],
    [1.5, 0, 3]
  ];
  var TRAY_SIZE = 7;
  var MSG = {
    start: { ko: "위에 놓인 타일부터 집을 수 있어요.", en: "Pick tiles from the top of the pile." },
    match: { ko: "{n} 셋 맞춤!", en: "Three {n}s!" },
    win: { ko: "다 맞췄어요! 진짜 앱들은 아래에 있어요.", en: "All cleared! The real apps are below." },
    lose: { ko: "보관함이 꽉 찼어요. 다시 섞어 볼까요?", en: "The tray is full. Shuffle and try again?" }
  };

  var board = document.getElementById("board");
  var trayEl = document.getElementById("tray");
  var statusEl = document.getElementById("play-status");
  var play = board.closest(".play");
  var tiles = [], tray = [], busy = false, over = false, lastMsg = null, timers = [];

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  function tileName(kind) {
    var n = KINDS[kind].name;
    return lang() === "ko" ? n + " 타일" : n + " tile";
  }

  function shapeEl(kind) {
    var i = document.createElement("i");
    i.className = "sh " + KINDS[kind].shape;
    i.setAttribute("aria-hidden", "true");
    return i;
  }

  function say(m) {
    lastMsg = m;
    if (!m) { statusEl.textContent = ""; return; }
    statusEl.textContent = MSG[m.key][lang()].replace("{n}", m.name || "");
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function overlaps(a, b) {
    return Math.abs(a.x - b.x) < 0.89 && Math.abs(a.y - b.y) < 0.89;
  }

  function isBlocked(t) {
    return tiles.some(function (o) { return o.alive && o !== t && o.z > t.z && overlaps(o, t); });
  }

  function relabel() {
    var l = lang();
    document.getElementById("nav").setAttribute("aria-label", LABELS.nav[l]);
    toggle.setAttribute("aria-label", LABELS.toggle[l]);
    toggle.setAttribute("lang", l === "ko" ? "en" : "ko");
    board.setAttribute("aria-label", LABELS.board[l]);
    trayEl.setAttribute("aria-label", LABELS.tray[l]);
    tiles.forEach(function (t) { if (t.alive) t.el.setAttribute("aria-label", tileName(t.kind)); });
    trayEl.querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-label", tileName(c.dataset.kind)); });
  }

  function refreshBlocked() {
    tiles.forEach(function (t) {
      if (!t.alive) return;
      var b = over || isBlocked(t);
      t.el.setAttribute("aria-disabled", b ? "true" : "false");
      t.el.tabIndex = b ? -1 : 0;
    });
  }

  function renderTray(newIndex) {
    trayEl.textContent = "";
    var chipNew = null;
    for (var i = 0; i < TRAY_SIZE; i++) {
      var slot = document.createElement("div");
      slot.className = "slot";
      slot.setAttribute("role", "listitem");
      if (tray[i]) {
        var chip = document.createElement("div");
        chip.className = "chip";
        chip.dataset.kind = tray[i];
        chip.setAttribute("role", "img");
        chip.setAttribute("aria-label", tileName(tray[i]));
        chip.appendChild(shapeEl(tray[i]));
        slot.appendChild(chip);
        if (i === newIndex) chipNew = chip;
      }
      trayEl.appendChild(slot);
    }
    return chipNew;
  }

  // 사람처럼 둔다: 보관함에 이미 있는 모양을 먼저, 없으면 아무거나
  function simulate(kinds) {
    var ts = SPOTS.map(function (s, i) { return { x: s[0], y: s[1], z: s[2], kind: kinds[i], alive: true }; });
    var held = {}, count = 0;
    for (var left = ts.length; left > 0; left--) {
      var free = ts.filter(function (t) {
        return t.alive && !ts.some(function (o) { return o.alive && o.z > t.z && overlaps(o, t); });
      });
      var pref = free.filter(function (t) { return held[t.kind]; });
      var pool = pref.length ? pref : free;
      var t = pool[Math.floor(Math.random() * pool.length)];
      t.alive = false;
      held[t.kind] = (held[t.kind] || 0) + 1;
      count++;
      if (held[t.kind] === 3) { held[t.kind] = 0; count -= 3; }
      if (count >= TRAY_SIZE) return false;
    }
    return true;
  }

  // 한눈에 보는 놀잇감이라 대부분 이기는 판만 낸다
  function goodDeal() {
    var base = Object.keys(KINDS).flatMap(function (k) { return [k, k, k]; });
    var best = null, bestWins = -1;
    for (var n = 0; n < 300; n++) {
      var kinds = shuffle(base.slice()), wins = 0;
      for (var r = 0; r < 20; r++) if (simulate(kinds)) wins++;
      if (wins > bestWins) { best = kinds; bestWins = wins; }
      if (wins >= 19) break;
    }
    return best;
  }

  function deal() {
    var kinds = goodDeal();
    // 앞 판의 대기 중 타이머가 새 판 상태를 덮지 않게 걷는다
    timers.forEach(clearTimeout);
    timers = [];
    busy = false;
    over = false;
    board.textContent = "";
    play.classList.remove("won");
    tiles = SPOTS.map(function (s, i) {
      var el = document.createElement("button");
      el.type = "button";
      el.className = "tile drop";
      el.style.setProperty("--x", s[0]);
      el.style.setProperty("--y", s[1]);
      el.style.setProperty("--z", s[2]);
      el.style.setProperty("--r", (Math.random() * 6 - 3).toFixed(1) + "deg");
      el.style.setProperty("--d", (s[2] * 140 + i * 35) + "ms");
      el.appendChild(shapeEl(kinds[i]));
      var t = { x: s[0], y: s[1], z: s[2], kind: kinds[i], el: el, alive: true };
      el.addEventListener("click", function () { pick(t); });
      el.addEventListener("animationend", function () { el.classList.remove("drop"); }, { once: true });
      board.appendChild(el);
      return t;
    });
    tray = [];
    renderTray(-1);
    refreshBlocked();
    relabel();
    say({ key: "start" });
  }

  function pick(t) {
    if (busy || over || !t.alive || isBlocked(t) || tray.length >= TRAY_SIZE) return;
    busy = true;
    var from = t.el.getBoundingClientRect();
    t.alive = false;
    t.el.remove();
    refreshBlocked();

    // 같은 모양 옆에 끼워 넣는다
    var at = tray.lastIndexOf(t.kind);
    at = at === -1 ? tray.length : at + 1;
    tray.splice(at, 0, t.kind);
    var chip = renderTray(at);

    var to = chip.getBoundingClientRect();
    chip.style.transform = "translate(" + (from.left - to.left) + "px," + (from.top - to.top) + "px) scale(" + (from.width / to.width) + ")";
    chip.getBoundingClientRect();
    chip.style.transition = "transform .42s cubic-bezier(0.22, 1, 0.36, 1)";
    chip.style.transform = "";

    later(function () {
      var same = tray.filter(function (k) { return k === t.kind; }).length;
      if (same >= 3) {
        trayEl.querySelectorAll('.chip[data-kind="' + t.kind + '"]').forEach(function (c) { c.classList.add("pop"); });
        later(function () {
          tray = tray.filter(function (k) { return k !== t.kind; });
          renderTray(-1);
          busy = false;
          if (!tiles.some(function (o) { return o.alive; }) && tray.length === 0) {
            play.classList.add("won");
            say({ key: "win" });
          } else {
            say({ key: "match", name: KINDS[t.kind].name });
          }
        }, 380);
      } else {
        busy = false;
        if (tray.length >= TRAY_SIZE) {
          over = true;
          refreshBlocked();
          say({ key: "lose" });
        }
      }
    }, 430);
  }

  document.getElementById("play-reset").addEventListener("click", deal);
  deal();

  // ── 스크롤 등장 ──────────────────────────
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".proj, .tenets li, .contact").forEach(function (el, i) {
      el.classList.add("reveal");
      el.style.transitionDelay = (i % 3) * 70 + "ms";
      io.observe(el);
    });
  }
})();
