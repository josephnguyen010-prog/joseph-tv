/*
 * Joseph TV: the National Weather Service's active alerts for the TV's place (api.weather.gov, free, no key), for the
 * banner on the home screen and the cards at the head of the weather row (home.js).
 * Written for the WebKit of 2017 Samsungs (Tizen 3): ES5 only.
 */
var Alerts = (function () {
  'use strict';

  var EVERY = 5 * 60 * 1000;     // asked again after 5 minutes
  var list = [], at = 0, asking = false, lastChanged = null;

  /** Event names in Vietnamese; any other event keeps the Weather Service's English name. */
  var VI = {
    'Tornado Warning': 'Cảnh báo lốc xoáy', 'Tornado Watch': 'Theo dõi lốc xoáy',
    'Severe Thunderstorm Warning': 'Cảnh báo giông bão mạnh', 'Severe Thunderstorm Watch': 'Theo dõi giông bão mạnh',
    'Flash Flood Warning': 'Cảnh báo lũ quét', 'Flash Flood Watch': 'Theo dõi lũ quét',
    'Flood Warning': 'Cảnh báo lũ lụt', 'Flood Watch': 'Theo dõi lũ lụt', 'Flood Advisory': 'Khuyến cáo ngập lụt',
    'Winter Storm Warning': 'Cảnh báo bão tuyết', 'Winter Storm Watch': 'Theo dõi bão tuyết',
    'Winter Weather Advisory': 'Khuyến cáo thời tiết mùa đông', 'Ice Storm Warning': 'Cảnh báo mưa băng',
    'Blizzard Warning': 'Cảnh báo bão tuyết lớn', 'Wind Advisory': 'Khuyến cáo gió mạnh',
    'High Wind Warning': 'Cảnh báo gió rất mạnh', 'High Wind Watch': 'Theo dõi gió rất mạnh',
    'Heat Advisory': 'Khuyến cáo nắng nóng', 'Excessive Heat Warning': 'Cảnh báo nắng nóng gay gắt',
    'Extreme Heat Warning': 'Cảnh báo nắng nóng gay gắt', 'Extreme Heat Watch': 'Theo dõi nắng nóng gay gắt',
    'Freeze Warning': 'Cảnh báo băng giá', 'Freeze Watch': 'Theo dõi băng giá', 'Frost Advisory': 'Khuyến cáo sương giá',
    'Dense Fog Advisory': 'Khuyến cáo sương mù dày', 'Air Quality Alert': 'Cảnh báo chất lượng không khí',
    'Hurricane Warning': 'Cảnh báo bão', 'Hurricane Watch': 'Theo dõi bão',
    'Tropical Storm Warning': 'Cảnh báo bão nhiệt đới', 'Tropical Storm Watch': 'Theo dõi bão nhiệt đới',
    'Cold Weather Advisory': 'Khuyến cáo trời rét', 'Wind Chill Advisory': 'Khuyến cáo trời rét',
    'Extreme Cold Warning': 'Cảnh báo rét đậm', 'Wind Chill Warning': 'Cảnh báo rét đậm',
    'Special Weather Statement': 'Thông báo thời tiết đặc biệt'
  };

  /** The ones that close the screensaver: danger to life, now or soon. */
  var URGENT = /^(Tornado Warning|Severe Thunderstorm Warning|Flash Flood Warning|Extreme Wind Warning|Hurricane Warning|Tsunami Warning|Blizzard Warning|Ice Storm Warning|Extreme Heat Warning|Excessive Heat Warning|Dust Storm Warning)$/;

  function vi() { return window.I18N && I18N.lang === 'vi'; }

  /** "warning" (red), "watch" (orange) or "advisory" (yellow), from the event's name, else its severity. */
  function level(event, severity) {
    if (/Warning$/.test(event) || severity === 'Extreme') return 'warning';
    if (/Watch$/.test(event) || severity === 'Severe') return 'watch';
    return 'advisory';
  }

  var RANK = {warning: 0, watch: 1, advisory: 2};

  function parse(json) {
    var data = JSON.parse(json), out = [], seen = {};
    var features = data.features || [];
    for (var i = 0; i < features.length; i++) {
      var p = features[i].properties || {};
      if (!p.event || p.status === 'Test' || p.messageType === 'Cancel') continue;
      var ends = Date.parse(p.ends || p.expires || '') || 0;
      if (ends && ends < new Date().getTime()) continue;
      if (seen[p.event]) continue;   // the same event from several offices or updates: the newest one is enough
      seen[p.event] = true;
      out.push({id: p.id || p.event, event: p.event, level: level(p.event, p.severity), urgent: URGENT.test(p.event),
        ends: ends, headline: p.headline || '', text: String(p.description || '').replace(/\s+/g, ' ').slice(0, 400),
        instruction: String(p.instruction || '').replace(/\s+/g, ' ').slice(0, 300)});
    }
    out.sort(function (a, b) { return RANK[a.level] - RANK[b.level] || (a.ends || 9e15) - (b.ends || 9e15); });
    return out;
  }

  /** Asks again when the last answer is 5 minutes old; changed(newUrgent) runs when the list changed. */
  function refresh(lat, lon, changed) {
    var now = new Date().getTime();
    lastChanged = changed;
    if (asking || (at && now - at < EVERY) || !lat || !lon) return;
    asking = true;
    var x = new XMLHttpRequest(), over = false;
    x.open('GET', 'https://api.weather.gov/alerts/active?point=' + (+lat).toFixed(4) + ',' + (+lon).toFixed(4), true);
    x.setRequestHeader('Accept', 'application/geo+json');
    x.timeout = 15000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      asking = false;
      if (x.status !== 200) return;   // keep what we had; ask again next time
      var next;
      try { next = parse(x.responseText); } catch (e) { return; }
      at = new Date().getTime();
      apply(next, changed);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; asking = false; } };
    try { x.send(); } catch (e) { over = true; asking = false; }
  }

  function apply(next, changed) {
    var before = {}, fresh = false, same = next.length === list.length;
    for (var i = 0; i < list.length; i++) before[list[i].id] = true;
    for (var j = 0; j < next.length; j++) {
      if (!before[next[j].id]) { same = false; if (next[j].urgent) fresh = true; }
    }
    list = next;
    if (!same && changed) changed(fresh);
  }

  function name(a) { return vi() && VI[a.event] ? VI[a.event] : a.event; }

  /** "until 7:45 PM" / "đến 7:45 PM", with the weekday when it ends on another day. */
  function until(a) {
    if (!a.ends) return '';
    var d = new Date(a.ends), today = new Date();
    var when = (d.toDateString() !== today.toDateString() ? Data.weekday(a.ends) + ' ' : '') + Data.time(a.ends);
    return (vi() ? 'đến ' : 'until ') + when;
  }

  return {
    refresh: refresh,
    list: function () { return list; },
    name: name,
    until: until,
    title: function () { return vi() ? 'Cảnh báo thời tiết' : 'Weather alert'; },
    // For trying the banner on the TV through the Web Inspector: Alerts.show([...], changed).
    show: function (items) { at = new Date().getTime(); apply(items, lastChanged); }
  };
})();
