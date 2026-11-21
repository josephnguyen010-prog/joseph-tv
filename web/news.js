/*
 * Joseph TV: news headlines for the News page (home.js), from three RSS feeds.
 * Written for the Chromium of older TVs (Tizen 3): ES5 only.
 *
 * On the TV, config.xml's <access origin="*"> lets the app read the feeds directly. In a desktop browser the sites'
 * CORS rules usually block that, so the preview shows sample headlines instead.
 */
var News = (function () {
  'use strict';

  var FEEDS = [
    {key: 'football', url: 'https://www.cbssports.com/rss/headlines/nfl/', source: 'CBS Sports',
      keep: function (link) { return link.indexOf('/nfl/') >= 0; }},
    {key: 'politics', url: 'https://abcnews.go.com/abcnews/politicsheadlines', source: 'ABC News'},
    {key: 'vietnam', url: 'https://e.vnexpress.net/rss/news.rss', source: 'VnExpress'}
  ];
  var MAX = 10;                       // headlines per section
  var FRESH = 30 * 60 * 1000;         // fetch again after 30 minutes

  /** Section names, in English and Vietnamese (the language button switches between them). */
  var WORDS = {
    en: {news: 'News', football: 'American Football', politics: 'US Politics', vietnam: 'Vietnam',
      loading: 'Loading headlines…', failed: 'Couldn’t load the news. Check the internet connection.',
      hint: 'OK opens the story in the Internet app. Back returns here.', ago: 'ago'},
    vi: {news: 'Tin tức', football: 'Bóng bầu dục Mỹ', politics: 'Chính trị Mỹ', vietnam: 'Việt Nam',
      loading: 'Đang tải tin…', failed: 'Không tải được tin. Hãy kiểm tra kết nối mạng.',
      hint: 'Nhấn OK để đọc bài trong ứng dụng Internet. Nhấn Back để quay lại.', ago: 'trước'}
  };

  function word(name) {
    var lang = (window.I18N && I18N.lang === 'vi') ? 'vi' : 'en';
    return WORDS[lang][name];
  }

  var sections = {};   // key -> {items: [...], at: time, failed: bool}

  function stored(key) { try { return JSON.parse(localStorage.getItem('jtv.news2.' + key)); } catch (e) { return null; } }
  function store(key, value) { try { localStorage.setItem('jtv.news2.' + key, JSON.stringify(value)); } catch (e) {} }

  function text(node) { return node ? (node.textContent || '').replace(/\s+/g, ' ').replace(/^ | $/g, '') : ''; }

  function first(item, names) {
    for (var i = 0; i < names.length; i++) {
      var n = item.getElementsByTagName(names[i]);
      if (n.length) return n;
    }
    return [];
  }

  /** The best picture an item offers: the widest media:thumbnail/content, an enclosure, or an <img> in its HTML. */
  function picture(item) {
    var best = '', width = -1, list = first(item, ['media:thumbnail', 'media:content', 'enclosure']);
    for (var i = 0; i < list.length; i++) {
      var url = list[i].getAttribute('url'), w = parseInt(list[i].getAttribute('width'), 10) || 0;
      var type = list[i].getAttribute('type') || 'image';
      if (url && type.indexOf('image') === 0 && w > width) { best = url; width = w; }
    }
    if (best) return best;
    var html = text(item.getElementsByTagName('description')[0]) + ' ' + text(first(item, ['content:encoded'])[0]);
    var m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
    return m ? m[1] : '';
  }

  /**
   * The same, read from an item's raw XML: the TV's older Chromium doesn't find prefixed tags like media:thumbnail
   * (ABC's pictures) through the DOM, so the text is the reliable source.
   */
  function pictureFromText(raw) {
    var best = '', width = -1, tag, re = /<(?:media:thumbnail|media:content|enclosure)\b[^>]*>/g;
    while ((tag = re.exec(raw))) {
      var url = /\burl=["']([^"']+)["']/.exec(tag[0]), w = /\bwidth=["'](\d+)/.exec(tag[0]), type = /\btype=["']([^"']+)/.exec(tag[0]);
      if (!url || (type && type[1].indexOf('image') !== 0)) continue;
      var n = w ? parseInt(w[1], 10) : 0;
      if (n > width && n <= 1280) { best = url[1]; width = n; }   // the widest one an old TV handles easily
    }
    if (best) return best.replace(/&amp;/g, '&');
    var html = raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    var m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
    return m ? m[1].replace(/&amp;/g, '&') : '';
  }

  function parse(feed, xml) {
    var doc = new DOMParser().parseFromString(xml, 'text/xml');
    var items = doc.getElementsByTagName('item'), out = [];
    var raws = xml.split(/<item[\s>]/).slice(1);   // the same items as text, in the same order
    for (var i = 0; i < items.length && out.length < MAX; i++) {
      var title = text(items[i].getElementsByTagName('title')[0]);
      var link = text(items[i].getElementsByTagName('link')[0]);
      if (!title || !/^https?:\/\//.test(link)) continue;
      if (feed.keep && !feed.keep(link)) continue;
      var date = Date.parse(text(items[i].getElementsByTagName('pubDate')[0]));
      var image = (raws.length === items.length ? pictureFromText(raws[i]) : '') || picture(items[i]);
      out.push({title: title, link: link, image: image.replace(/^http:/, 'https:'),
        source: feed.source, at: isNaN(date) ? 0 : date});
    }
    return out;
  }

  function fetchFeed(feed, done) {
    var x = new XMLHttpRequest(), over = false;
    x.open('GET', feed.url, true);
    x.timeout = 15000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(null); return; }
      var items;
      try { items = parse(feed, x.responseText); } catch (e) { items = null; }
      done(items && items.length ? items : null);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(null); } };
    try { x.send(); } catch (e) { if (!over) { over = true; done(null); } }
  }

  /** Sample headlines for the desktop preview, where the sites' CORS rules block the feeds. */
  var SAMPLES = {
    football: ['Chiefs edge Bills in overtime thriller', 'Week 12 power rankings: who is on top now?',
      'Rookie quarterback sets franchise passing record', 'Injury report: key players to watch this Sunday',
      'How to watch Thanksgiving Day games'],
    politics: ['Senate passes spending bill ahead of deadline', 'White House outlines new trade plan',
      'Governors meet to discuss disaster funding', 'Supreme Court to hear major election case',
      'What to know about next week in Congress'],
    vietnam: ['Hanoi metro line carries record passengers', 'Vietnam exports rise for fifth straight month',
      'New expressway links Ho Chi Minh City to Mekong Delta', 'Da Nang named top Asian travel spot',
      'Long Thanh airport road widens to 10 lanes']
  };

  function samples(key) {
    var out = [], now = new Date().getTime();
    for (var i = 0; i < SAMPLES[key].length; i++) {
      out.push({title: SAMPLES[key][i], link: 'https://example.com/', image: '', source: 'Sample', at: now - (i + 1) * 3600000});
    }
    return out;
  }

  /** Loads every section that is older than FRESH; changed() runs after each one arrives. */
  function refresh(changed) {
    var now = new Date().getTime();
    FEEDS.forEach(function (feed) {
      var have = sections[feed.key] || stored(feed.key);
      if (have) sections[feed.key] = have;
      if (have && have.items && have.items.length && now - have.at < FRESH) return;
      fetchFeed(feed, function (items) {
        if (items) {
          sections[feed.key] = {items: items, at: new Date().getTime()};
          store(feed.key, sections[feed.key]);
        } else if (!sections[feed.key] || !sections[feed.key].items) {
          sections[feed.key] = window.TV && TV.name === 'browser'
            ? {items: samples(feed.key), at: 0} : {items: [], at: 0, failed: true};
        }
        if (changed) changed();
      });
    });
  }

  /** [{key, title, items, failed}] in the page's order. */
  function list() {
    return FEEDS.map(function (feed) {
      var s = sections[feed.key] || {};
      return {key: feed.key, title: word(feed.key), items: s.items || [], failed: !!s.failed, loaded: !!s.items};
    });
  }

  /** "2 h ago" / "2 giờ trước". */
  function age(at) {
    if (!at) return '';
    var min = Math.max(1, Math.round((new Date().getTime() - at) / 60000)), vi = word('ago') === 'trước';
    if (min < 60) return min + (vi ? ' phút ' : ' min ') + word('ago');
    var h = Math.round(min / 60);
    if (h < 48) return h + (vi ? ' giờ ' : ' h ') + word('ago');
    return Math.round(h / 24) + (vi ? ' ngày ' : ' days ') + word('ago');
  }

  return {refresh: refresh, list: list, word: word, age: age};
})();
