(function () {
  "use strict";

  var TERMINAL_PRESETS = {
    NVDA: {
      price: "$208.19",
      pct: "+1.42%",
      pctClass: "up",
      tag: "CHIPS",
      tagDetail: "Policy tag: CHIPS — semiconductor manufacturing appropriations",
      alert: "LegisAlert",
      signal: "CHIPS Act appropriations advanced in committee markup",
      chain: "Congress.gov → Appropriations markup → Fab timeline → NVDA",
      confidence: 82,
    },
    LLY: {
      price: "$796.60",
      pct: "+1.09%",
      pctClass: "up",
      tag: "Drug bill",
      tagClass: "tag-amber",
      tagDetail: "Policy tag: Drug bill — Medicare negotiation revenue exposure",
      alert: "LegisAlert",
      signal: "Drug pricing bill advanced to Senate floor vote",
      chain: "Congress.gov → HR 3 advanced → Revenue risk → LLY repricing",
      confidence: 71,
    },
    AAPL: {
      price: "$228.60",
      pct: "-0.40%",
      pctClass: "down",
      tag: "Antitrust",
      tagClass: "tag-blue",
      tagDetail: "Policy tag: Antitrust — App Store services revenue scrutiny",
      alert: "RegAlert",
      signal: "DOJ antitrust review cited in supply chain filings",
      chain: "DOJ → App store probe → Services risk → AAPL",
      confidence: 54,
    },
    PLTR: {
      price: "$132.07",
      pct: "+4.18%",
      pctClass: "up",
      tag: "Contract",
      tagDetail: "Policy tag: Contract — DOD AI procurement evaluation",
      alert: "ProcAlert",
      signal: "DOD AI contract evaluation closing Friday",
      chain: "USASpending → RFP close → Award watch → PLTR",
      confidence: 48,
    },
  };

  var TICKER_ORDER = ["NVDA", "LLY", "AAPL", "PLTR"];

  var SOUND_PROFILES = {
    forensic: {
      label: "Forensic drone",
      tones: [55, 82.41, 110],
      waves: ["sine", "triangle", "sine"],
      filter: 520,
      lfo: 0.055,
      depth: 90,
    },
    market: {
      label: "Market silence",
      tones: [48, 64, 96, 128],
      waves: ["sine", "sine", "triangle", "sine"],
      filter: 430,
      lfo: 0.038,
      depth: 62,
    },
    legislative: {
      label: "Legislative static",
      tones: [61.74, 92.5, 123.47],
      waves: ["triangle", "sine", "triangle"],
      filter: 680,
      lfo: 0.08,
      depth: 120,
    },
    contract: {
      label: "Contract room",
      tones: [55, 73.42, 110, 146.83],
      waves: ["sine", "sawtooth", "triangle", "sine"],
      filter: 560,
      lfo: 0.032,
      depth: 74,
    },
    preopen: {
      label: "Pre-open tape",
      tones: [36.71, 55, 82.41, 110],
      waves: ["sine", "sine", "triangle", "sine"],
      filter: 610,
      lfo: 0.065,
      depth: 104,
    },
  };

  var BRIEFINGS = {
    "dod-mesh": {
      title: "DOD announces $4.2B tactical intel mesh contract award.",
      category: "Contract award",
      date: "May 29, 2026",
      crs: "CRS 8.4",
      ticker: "PLTR",
      source: "USASpending.gov → Defense Logistics Agency",
      summary: "The Department of Defense finalized a multi-year tactical intelligence mesh contract for edge-sensor telemetry and theater-level decision matrices.",
      impact: "This is treated as a high-signal paper-trade review: inspect the award lineage, validate source freshness, and test the PLTR thesis before any real capital decision.",
      sparkline: [22.1, 22.4, 22.25, 22.9, 23.4, 24.1, 24.8],
      color: "#C8FF00",
    },
    "semiconductor-export": {
      title: "Senate introduces semiconductor export restriction expansion.",
      category: "Legislative",
      date: "May 28, 2026",
      crs: "CRS 7.8",
      ticker: "TSM",
      source: "Congress.gov → Senate Foreign Relations Committee",
      summary: "A bipartisan coalition introduced a bill expanding export restrictions on sub-3nm EUV processing equipment and advanced wafer nodes.",
      impact: "The modeled vector pressures near-term regional revenue while increasing the importance of domestic fabrication subsidies and supply-chain exposure.",
      sparkline: [152.4, 151.1, 148.9, 149.2, 147.5, 144.1, 145.2],
      color: "#FF2B2B",
    },
    "faa-drone": {
      title: "FAA reauthorization moves to floor for drone delivery votes.",
      category: "Legislative",
      date: "May 27, 2026",
      crs: "CRS 5.2",
      ticker: "RTX",
      source: "Congress.gov → Senate Commerce Committee",
      summary: "The FAA Reauthorization Act cleared committee with amendments for beyond-visual-line-of-sight autonomous drone delivery frameworks.",
      impact: "This creates a moderate exposure watch for certified navigation, radar, and defense-adjacent autonomy suppliers.",
      sparkline: [95.1, 95.8, 96.4, 96.2, 97.1, 98.0, 98.4],
      color: "#FFA500",
    },
    "sec-custody": {
      title: "SEC proposes crypto custody amendments for institutional holders.",
      category: "Regulatory",
      date: "May 26, 2026",
      crs: "CRS 6.5",
      ticker: "COIN",
      source: "SEC.gov → Division of Investment Management",
      summary: "The SEC published proposed rule changes around qualified custody requirements for investment advisors managing digital assets.",
      impact: "The modeled impact favors established institutional custody providers while raising compliance costs for weaker custody infrastructure.",
      sparkline: [210.5, 215.2, 212.4, 218.9, 224.1, 228.4, 231.2],
      color: "#C8FF00",
    },
    "ai-procurement-transparency": {
      title: "Congress convenes hearings on AI defense procurement transparency.",
      category: "Legislative",
      date: "May 25, 2026",
      crs: "CRS 4.8",
      ticker: "PLTR",
      source: "Congress.gov → House Armed Services Committee",
      summary: "The House Armed Services Committee scheduled hearings reviewing software transparency guidelines and military AI testing protocols.",
      impact: "Scrutiny can slow contract timing, but certification requirements may reinforce vendors with combat-proven enterprise systems.",
      sparkline: [24.1, 23.9, 23.5, 23.8, 24.2, 24.5, 24.8],
      color: "#FFA500",
    },
    "ftc-defense": {
      title: "FTC launches investigation into defense sector mergers.",
      category: "Regulatory",
      date: "May 24, 2026",
      crs: "CRS 3.9",
      ticker: "LMT",
      source: "FTC.gov → Merger Division",
      summary: "The FTC initiated an antitrust inquiry into subsystem and propulsion supplier acquisitions by major prime contractors.",
      impact: "This is a risk flag for consolidation timelines, legal cost, and supplier integration assumptions inside defense theses.",
      sparkline: [462.1, 461.5, 458.2, 459.0, 454.1, 451.2, 448.9],
      color: "#FF2B2B",
    },
    "doe-nuclear": {
      title: "DOE allocates $1.2B for next-gen nuclear grid integration.",
      category: "Contract award",
      date: "May 23, 2026",
      crs: "CRS 7.2",
      ticker: "SMR",
      source: "Energy.gov → Office of Nuclear Energy",
      summary: "The Department of Energy announced funding support for commercial grid integration of small modular reactor facilities.",
      impact: "The signal validates advanced micro-fission timelines while still requiring a paper-trade thesis and milestone monitoring.",
      sparkline: [12.1, 12.4, 12.9, 13.5, 14.1, 14.8, 15.4],
      color: "#C8FF00",
    },
  };

  var BRIEFING_ORDER = ["dod-mesh", "semiconductor-export", "faa-drone", "sec-custody", "ai-procurement-transparency", "ftc-defense", "doe-nuclear"];

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  ready(function () {
    var root = document.documentElement;
    var hero = qs(".ts-hero");
    var video = qs(".ts-hero-video");
    var terminalCard = qs(".ts-terminal-card");
    var terminalRoot = qs("#hero-terminal");
    var chainEl = qs("#terminal-signal-chain");
    var updatedEl = qs("#terminal-updated");
    var nav = qs(".ts-nav");
    var menuBtn = qs("#ts-nav-menu-btn");
    var signalPanel = qs("#terminal-signal-panel");
    var signalLabel = qs("#terminal-signal-label");
    var signalHeadline = qs("#terminal-signal-headline");
    var tagDetailEl = qs("#terminal-tag-detail");
    var signalFreshness = qs("#terminal-signal-freshness");
    var confidenceText = qs("#terminal-confidence-text");
    var confidenceFill = qs("#terminal-confidence-fill");
    var cinematicVideoToggle = qs("#cinematic-video-toggle");
    var soundtrackToggle = qs("#soundtrack-toggle");
    var soundProfileToggle = qs("#sound-profile-toggle");
    var soundProfilePanel = qs("#sound-profile-panel");
    var soundProfileName = qs("#sound-profile-name");
    var soundNavStatus = qs("#sound-nav-status");
    var soundVolume = qs("#sound-volume");
    var soundVolumeValue = qs("#sound-volume-value");
    var alertTitle = qs("#cinema-alert-title");
    var briefingModal = qs("#briefing-modal");
    var briefingTitle = qs("#briefing-modal-title");
    var briefingCategory = qs("#briefing-category");
    var briefingCrs = qs("#briefing-crs");
    var briefingTicker = qs("#briefing-ticker");
    var briefingDate = qs("#briefing-date");
    var briefingSource = qs("#briefing-source");
    var briefingSummary = qs("#briefing-summary");
    var briefingImpact = qs("#briefing-impact");
    var briefingSparkline = qs("#briefing-sparkline");

    var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var isMobile = window.matchMedia("(max-width: 900px)").matches;
    var userPinnedTerminal = false;
    var activeTicker = "NVDA";
    var typeTimer = null;
    var lastFocusedBeforeBriefing = null;
    var activeBriefingIndex = 0;
    var soundtrackState = {
      playing: false,
      ctx: null,
      master: null,
      nodes: [],
      profile: "forensic",
      volume: 0.4,
    };

    /* ── Nav menu ── */
    if (menuBtn && nav) {
      menuBtn.addEventListener("click", function () {
        var open = nav.classList.toggle("ts-nav-open");
        menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      qsa(".ts-nav-links a", nav).forEach(function (a) {
        a.addEventListener("click", function () {
          nav.classList.remove("ts-nav-open");
          menuBtn.setAttribute("aria-expanded", "false");
        });
      });
    }

    if (nav && !prefersReducedMotion) {
      var onScrollNav = function () {
        nav.classList.toggle("is-scrolled", window.scrollY > 48);
      };
      onScrollNav();
      window.addEventListener("scroll", onScrollNav, { passive: true });
    }

    /* ── Hero video ── */
    if (video) {
      if (prefersReducedMotion) {
        video.pause();
        video.removeAttribute("autoplay");
      } else {
        var markReady = function () {
          root.classList.add("ts-video-ready");
        };
        if (video.readyState >= 2) markReady();
        else video.addEventListener("canplay", markReady, { once: true });
        video.addEventListener("error", function () {
          root.classList.remove("ts-video-ready");
        });
        document.addEventListener("visibilitychange", function () {
          if (document.hidden) video.pause();
          else video.play().catch(function () {});
        });
      }
    }

    /* ── Autoplay nudge: iOS/Safari can ignore the autoplay attribute, so
       force muted playback via JS and retry once on first user interaction ── */
    if (!prefersReducedMotion) {
      var nudgeAutoplayVideos = function () {
        if (document.body.classList.contains("ts-video-paused")) return;
        qsa(".ts-hero-video, .cinema-frame video").forEach(function (clip) {
          clip.muted = true;
          if (clip.paused) clip.play().catch(function () {});
        });
      };
      nudgeAutoplayVideos();
      var retryAutoplayOnce = function () {
        document.removeEventListener("touchstart", retryAutoplayOnce);
        document.removeEventListener("click", retryAutoplayOnce);
        nudgeAutoplayVideos();
      };
      document.addEventListener("touchstart", retryAutoplayOnce, { once: true, passive: true });
      document.addEventListener("click", retryAutoplayOnce, { once: true });
    }

    /* ── Cinematic media controls ── */
    function setCinematicVideo(enabled) {
      document.body.classList.toggle("ts-video-paused", !enabled);
      if (cinematicVideoToggle) {
        cinematicVideoToggle.classList.toggle("active", enabled);
        cinematicVideoToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
        cinematicVideoToggle.textContent = enabled ? "Cinematic video" : "Video paused";
      }
      qsa(".cinema-frame video").forEach(function (clip) {
        if (enabled) clip.play().catch(function () {});
        else clip.pause();
      });
      if (!video || !video.querySelector("source")) return;
      if (enabled) video.play().catch(function () {});
      else video.pause();
    }

    function updateSoundProfileUI() {
      var profile = SOUND_PROFILES[soundtrackState.profile] || SOUND_PROFILES.forensic;
      if (soundProfileName) soundProfileName.textContent = profile.label;
      qsa("[data-sound-profile]").forEach(function (button) {
        button.classList.toggle("active", button.getAttribute("data-sound-profile") === soundtrackState.profile);
      });
      if (soundVolume) soundVolume.value = String(Math.round(soundtrackState.volume * 100));
      if (soundVolumeValue) soundVolumeValue.textContent = Math.round(soundtrackState.volume * 100) + "%";
    }

    function setSoundVolume(value) {
      soundtrackState.volume = Math.max(0, Math.min(1, value));
      if (soundtrackState.master && soundtrackState.ctx && soundtrackState.playing) {
        try {
          var now = soundtrackState.ctx.currentTime;
          soundtrackState.master.gain.cancelScheduledValues(now);
          soundtrackState.master.gain.setTargetAtTime(soundtrackState.volume, now, 0.08);
        } catch (e) {}
      }
      updateSoundProfileUI();
    }

    function closeSoundtrack() {
      if (!soundtrackState.ctx) return;
      var ctx = soundtrackState.ctx;
      var master = soundtrackState.master;
      var nodes = soundtrackState.nodes.slice();
      try {
        var now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0.0001, now + 0.25);
      } catch (e) {}
      setTimeout(function () {
        nodes.forEach(function (node) {
          try { node.stop(); } catch (e) {}
          try { node.disconnect(); } catch (e) {}
        });
        try { ctx.close(); } catch (e) {}
      }, 320);
      soundtrackState.ctx = null;
      soundtrackState.master = null;
      soundtrackState.nodes = [];
    }

    function startSoundtrack() {
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return Promise.reject(new Error("AudioContext unavailable"));

      var profile = SOUND_PROFILES[soundtrackState.profile] || SOUND_PROFILES.forensic;
      var ctx = new AudioCtor();
      var master = ctx.createGain();
      var filter = ctx.createBiquadFilter();
      var compressor = ctx.createDynamicsCompressor();
      var lfo = ctx.createOscillator();
      var lfoGain = ctx.createGain();
      var tones = profile.tones.map(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = profile.waves[i] || "sine";
        osc.frequency.value = freq;
        gain.gain.value = i === 0 ? 0.044 : 0.022;
        osc.connect(gain);
        gain.connect(filter);
        osc.start();
        return osc;
      });

      filter.type = "lowpass";
      filter.frequency.value = profile.filter;
      filter.Q.value = 0.8;
      master.gain.value = 0.0001;
      compressor.threshold.value = -32;
      compressor.knee.value = 24;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.02;
      compressor.release.value = 0.45;

      lfo.frequency.value = profile.lfo;
      lfoGain.gain.value = profile.depth;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();

      filter.connect(compressor);
      compressor.connect(master);
      master.connect(ctx.destination);

      soundtrackState.ctx = ctx;
      soundtrackState.master = master;
      soundtrackState.nodes = tones.concat([lfo]);

      return ctx.resume().then(function () {
        var now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(0.0001, now);
        master.gain.linearRampToValueAtTime(soundtrackState.volume, now + 0.6);
      });
    }

    function setSoundProfile(name) {
      if (!SOUND_PROFILES[name]) return;
      var wasPlaying = soundtrackState.playing;
      soundtrackState.profile = name;
      updateSoundProfileUI();
      if (!wasPlaying) return;
      closeSoundtrack();
      startSoundtrack().catch(function () {
        setSoundtrack(false);
      });
    }

    function setSoundtrack(enabled) {
      if (!soundtrackToggle) return;
      if (enabled === soundtrackState.playing) return;
      soundtrackState.playing = enabled;
      document.body.classList.toggle("ts-soundtrack-on", enabled);
      soundtrackToggle.classList.toggle("active", enabled);
      soundtrackToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
      soundtrackToggle.textContent = enabled ? "Stop" : "Play";
      if (soundNavStatus) soundNavStatus.textContent = enabled ? "Sound: on" : "Sound: off";
      if (soundProfileToggle) soundProfileToggle.classList.toggle("is-playing", enabled);
      if (enabled) {
        startSoundtrack().catch(function () {
          soundtrackState.playing = false;
          document.body.classList.remove("ts-soundtrack-on");
          soundtrackToggle.classList.remove("active");
          soundtrackToggle.setAttribute("aria-pressed", "false");
          soundtrackToggle.textContent = "Unavailable";
          if (soundNavStatus) soundNavStatus.textContent = "Sound: unavailable";
          if (soundProfileToggle) soundProfileToggle.classList.remove("is-playing");
        });
      } else {
        closeSoundtrack();
      }
    }

    updateSoundProfileUI();

    if (cinematicVideoToggle) {
      if (prefersReducedMotion) setCinematicVideo(false);
      cinematicVideoToggle.addEventListener("click", function () {
        setCinematicVideo(document.body.classList.contains("ts-video-paused"));
      });
    }

    if (soundtrackToggle) {
      soundtrackToggle.addEventListener("click", function () {
        setSoundtrack(!soundtrackState.playing);
      });
      window.addEventListener("pagehide", function () {
        setSoundtrack(false);
      });
    }

    if (soundProfileToggle && soundProfilePanel) {
      soundProfileToggle.addEventListener("click", function () {
        var open = soundProfilePanel.hidden;
        soundProfilePanel.hidden = !open;
        soundProfileToggle.setAttribute("aria-expanded", open ? "true" : "false");
        soundProfileToggle.classList.toggle("active", open);
      });
      document.addEventListener("click", function (event) {
        if (soundProfilePanel.hidden) return;
        if (soundProfilePanel.contains(event.target) || soundProfileToggle.contains(event.target)) return;
        soundProfilePanel.hidden = true;
        soundProfileToggle.setAttribute("aria-expanded", "false");
        soundProfileToggle.classList.remove("active");
      });
    }

    qsa("[data-sound-profile]").forEach(function (button) {
      button.addEventListener("click", function () {
        setSoundProfile(button.getAttribute("data-sound-profile"));
      });
    });

    if (soundVolume) {
      soundVolume.addEventListener("input", function () {
        setSoundVolume(Number(soundVolume.value) / 100);
      });
    }

    function renderSparkline(values, color) {
      if (!briefingSparkline || !values || !values.length) return;
      var width = 320;
      var height = 88;
      var pad = 12;
      var min = Math.min.apply(Math, values);
      var max = Math.max.apply(Math, values);
      var spread = Math.max(1, max - min);
      var points = values.map(function (value, index) {
        var x = pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2);
        var y = height - pad - ((value - min) / spread) * (height - pad * 2);
        return [x, y];
      });
      var path = points
        .map(function (point, index) {
          return (index ? "L" : "M") + point[0].toFixed(1) + " " + point[1].toFixed(1);
        })
        .join(" ");
      var area = path + " L" + (width - pad) + " " + (height - pad) + " L" + pad + " " + (height - pad) + " Z";

      briefingSparkline.innerHTML =
        '<defs><linearGradient id="briefingGlow" x1="0" x2="1" y1="0" y2="0">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.05"/>' +
        '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.42"/></linearGradient></defs>' +
        '<path d="' + area + '" fill="url(#briefingGlow)" opacity="0.36"></path>' +
        '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>' +
        points
          .map(function (point) {
            return '<circle cx="' + point[0].toFixed(1) + '" cy="' + point[1].toFixed(1) + '" r="2.4" fill="' + color + '"></circle>';
          })
          .join("");
    }

    function openBriefing(id) {
      var briefing = BRIEFINGS[id];
      if (!briefing || !briefingModal) return;
      lastFocusedBeforeBriefing = document.activeElement;
      if (briefingTitle) briefingTitle.textContent = briefing.title;
      if (briefingCategory) briefingCategory.textContent = briefing.category;
      if (briefingCrs) briefingCrs.textContent = briefing.crs;
      if (briefingTicker) briefingTicker.textContent = briefing.ticker;
      if (briefingDate) briefingDate.textContent = briefing.date;
      if (briefingSource) briefingSource.textContent = briefing.source;
      if (briefingSummary) briefingSummary.textContent = briefing.summary;
      if (briefingImpact) briefingImpact.textContent = briefing.impact;
      renderSparkline(briefing.sparkline, briefing.color || "#C8FF00");
      briefingModal.hidden = false;
      document.body.classList.add("briefing-open");
      var closeButton = qs("[data-briefing-close]", briefingModal);
      if (closeButton) closeButton.focus({ preventScroll: true });
    }

    function closeBriefing() {
      if (briefingModal) briefingModal.hidden = true;
      document.body.classList.remove("briefing-open");
      if (lastFocusedBeforeBriefing && typeof lastFocusedBeforeBriefing.focus === "function") {
        lastFocusedBeforeBriefing.focus({ preventScroll: true });
      }
    }

    qsa("[data-briefing]").forEach(function (button) {
      button.addEventListener("click", function () {
        openBriefing(button.getAttribute("data-briefing"));
      });
    });

    qsa("[data-briefing-close]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        closeBriefing();
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (briefingModal && !briefingModal.hidden) closeBriefing();
        if (soundProfilePanel && !soundProfilePanel.hidden) {
          soundProfilePanel.hidden = true;
          if (soundProfileToggle) {
            soundProfileToggle.setAttribute("aria-expanded", "false");
            soundProfileToggle.classList.remove("active");
          }
        }
      }
    });

    function playSignalBlip() {
      if (!soundtrackState.playing || !soundtrackState.ctx || !soundtrackState.master) return;
      try {
        var ctx = soundtrackState.ctx;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var now = ctx.currentTime;
        osc.type = "sine";
        osc.frequency.setValueAtTime(920, now);
        osc.frequency.exponentialRampToValueAtTime(580, now + 0.18);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.05, now + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.connect(gain);
        gain.connect(soundtrackState.master);
        osc.start(now);
        osc.stop(now + 0.24);
        setTimeout(function () {
          try { osc.disconnect(); } catch (e) {}
          try { gain.disconnect(); } catch (e) {}
        }, 320);
      } catch (e) {}
    }

    function showBreakingAlert() {
      var id = BRIEFING_ORDER[activeBriefingIndex % BRIEFING_ORDER.length];
      var briefing = BRIEFINGS[id];
      activeBriefingIndex += 1;
      if (!briefing) return;
      if (alertTitle) alertTitle.textContent = briefing.title;
      document.body.classList.add("ts-breaking-alert");
      playSignalBlip();
      setTimeout(function () {
        document.body.classList.remove("ts-breaking-alert");
      }, 4200);
    }

    if (!prefersReducedMotion) {
      setTimeout(showBreakingAlert, 6800);
      setInterval(showBreakingAlert, 28000);
    }

    /* ── Terminal parallax ── */
    if (terminalCard && hero && !prefersReducedMotion && !isMobile) {
      hero.addEventListener("mousemove", function (event) {
        var rect = hero.getBoundingClientRect();
        var x = (event.clientX - rect.left) / rect.width - 0.5;
        var y = (event.clientY - rect.top) / rect.height - 0.5;
        terminalCard.style.transform =
          "perspective(1200px) rotateY(" +
          (x * 3).toFixed(2) +
          "deg) rotateX(" +
          (y * -3).toFixed(2) +
          "deg) translateY(-2px)";
      });
      hero.addEventListener("mouseleave", function () {
        terminalCard.style.transform = "perspective(1200px) rotateY(0deg) rotateX(0deg)";
      });
    }

    /* ── Updated Ns ago ── */
    if (updatedEl) {
      var sec = 9;
      var lastTick = Date.now();
      setInterval(function () {
        var now = Date.now();
        if (now - lastTick > 12000) {
          sec = 8 + Math.floor(Math.random() * 6);
          lastTick = now;
        } else if (sec <= 1) {
          sec = 12 + Math.floor(Math.random() * 10);
        } else {
          sec -= 1;
        }
        updatedEl.textContent = "Updated " + sec + "s ago";
      }, 1000);
    }

    function setChainText(text, animate) {
      if (!chainEl) return;
      if (typeTimer) {
        clearTimeout(typeTimer);
        typeTimer = null;
      }
      chainEl.setAttribute("data-full-text", text);
      if (prefersReducedMotion || !animate) {
        chainEl.textContent = text;
        chainEl.classList.remove("typed");
        return;
      }
      chainEl.textContent = "";
      chainEl.classList.add("typed");
      var i = 0;
      (function typeTick() {
        if (i <= text.length) {
          chainEl.textContent = text.slice(0, i);
          i += 1;
          typeTimer = setTimeout(typeTick, 22);
        } else {
          chainEl.classList.remove("typed");
          typeTimer = null;
        }
      })();
    }

    function animateConfidence(pct) {
      if (!confidenceFill) return;
      confidenceFill.style.width = pct + "%";
      confidenceFill.style.setProperty("--conf-pct", pct + "%");
      if (prefersReducedMotion) return;
      confidenceFill.classList.remove("animate-fill");
      void confidenceFill.offsetWidth;
      confidenceFill.classList.add("animate-fill");
    }

    function formatLandingPrice(value) {
      return "$" + Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatLandingPct(value) {
      var pct = Number(value || 0);
      return (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
    }

    function applyLandingQuotePrices(quotes) {
      if (!quotes || !quotes.length) return;
      var map = {};
      quotes.forEach(function (q) {
        map[q.symbol] = q;
      });
      TICKER_ORDER.forEach(function (sym) {
        var q = map[sym];
        if (!q || q.price == null || !TERMINAL_PRESETS[sym]) return;
        TERMINAL_PRESETS[sym].price = formatLandingPrice(q.price);
        var pct = Number(q.changePercent || 0);
        TERMINAL_PRESETS[sym].pct = formatLandingPct(pct);
        TERMINAL_PRESETS[sym].pctClass = pct >= 0 ? "up" : "down";
      });
      qsa(".ts-ticker-item[data-ticker]").forEach(function (btn) {
        var q = map[btn.getAttribute("data-ticker")];
        if (!q || q.price == null) return;
        var strong = btn.querySelector("strong");
        var em = btn.querySelector("em");
        if (strong) strong.textContent = formatLandingPrice(q.price);
        if (em) {
          var pct = Number(q.changePercent || 0);
          em.textContent = formatLandingPct(pct);
          em.className = pct >= 0 ? "up" : "down";
        }
      });
      qsa(".terminal-row[data-ticker]").forEach(function (btn) {
        var q = map[btn.getAttribute("data-ticker")];
        if (!q || q.price == null) return;
        var spans = btn.querySelectorAll("span");
        var em = btn.querySelector("em");
        if (spans[1]) spans[1].textContent = formatLandingPrice(q.price);
        if (em) {
          var pct = Number(q.changePercent || 0);
          em.textContent = formatLandingPct(pct);
          em.className = pct >= 0 ? "up" : "down";
        }
      });
    }

    function fetchLandingQuotes(callback) {
      if (window.__tsLandingQuotes) {
        applyLandingQuotePrices(window.__tsLandingQuotes);
        if (callback) callback(window.__tsLandingQuotes);
        return;
      }
      var url =
        typeof tsApiUrl === "function"
          ? tsApiUrl("/api/landing-quotes")
          : "/api/landing-quotes";
      fetch(url)
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        })
        .then(function (data) {
          if (data && data.quotes && data.quotes.length) {
            window.__tsLandingQuotes = data.quotes;
            applyLandingQuotePrices(data.quotes);
          }
          if (callback) callback(data && data.quotes);
        });
    }

    document.addEventListener("ts-landing-quotes", function (e) {
      if (e.detail && e.detail.quotes) applyLandingQuotePrices(e.detail.quotes);
    });

    function applyTerminalPreset(ticker, animate) {
      var preset = TERMINAL_PRESETS[ticker];
      if (!preset) return;
      activeTicker = ticker;

      if (signalLabel) {
        signalLabel.textContent =
          preset.alert + " · " + ticker + " · Policy exposure " + preset.confidence + "/100";
      }
      if (signalHeadline) signalHeadline.textContent = preset.signal;
      if (tagDetailEl) tagDetailEl.textContent = preset.tagDetail;
      if (signalFreshness) signalFreshness.textContent = "Illustrative example · demo briefing";
      if (confidenceText) confidenceText.textContent = preset.confidence + "/100";
      animateConfidence(preset.confidence);
      setChainText(preset.chain, animate !== false);

      if (signalPanel) {
        signalPanel.classList.add("is-updating");
        setTimeout(function () {
          signalPanel.classList.remove("is-updating");
        }, 320);
      }

      qsa(".ts-ticker-item").forEach(function (item) {
        item.classList.toggle("is-active", item.getAttribute("data-ticker") === ticker);
      });
    }

    function selectTerminalRow(ticker, fromUser) {
      var rows = qsa(".terminal-row[data-ticker]");
      var idx = TICKER_ORDER.indexOf(ticker);
      if (idx < 0) return;

      rows.forEach(function (row, i) {
        var isActive = row.getAttribute("data-ticker") === ticker;
        row.classList.toggle("active", isActive);
        row.setAttribute("aria-selected", isActive ? "true" : "false");
      });

      applyTerminalPreset(ticker, true);

      if (fromUser) {
        userPinnedTerminal = true;
      }
    }

    function cycleTerminal(delta, fromUser) {
      var idx = TICKER_ORDER.indexOf(activeTicker);
      if (idx < 0) idx = 0;
      idx = (idx + delta + TICKER_ORDER.length) % TICKER_ORDER.length;
      selectTerminalRow(TICKER_ORDER[idx], !!fromUser);
    }

    /* ── Terminal rows ── */
    qsa(".terminal-row[data-ticker]").forEach(function (row) {
      row.addEventListener("click", function () {
        selectTerminalRow(row.getAttribute("data-ticker"), true);
      });
      row.addEventListener("mouseenter", function () {
        if (!userPinnedTerminal) {
          selectTerminalRow(row.getAttribute("data-ticker"), false);
        }
      });
    });

    if (terminalRoot) {
      terminalRoot.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          cycleTerminal(1, true);
        } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          cycleTerminal(-1, true);
        }
      });
    }

    /* Auto-cycle when idle */
    var autoCycleTimer = null;
    function startAutoCycle() {
      if (prefersReducedMotion || userPinnedTerminal) return;
      stopAutoCycle();
      autoCycleTimer = setInterval(function () {
        if (userPinnedTerminal) {
          stopAutoCycle();
          return;
        }
        cycleTerminal(1, false);
      }, 4200);
    }
    function stopAutoCycle() {
      if (autoCycleTimer) {
        clearInterval(autoCycleTimer);
        autoCycleTimer = null;
      }
    }

    qsa(".terminal-row[data-ticker]").forEach(function (row) {
      row.addEventListener("click", stopAutoCycle);
      row.addEventListener("focus", stopAutoCycle);
    });

    fetchLandingQuotes(function () {
      selectTerminalRow("NVDA", false);
      if (!prefersReducedMotion && chainEl) {
        setChainText(TERMINAL_PRESETS.NVDA.chain, true);
      }
      if (!prefersReducedMotion) startAutoCycle();
    });

    /* ── Ticker tape clicks ── */
    qsa(".ts-ticker-item[data-ticker]").forEach(function (item) {
      item.addEventListener("click", function () {
        var ticker = item.getAttribute("data-ticker");
        if (TERMINAL_PRESETS[ticker]) {
          selectTerminalRow(ticker, true);
          stopAutoCycle();
          if (terminalRoot) {
            terminalRoot.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "nearest" });
            terminalRoot.focus({ preventScroll: true });
          }
        }
      });
    });

    /* ── Magnetic CTAs ── */
    function bindMagnetic(el) {
      if (!el || prefersReducedMotion) return;
      el.classList.add("magnetic-ready");
      el.addEventListener("mousemove", function (e) {
        var r = el.getBoundingClientRect();
        var mx = ((e.clientX - r.left) / r.width) * 100;
        var my = ((e.clientY - r.top) / r.height) * 100;
        el.style.setProperty("--mx", mx + "%");
        el.style.setProperty("--my", my + "%");
        var dx = (e.clientX - (r.left + r.width / 2)) * 0.08;
        var dy = (e.clientY - (r.top + r.height / 2)) * 0.12;
        el.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
      });
      el.addEventListener("mouseleave", function () {
        el.style.transform = "";
      });
    }

    qsa(".ts-primary-cta, .btn-primary").forEach(bindMagnetic);

    /* ── Signal cards expand ── */
    qsa(".sig-interactive").forEach(function (card) {
      var expand = qs(".sig-expand", card);
      var body = qs(".sig-expand-body", card);
      var chainNode = qs(".sig-expand-chain", card);
      var tickWrap = qs(".sig-expand-tickers", card);
      var hint = qs(".sig-expand-hint", card);

      if (body) body.textContent = card.getAttribute("data-why") || "";
      if (chainNode) chainNode.textContent = card.getAttribute("data-chain") || "";
      if (tickWrap) {
        tickWrap.innerHTML = "";
        (card.getAttribute("data-tickers") || "")
          .split(",")
          .filter(Boolean)
          .forEach(function (t) {
            var span = document.createElement("span");
            span.className = "sig-ticker";
            span.textContent = t;
            tickWrap.appendChild(span);
          });
      }

      card.addEventListener("click", function () {
        var open = card.getAttribute("aria-expanded") === "true";
        qsa(".sig-interactive").forEach(function (other) {
          if (other === card) return;
          other.setAttribute("aria-expanded", "false");
          var ex = qs(".sig-expand", other);
          if (ex) ex.hidden = true;
          var h = qs(".sig-expand-hint", other);
          if (h) h.textContent = "Click to expand";
        });
        card.setAttribute("aria-expanded", open ? "false" : "true");
        if (expand) expand.hidden = open;
        if (hint) hint.textContent = open ? "Click to expand" : "Click to collapse";
      });

      card.addEventListener("mousemove", function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--cx", e.clientX - r.left + "px");
        card.style.setProperty("--cy", e.clientY - r.top + "px");
      });
      card.addEventListener("mouseleave", function () {
        card.style.setProperty("--cx", "50%");
        card.style.setProperty("--cy", "50%");
      });
    });

    /* ── Pipeline steps ── */
    var pipeline = qs(".pipeline");
    var pipelineSteps = qsa(".pipeline-step");
    var connectorFill = qs(".pipeline-connector-fill");

    function lightPipelineStep(index) {
      if (!pipeline || !pipelineSteps.length) return;
      pipeline.classList.add("is-dimmed");
      pipelineSteps.forEach(function (step, i) {
        var lit = i === index;
        step.classList.toggle("is-lit", lit);
        step.setAttribute("aria-selected", lit ? "true" : "false");
      });
      if (connectorFill) {
        var pct = ((index + 1) / pipelineSteps.length) * 100;
        connectorFill.style.width = pct + "%";
      }
    }

    pipelineSteps.forEach(function (step, i) {
      step.addEventListener("mouseenter", function () {
        lightPipelineStep(i);
      });
      step.addEventListener("focus", function () {
        lightPipelineStep(i);
      });
      step.addEventListener("click", function () {
        lightPipelineStep(i);
      });
    });

    if (pipeline) {
      pipeline.addEventListener("mouseleave", function () {
        pipeline.classList.remove("is-dimmed");
        pipelineSteps.forEach(function (step) {
          step.classList.remove("is-lit");
        });
        if (connectorFill) connectorFill.style.width = "0%";
      });
    }

    /* ── Compare timeline scrub ── */
    var compareGrid = qs("#compare-timeline");
    var tlItems = qsa(".tl-item[data-day]");

    function highlightTimelineDay(day) {
      if (!compareGrid) return;
      compareGrid.classList.add("is-scrubbing");
      tlItems.forEach(function (item) {
        var active = item.getAttribute("data-day") === String(day);
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    tlItems.forEach(function (item) {
      item.addEventListener("mouseenter", function () {
        highlightTimelineDay(item.getAttribute("data-day"));
      });
      item.addEventListener("focus", function () {
        highlightTimelineDay(item.getAttribute("data-day"));
      });
      item.addEventListener("click", function () {
        highlightTimelineDay(item.getAttribute("data-day"));
      });
    });

    if (compareGrid) {
      compareGrid.addEventListener("mouseleave", function () {
        compareGrid.classList.remove("is-scrubbing");
        tlItems.forEach(function (item) {
          item.classList.remove("is-active");
          item.setAttribute("aria-pressed", "false");
        });
      });
    }

    /* ── Demo tiles ── */
    qsa(".demo-tile").forEach(function (tile) {
      tile.addEventListener("click", function () {
        var scrollTarget = tile.getAttribute("data-scroll");
        var terminalTicker = tile.getAttribute("data-terminal");
        if (terminalTicker && TERMINAL_PRESETS[terminalTicker]) {
          selectTerminalRow(terminalTicker, true);
          stopAutoCycle();
          if (hero) {
            hero.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
          }
          if (terminalRoot) terminalRoot.focus({ preventScroll: true });
          return;
        }
        if (scrollTarget) {
          var el = qs(scrollTarget);
          if (el) el.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
        }
      });
    });

    /* ── Scroll progress + section dots ── */
    var progressBar = qs(".ts-scroll-progress-bar");
    var sectionDots = qsa(".ts-dot[data-target]");
    var sectionTargets = sectionDots
      .map(function (dot) {
        return qs(dot.getAttribute("data-target"));
      })
      .filter(Boolean);

    function updateScrollProgress() {
      var scrollTop = window.scrollY;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var pct = docHeight > 0 ? Math.min(100, (scrollTop / docHeight) * 100) : 0;
      if (progressBar) progressBar.style.width = pct + "%";

      var activeIdx = 0;
      sectionTargets.forEach(function (section, i) {
        if (section.offsetTop - 120 <= scrollTop) activeIdx = i;
      });
      sectionDots.forEach(function (dot, i) {
        dot.classList.toggle("active", i === activeIdx);
      });
    }

    window.addEventListener("scroll", updateScrollProgress, { passive: true });
    updateScrollProgress();

    sectionDots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        var target = qs(dot.getAttribute("data-target"));
        if (target) target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
      });
    });

    /* ── GSAP scroll storytelling ── */
    if (!prefersReducedMotion && typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined") {
      gsap.registerPlugin(ScrollTrigger);

      qsa(".landing-cinematic .reveal.in, .landing-cinematic .stagger.in").forEach(function (el) {
        el.classList.remove("in");
      });

      gsap.utils.toArray(".landing-cinematic .reveal").forEach(function (el) {
        if (el.closest(".ts-hero")) return;
        gsap.fromTo(
          el,
          { opacity: 0, y: 28 },
          {
            opacity: 1,
            y: 0,
            duration: 0.7,
            ease: "power2.out",
            scrollTrigger: {
              trigger: el,
              start: "top 88%",
              toggleActions: "play none none none",
            },
          }
        );
      });

      gsap.utils.toArray(".landing-cinematic .stagger").forEach(function (wrap) {
        if (wrap.closest(".ts-hero")) return;
        gsap.fromTo(
          wrap.children,
          { opacity: 0, y: 22 },
          {
            opacity: 1,
            y: 0,
            duration: 0.55,
            stagger: 0.09,
            ease: "power2.out",
            scrollTrigger: {
              trigger: wrap,
              start: "top 85%",
              toggleActions: "play none none none",
            },
          }
        );
      });

      var pipelineWrap = qs(".pipeline-wrap");
      if (pipelineWrap && connectorFill) {
        gsap.to(connectorFill, {
          width: "100%",
          ease: "none",
          scrollTrigger: {
            trigger: pipelineWrap,
            start: "top 75%",
            end: "bottom 40%",
            scrub: 0.6,
          },
        });
      }

      var pin = qs("#chain-pin");
      var panel = qs("#chain-demo-panel");
      if (pin && panel && window.matchMedia("(min-width:901px)").matches) {
        ScrollTrigger.create({
          trigger: pin,
          start: "top 18%",
          end: "+=520",
          pin: ".chain-pin-left",
          pinSpacing: true,
          anticipatePin: 1,
        });
        gsap.fromTo(
          panel,
          { y: 48, opacity: 0.35 },
          {
            y: 0,
            opacity: 1,
            ease: "none",
            scrollTrigger: {
              trigger: pin,
              start: "top 70%",
              end: "+=520",
              scrub: 0.8,
            },
          }
        );
      }

      var wlSub = qs(".wl-sub");
      if (wlSub) {
        gsap.fromTo(
          wlSub,
          { opacity: 0.2 },
          {
            opacity: 1,
            ease: "none",
            scrollTrigger: {
              trigger: wlSub,
              start: "top 90%",
              end: "top 55%",
              scrub: 0.6,
            },
          }
        );
      }
    }

    /* Query param: ?ticker=NVDA */
    try {
      var params = new URLSearchParams(window.location.search);
      var qTicker = (params.get("ticker") || "").toUpperCase();
      if (TERMINAL_PRESETS[qTicker]) {
        selectTerminalRow(qTicker, true);
        stopAutoCycle();
      }
    } catch (e) {}
  });
})();
