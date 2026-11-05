/*
 * Renders the sections below the hero from window.SITE (js/content.js).
 * Runs synchronously at the end of <body>, so the sections exist before the
 * browser resolves an incoming #work / #about / #contact link.
 */
(function () {
  'use strict';

  var SITE = window.SITE;
  var main = document.getElementById('main');
  if (!SITE || !main) return;

  var openItems = [];

  var STATUS_LABEL = {
    participated: 'Participated',
    selected: 'Selected',
    awarded: 'Awarded',
    'support-agreement': 'Support agreement'
  };

  var STORY_LABEL = {
    built: 'What I built',
    role: 'What I did',
    decisions: 'Problems and decisions',
    outcome: 'Results and lessons'
  };

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

  function isTodo(v) {
    return v == null || v === '' || (typeof v === 'object' && 'todo' in v);
  }

  function todoBox(hint, where, tag, cls) {
    openItems.push(where + ' — ' + hint);
    tag = tag || 'p';
    return '<' + tag + ' class="todo' + (cls ? ' ' + cls : '') + '" lang="ko" data-todo="' + esc(where) + '">' +
      esc(hint) + '</' + tag + '>';
  }

  function text(v, where, tag, cls) {
    tag = tag || 'p';
    if (isTodo(v)) return todoBox(v && v.todo ? v.todo : where, where, tag, cls);
    return '<' + tag + (cls ? ' class="' + cls + '"' : '') + '>' + rich(v) + '</' + tag + '>';
  }

  function formatDate(iso) {
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function linkList(links, where, cls) {
    var out = links.map(function (l) {
      if (!l.url) {
        openItems.push(where + ' — ' + l.label + ' link');
        return '<li><span class="link-pending" title="Link to be added">' + esc(l.label) +
          '<span class="link-pending__note">link pending</span></span></li>';
      }
      var external = !/^mailto:|^#/.test(l.url);
      return '<li><a class="link-out" href="' + esc(l.url) + '"' +
        (external ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l.label) +
        '<span class="link-out__arrow" aria-hidden="true">' + (external ? '↗' : '→') + '</span></a></li>';
    });
    return '<ul class="' + cls + '">' + out.join('') + '</ul>';
  }

  function media(p) {
    if (p.media && p.media.length) {
      return p.media.map(function (m) {
        var img = '<img src="' + esc(m.src) + '" width="' + m.width + '" height="' + m.height + '" alt="' + esc(m.alt) +
          '" loading="lazy" decoding="async" onerror="this.closest(\'.media\').classList.add(\'is-broken\')">';
        // optional tighter crop for phones
        if (m.small) {
          img = '<picture><source media="(max-width: 640px)" srcset="' + esc(m.small.src) + '" width="' + m.small.width +
            '" height="' + m.small.height + '">' + img + '</picture>';
        }
        return '<figure class="media' + (p.featured ? ' media--featured' : '') + '">' +
          '<div class="media__frame">' +
          '<a class="media__open" href="' + esc(m.src) + '" target="_blank" rel="noopener" title="Open full size">' +
          img + '</a>' +
          '<span class="media__fallback">Image unavailable</span>' +
          '</div>' +
          (m.caption ? '<figcaption>' + esc(m.caption) + '</figcaption>' : '') +
          '</figure>';
      }).join('');
    }
    openItems.push(p.name + ' — project image');
    return '<figure class="media media--todo">' +
      '<div class="media__frame media__frame--todo" role="img" aria-label="Project image to be added">' +
      '<span class="todo todo--inline" lang="ko">' + esc(p.mediaHint || '프로젝트 실제 화면') +
      ' — assets/work/ 에 넣고 content.js의 media에 등록</span>' +
      '</div></figure>';
  }

  function status(p, withDate) {
    var s = p.status || {};
    var so = s.soFar || [], ip = s.inProgress || [];
    if (!so.length && !ip.length) return '';
    var html = '<div class="status">';
    if (so.length) {
      html += '<div class="status__group"><p class="status__label">So far</p><ul class="status__list">' +
        so.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div>';
    }
    if (ip.length) {
      html += '<div class="status__group status__group--open"><p class="status__label">In progress</p><ul class="status__list">' +
        ip.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div>';
    }
    if (withDate && SITE.facts.asOf) {
      html += '<p class="status__asof">As of <time datetime="' + esc(SITE.facts.asOf) + '">' +
        esc(formatDate(SITE.facts.asOf)) + '</time></p>';
    }
    return html + '</div>';
  }

  function story(p) {
    var keys = ['built', 'role', 'decisions', 'outcome'];
    return '<dl class="story">' + keys.map(function (k) {
      var v = p.story && p.story[k];
      return '<div class="story__item"><dt>' + STORY_LABEL[k] + '</dt>' +
        text(v, p.name + ' · ' + STORY_LABEL[k], 'dd') + '</div>';
    }).join('') + '</dl>';
  }

  function project(p, i) {
    var num = String(i + 1).padStart(2, '0');
    var title = p.logo
      ? '<img class="project__logo" src="' + esc(p.logo.src) + '" width="' + p.logo.width + '" height="' + p.logo.height +
        '" alt="' + esc(p.name) + '" onerror="this.replaceWith(document.createTextNode(\'' + esc(p.name) + '\'))">'
      : esc(p.name);

    var head = '<header class="project__head">' +
      '<p class="project__index"><span>' + num + '</span>' +
      (isTodo(p.period) ? todoBox((p.period && p.period.todo) || '기간', p.name + ' · period', 'span') : '<span>' + esc(p.period) + '</span>') +
      '</p>' +
      '<h3 class="project__title" id="p-' + esc(p.id) + '">' + title + '</h3>' +
      text(p.lede, p.name + ' · summary', 'p', 'project__lede') +
      '</header>';

    var links = '<div class="project__links"><p class="project__links-label">Links</p>' +
      linkList(p.links || [], p.name, 'links') + '</div>';

    if (p.featured) {
      return '<article class="project project--featured" id="work-' + esc(p.id) + '" aria-labelledby="p-' + esc(p.id) + '">' +
        head + media(p) +
        '<div class="project__grid">' +
        '<aside class="project__aside" aria-label="Where ' + esc(p.name) + ' stands">' +
        '<h4 class="aside-title">Where it stands</h4>' + status(p, true) + links + '</aside>' +
        '<div class="project__main">' + story(p) + '</div>' +
        '</div></article>';
    }

    // title first in the source, so on phones it sits above its image
    return '<article class="project project--split' + (i % 2 === 0 ? ' project--flip' : '') + '" id="work-' + esc(p.id) +
      '" aria-labelledby="p-' + esc(p.id) + '">' +
      head +
      '<div class="project__visual">' + media(p) + '</div>' +
      '<div class="project__text">' + status(p, false) + story(p) + links + '</div>' +
      '</article>';
  }

  function about() {
    var a = SITE.about || {};
    var body = a.paragraphs && a.paragraphs.length
      ? a.paragraphs.map(function (para, i) {
          return '<p' + (i === 0 ? ' class="about__lead"' : '') + '>' + rich(para) + '</p>';
        }).join('')
      : todoBox(a.pendingHint || 'About text', 'About');

    var team = (a.team || []).map(function (m) {
      return '<li><span class="team__name">' + esc(m.name) + '</span><span class="team__role">' + esc(m.role) + '</span></li>';
    }).join('');

    return '<section class="section section--about" id="about" aria-labelledby="h-about"><div class="wrap about">' +
      '<h2 class="section-title" id="h-about">About</h2>' +
      '<div class="about__body">' + body + '</div>' +
      (team ? '<div class="team"><h3 class="aside-title">Team</h3><ul class="team__list">' + team + '</ul></div>' : '') +
      '</div></section>';
  }

  function recognition() {
    var r = SITE.recognition || {};
    var items = (r.items || []).filter(function (it) { return it && it.title; });
    var list = items.length
      ? '<ol class="record">' + items.map(function (it) {
          var st = STATUS_LABEL[it.status] || '';
          if (!st) openItems.push('Recognition — status missing for "' + it.title + '"');
          return '<li class="record__item">' +
            '<span class="record__year">' + esc(it.year || '') + '</span>' +
            '<span class="record__what"><span class="record__title">' + esc(it.title) + '</span>' +
            (it.org ? '<span class="record__org">' + esc(it.org) + '</span>' : '') +
            (it.note ? '<span class="record__note">' + esc(it.note) + '</span>' : '') + '</span>' +
            '<span class="record__status record__status--' + esc(it.status || 'unknown') + '">' + esc(st || 'Status?') + '</span>' +
            '</li>';
        }).join('') + '</ol>'
      : todoBox(r.pendingHint || 'Recognition entries', 'Experience & Recognition');

    return '<section class="section section--record" id="recognition" aria-labelledby="h-record"><div class="wrap">' +
      '<h2 class="section-title" id="h-record">Experience &amp; Recognition</h2>' + list +
      '</div></section>';
  }

  function contact() {
    var c = SITE.contact || {};
    return '<section class="section section--contact" id="contact" aria-labelledby="h-contact"><div class="wrap">' +
      '<h2 class="section-title" id="h-contact">Contact</h2>' +
      linkList(c.links || [], 'Contact', 'contact-links') +
      '</div></section>';
  }

  var html = '<section class="section section--work" id="work" aria-labelledby="h-work"><div class="wrap">' +
    '<h2 class="section-title" id="h-work">Selected Work</h2>' +
    SITE.projects.map(project).join('') +
    '</div></section>' + about() + recognition() + contact();

  main.innerHTML = html;

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  // highlight the menu item for the section in view
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

  if (openItems.length && window.console) {
    console.info('[content] ' + openItems.length + ' item(s) still to replace:\n  · ' + openItems.join('\n  · '));
  }
  window.__openContent = openItems;
})();
