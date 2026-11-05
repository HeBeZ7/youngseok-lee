/*
 * Renders the sections below the hero from window.SITE (js/content.js).
 * Runs synchronously at the end of <body>, so the sections exist before the
 * browser resolves an incoming #work / #about / #contact link.
 *
 * Also wires the "Read my story" disclosure and the photo viewer (lightbox).
 * Styles for everything rendered here: css/style.css + css/content.css.
 */
(function () {
  'use strict';

  var SITE = window.SITE;
  var main = document.getElementById('main');
  if (!SITE || !main) return;

  var NEW_TAB = ' target="_blank" rel="noopener noreferrer"';
  var NEW_TAB_NOTE = '<span class="sr-only"> (opens in a new tab)</span>';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // **bold** only; everything else is plain text.
  function rich(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function has(v) { return typeof v === 'string' && v.trim() !== ''; }

  function isExternal(url) { return /^https?:\/\//.test(url); }

  function formatDate(iso) {
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // Only links with a real url are rendered; nothing is shown for the rest.
  function realLinks(links) {
    return (links || []).filter(function (l) { return l && has(l.label) && has(l.url) && l.url !== '#'; });
  }

  function linkOut(l, cls) {
    var ext = isExternal(l.url);
    return '<a class="' + cls + '" href="' + esc(l.url) + '"' + (ext ? NEW_TAB : '') + '>' +
      '<span>' + esc(l.label) + '</span>' +
      '<span class="' + cls + '__arrow" aria-hidden="true">' + (ext ? '↗' : '→') + '</span>' +
      (ext ? NEW_TAB_NOTE : '') + '</a>';
  }

  function projectLinks(p) {
    var links = realLinks(p.links);
    if (!links.length) return '';
    return '<ul class="project__links btn-list">' +
      links.map(function (l) { return '<li>' + linkOut(l, 'btn-out') + '</li>'; }).join('') + '</ul>';
  }

  /* ---------- media ---------- */

  function mediaImg(m) {
    var img = '<img src="' + esc(m.src) + '" width="' + m.width + '" height="' + m.height + '" alt="' + esc(m.alt) +
      '" loading="lazy" decoding="async" onerror="this.closest(\'.media\').classList.add(\'is-broken\')">';
    // optional tighter crop / own layout for phones
    if (m.small) {
      img = '<picture><source media="(max-width: 640px)" srcset="' + esc(m.small.src) + '" width="' + m.small.width +
        '" height="' + m.small.height + '">' + img + '</picture>';
    }
    return img;
  }

  function media(p) {
    if (!p.media || !p.media.length) return '';
    return p.media.map(function (m) {
      var inner = mediaImg(m);
      if (m.link) {
        // the whole image is a link to the live project
        inner = '<a class="media__open media__open--site" href="' + esc(m.link) + '"' + NEW_TAB + '>' + inner + NEW_TAB_NOTE + '</a>';
      } else if (m.zoom) {
        inner = '<button class="media__open" type="button" data-lightbox aria-haspopup="dialog"' +
          ' data-src="' + esc(m.src) + '" data-width="' + m.width + '" data-height="' + m.height + '"' +
          ' data-alt="' + esc(m.alt) + '" data-caption="' + esc(m.caption || '') + '">' + inner +
          '<span class="sr-only"> — view larger</span></button>';
      }
      return '<figure class="media' + (p.featured ? ' media--featured' : '') + '">' +
        '<div class="media__frame">' + inner + '<span class="media__fallback">Image unavailable</span></div>' +
        (has(m.caption) ? '<figcaption>' + esc(m.caption) + '</figcaption>' : '') +
        '</figure>';
    }).join('');
  }

  /* ---------- status: finished vs. in progress ---------- */

  function statusGroup(g, open) {
    if (!g || !g.items || !g.items.length) return '';
    return '<div class="status__group' + (open ? ' status__group--open' : '') + '">' +
      '<p class="status__label">' + esc(g.label) + '</p><ul class="status__list">' +
      g.items.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div>';
  }

  function status(p) {
    var s = p.status || {};
    var html = statusGroup(s.done, false) + statusGroup(s.open, true);
    if (!html) return '';
    if (s.asOf && SITE.facts.asOf) {
      html += '<p class="status__asof">As of <time datetime="' + esc(SITE.facts.asOf) + '">' +
        esc(formatDate(SITE.facts.asOf)) + '</time></p>';
    }
    return '<div class="status">' + html + '</div>';
  }

  function story(p) {
    var items = (p.story || []).filter(function (it) { return it && has(it.text); });
    if (!items.length) return '';
    return '<dl class="story">' + items.map(function (it) {
      return '<div class="story__item"><dt>' + esc(it.label) + '</dt><dd>' + rich(it.text) + '</dd></div>';
    }).join('') + '</dl>';
  }

  /* ---------- projects ---------- */

  function project(p, i) {
    var num = String(i + 1).padStart(2, '0');
    var title = p.logo
      ? '<img class="project__logo" src="' + esc(p.logo.src) + '" width="' + p.logo.width + '" height="' + p.logo.height +
        '" alt="' + esc(p.name) + '" onerror="this.replaceWith(document.createTextNode(\'' + esc(p.name) + '\'))">'
      : esc(p.name);

    var head = '<header class="project__head">' +
      '<p class="project__index"><span>' + num + '</span>' + (has(p.period) ? '<span>' + esc(p.period) + '</span>' : '') + '</p>' +
      '<h3 class="project__title" id="p-' + esc(p.id) + '">' + title + '</h3>' +
      (has(p.lede) ? '<p class="project__lede">' + esc(p.lede) + '</p>' : '') +
      (has(p.role) ? '<p class="project__role"><span class="project__role-label">Role</span><span>' + esc(p.role) + '</span></p>' : '') +
      '</header>';

    var attrs = ' id="work-' + esc(p.id) + '" aria-labelledby="p-' + esc(p.id) + '"';

    if (p.featured) {
      return '<article class="project project--featured"' + attrs + '>' +
        head + media(p) +
        '<div class="project__grid">' +
        '<aside class="project__aside" aria-label="Where ' + esc(p.name) + ' stands">' +
        '<h4 class="aside-title">Where it stands</h4>' + status(p) + projectLinks(p) + '</aside>' +
        '<div class="project__main">' + story(p) + '</div>' +
        '</div></article>';
    }

    if (p.compact || !(p.media && p.media.length)) {
      // text only: no image frame at all
      return '<article class="project project--compact"' + attrs + '>' + head +
        '<div class="project__text">' + status(p) + story(p) + projectLinks(p) + '</div>' +
        '</article>';
    }

    // title first in the source, so on phones it sits above its image
    return '<article class="project project--split' + (i % 2 === 0 ? ' project--flip' : '') + '"' + attrs + '>' +
      head +
      '<div class="project__visual">' + media(p) + '</div>' +
      '<div class="project__text">' + status(p) + story(p) + projectLinks(p) + '</div>' +
      '</article>';
  }

  /* ---------- about ---------- */

  function about() {
    var a = SITE.about || {};
    var paras = (a.story || []).filter(has);
    var body = (has(a.intro) ? '<p class="about__lead">' + rich(a.intro) + '</p>' : '');
    if (paras.length) {
      body += '<button class="story-toggle" type="button" aria-expanded="false" aria-controls="about-story">' +
        '<span>' + esc(a.storyLabel || 'Read my story') + '</span><span class="story-toggle__icon" aria-hidden="true"></span></button>' +
        '<div class="about__story" id="about-story" hidden>' +
        paras.map(function (para) { return '<p>' + rich(para) + '</p>'; }).join('') + '</div>';
    }

    var team = (a.team || []).map(function (m) {
      return '<li><span class="team__name">' + esc(m.name) + '</span><span class="team__role">' + esc(m.role) + '</span>' +
        (has(m.note) ? '<span class="team__note">' + esc(m.note) + '</span>' : '') + '</li>';
    }).join('');

    return '<section class="section section--about" id="about" aria-labelledby="h-about"><div class="wrap about">' +
      '<h2 class="section-title" id="h-about">About</h2>' +
      '<div class="about__body">' + body + '</div>' +
      (team ? '<div class="team"><h3 class="aside-title">Team</h3><ul class="team__list">' + team + '</ul></div>' : '') +
      '</div></section>';
  }

  /* ---------- learning & recognition ---------- */

  function recognition() {
    var r = SITE.recognition || {};
    var items = (r.items || []).filter(function (it) { return it && has(it.title); });
    var ph = r.photo;
    if (!items.length && !ph) return '';

    var photo = '';
    if (ph && has(ph.src)) {
      var big = ph.large || ph;
      photo = '<figure class="recog__photo media">' +
        '<div class="recog__frame">' +
        '<button class="recog__open" type="button" data-lightbox aria-haspopup="dialog"' +
        ' data-src="' + esc(big.src) + '" data-width="' + big.width + '" data-height="' + big.height + '"' +
        ' data-alt="' + esc(ph.alt) + '" data-caption="' + esc(ph.caption || '') + '">' +
        '<img src="' + esc(ph.src) + '"' +
        (ph.large ? ' srcset="' + esc(ph.src) + ' ' + ph.width + 'w, ' + esc(ph.large.src) + ' ' + ph.large.width + 'w"' +
          ' sizes="(min-width: 960px) min(500px, 42vw), calc(100vw - 40px)"' : '') +
        ' width="' + ph.width + '" height="' + ph.height + '" alt="' + esc(ph.alt) + '" loading="lazy" decoding="async"' +
        ' onerror="this.closest(\'.media\').classList.add(\'is-broken\')">' +
        '<span class="sr-only"> — view larger</span>' +
        '<span class="recog__zoom" aria-hidden="true"></span>' +
        '</button>' +
        '<span class="media__fallback">Image unavailable</span>' +
        '</div>' +
        (has(ph.caption) ? '<figcaption>' + esc(ph.caption) + '</figcaption>' : '') +
        '</figure>';
    }

    var list = items.length ? '<ol class="recog__list">' + items.map(function (it) {
      return '<li class="recog__item">' +
        '<p class="recog__meta"><span class="recog__year">' + esc(it.year || '') + '</span>' +
        (has(it.status) ? '<span class="recog__status' + (it.award ? ' recog__status--award' : '') + '">' + esc(it.status) + '</span>' : '') +
        '</p>' +
        '<h3 class="recog__title">' + esc(it.title) + '</h3>' +
        (has(it.description) ? '<p class="recog__desc">' + esc(it.description) + '</p>' : '') +
        (has(it.detail) ? '<p class="recog__detail">' + esc(it.detail) + '</p>' : '') +
        '</li>';
    }).join('') + '</ol>' : '';

    return '<section class="section section--recognition" id="recognition" aria-labelledby="h-record"><div class="wrap">' +
      '<h2 class="section-title section-title--sub" id="h-record">' + esc(r.title || 'Learning & Recognition') + '</h2>' +
      '<div class="recog' + (photo ? '' : ' recog--text') + '">' + photo + list + '</div>' +
      '</div></section>';
  }

  /* ---------- contact ---------- */

  function contact() {
    var c = SITE.contact || {};
    var links = realLinks(c.links);
    return '<section class="section section--contact" id="contact" aria-labelledby="h-contact"><div class="wrap contact">' +
      '<h2 class="section-title" id="h-contact">' + esc(c.title || 'Contact') + '</h2>' +
      (has(c.line) ? '<p class="contact__line">' + esc(c.line) + '</p>' : '') +
      (has(c.email) ? '<p class="contact__email"><a class="link-out" href="mailto:' + esc(c.email) + '">' +
        '<span class="sr-only">Email: </span><span>' + esc(c.email) + '</span>' +
        '<span class="link-out__arrow" aria-hidden="true">→</span></a></p>' : '') +
      (links.length ? '<ul class="contact-links">' + links.map(function (l) { return '<li>' + linkOut(l, 'link-out') + '</li>'; }).join('') + '</ul>' : '') +
      (has(c.location) ? '<p class="contact__place">' + esc(c.location) + '</p>' : '') +
      '</div></section>';
  }

  var html = '<section class="section section--work" id="work" aria-labelledby="h-work"><div class="wrap">' +
    '<h2 class="section-title" id="h-work">Selected Work</h2>' +
    SITE.projects.map(project).join('') +
    '</div></section>' + about() + recognition() + contact();

  main.innerHTML = html;

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------- "Read my story" ---------- */

  var toggle = main.querySelector('.story-toggle');
  var storyPanel = document.getElementById('about-story');
  if (toggle && storyPanel) {
    // searchable while closed where supported (find-in-page opens it)
    var untilFound = 'onbeforematch' in document.body;
    if (untilFound) storyPanel.setAttribute('hidden', 'until-found');
    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) storyPanel.removeAttribute('hidden');
      else storyPanel.setAttribute('hidden', untilFound ? 'until-found' : '');
    };
    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    storyPanel.addEventListener('beforematch', function () { setOpen(true); });
  }

  /* ---------- photo viewer ---------- */

  (function lightbox() {
    var triggers = main.querySelectorAll('[data-lightbox]');
    if (!triggers.length) return;

    var box = document.createElement('div');
    box.className = 'lightbox';
    box.id = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'lightbox-caption');
    box.hidden = true;
    box.innerHTML =
      '<figure class="lightbox__figure">' +
      '<img class="lightbox__img" alt="" decoding="async">' +
      '<figcaption class="lightbox__caption" id="lightbox-caption"></figcaption>' +
      '</figure>' +
      '<button class="lightbox__close" type="button" aria-label="Close photo"><span aria-hidden="true"></span></button>';
    document.body.appendChild(box);

    var img = box.querySelector('.lightbox__img');
    var cap = box.querySelector('.lightbox__caption');
    var closeBtn = box.querySelector('.lightbox__close');
    var root = document.documentElement;
    var opener = null;
    var inerted = [];

    function open(trigger) {
      opener = trigger;
      var d = trigger.dataset;
      img.removeAttribute('src');
      img.width = +d.width || 0;
      img.height = +d.height || 0;
      img.alt = d.alt || '';
      img.src = d.src;
      cap.textContent = d.caption || d.alt || '';

      // lock background scroll without a layout jump
      var sbw = window.innerWidth - root.clientWidth;
      root.style.setProperty('--sbw', Math.max(0, sbw) + 'px');
      root.classList.add('lb-open');

      // everything else is out of reach while the viewer is open
      inerted = Array.prototype.filter.call(document.body.children, function (el) {
        return el !== box && !el.hasAttribute('inert') && el.tagName !== 'SCRIPT';
      });
      inerted.forEach(function (el) { el.setAttribute('inert', ''); });

      box.hidden = false;
      // next frame so the fade-in runs
      requestAnimationFrame(function () { box.classList.add('is-open'); });
      closeBtn.focus({ preventScroll: true });
      document.addEventListener('keydown', onKey, true);
    }

    function close() {
      if (box.hidden) return;
      document.removeEventListener('keydown', onKey, true);
      box.classList.remove('is-open');
      box.hidden = true;
      inerted.forEach(function (el) { el.removeAttribute('inert'); });
      inerted = [];
      root.classList.remove('lb-open');
      root.style.removeProperty('--sbw');
      if (opener) opener.focus({ preventScroll: true });
      opener = null;
    }

    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab') {
        // the close button is the only control inside the dialog
        e.preventDefault();
        closeBtn.focus();
      }
    }

    Array.prototype.forEach.call(triggers, function (t) {
      t.addEventListener('click', function () { open(t); });
    });
    closeBtn.addEventListener('click', close);
    // a click or tap anywhere outside the photo itself closes the viewer
    box.addEventListener('click', function (e) {
      if (e.target !== img) close();
    });
  })();

  /* ---------- highlight the menu item for the section in view ---------- */

  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav a[href^="#"]'));
  if ('IntersectionObserver' in window && navLinks.length) {
    var byId = {};
    navLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      var current = ['contact', 'recognition', 'about', 'work'].filter(function (id) { return visible[id]; })[0];
      if (current === 'recognition') current = 'about';
      navLinks.forEach(function (a) {
        if (a === byId[current]) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    ['work', 'about', 'recognition', 'contact'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }
})();
