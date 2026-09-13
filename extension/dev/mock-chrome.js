/**
 * mock-chrome.js —— 预览用的 Chromium API 垫片（普通脚本，非模块）
 *
 * 作用：让 manager.html 直接双击就能在普通浏览器里跑起来看效果。
 * 安全：检测到真实的 chrome.bookmarks（即已作为扩展加载）时立刻返回，不做任何干预。
 */
(function () {
  if (window.chrome && window.chrome.bookmarks) return; // 真实扩展环境
  if (!window.__DEMO_TREE) return;

  var tree = JSON.parse(JSON.stringify(window.__DEMO_TREE));
  var nextId = 900000;
  var index = new Map();

  function reindex() {
    index.clear();
    (function walk(n) {
      index.set(n.id, n);
      (n.children || []).forEach(walk);
    })(tree);
  }
  reindex();

  function clone(n) { return JSON.parse(JSON.stringify(n)); }
  function detach(id) {
    var n = index.get(id);
    if (!n) return null;
    var p = index.get(n.parentId);
    if (p && p.children) p.children = p.children.filter(function (c) { return c.id !== id; });
    return n;
  }

  window.chrome = window.chrome || {};

  window.chrome.runtime = {
    id: 'preview',
    getURL: function () { return ''; },
    openOptionsPage: function () {},
    onInstalled: { addListener: function () {} },
    onStartup: { addListener: function () {} }
  };

  window.chrome.tabs = {
    create: function () {},
    update: function () {},
    query: function () { return Promise.resolve([]); }
  };

  var store = {};
  window.chrome.storage = {
    local: {
      get: function (k) {
        if (typeof k === 'string') { var o = {}; o[k] = store[k]; return Promise.resolve(o); }
        if (Array.isArray(k)) { var r = {}; k.forEach(function (x) { r[x] = store[x]; }); return Promise.resolve(r); }
        return Promise.resolve(Object.assign({}, store));
      },
      set: function (o) { Object.assign(store, o); return Promise.resolve(); },
      remove: function (k) { delete store[k]; return Promise.resolve(); }
    }
  };

  window.chrome.bookmarks = {
    getTree: function () { return Promise.resolve([clone(tree)]); },

    getChildren: function (id) {
      var n = index.get(id);
      return Promise.resolve((n && n.children ? n.children : []).map(clone));
    },

    get: function (id) {
      var n = index.get(id);
      if (!n) return Promise.reject(new Error('Can not find bookmark with id ' + id));
      return Promise.resolve([clone(n)]);
    },

    create: function (opt) {
      var node = opt.url
        ? { id: String(nextId++), parentId: opt.parentId, title: opt.title, url: opt.url, dateAdded: Date.now() }
        : { id: String(nextId++), parentId: opt.parentId, title: opt.title, children: [], dateAdded: Date.now() };
      index.set(node.id, node);
      var p = index.get(opt.parentId);
      if (p) { p.children = p.children || []; p.children.push(node); }
      return Promise.resolve(clone(node));
    },

    move: function (id, opt) {
      var n = detach(id);
      if (!n) return Promise.reject(new Error('Can not find bookmark with id ' + id));
      var p = index.get(opt.parentId);
      if (p) { p.children = p.children || []; p.children.push(n); n.parentId = opt.parentId; }
      return Promise.resolve(clone(n));
    },

    remove: function (id) {
      var n = detach(id);
      if (!n) return Promise.reject(new Error('Can not find bookmark with id ' + id));
      index.delete(id);
      return Promise.resolve();
    },

    removeTree: function (id) {
      var n = detach(id);
      if (!n) return Promise.reject(new Error('Can not find bookmark with id ' + id));
      (function del(x) {
        index.delete(x.id);
        (x.children || []).forEach(del);
      })(n);
      return Promise.resolve();
    },

    update: function (id, opt) {
      var n = index.get(id);
      if (!n) return Promise.reject(new Error('Can not find bookmark with id ' + id));
      if (opt.title != null) n.title = opt.title;
      if (opt.url != null) n.url = opt.url;
      return Promise.resolve(clone(n));
    },

    onCreated: { addListener: function () {} },
    onRemoved: { addListener: function () {} },
    onChanged: { addListener: function () {} },
    onMoved: { addListener: function () {} }
  };

  window.__DEMO__ = true;

  // 直接用文件方式打开时，浏览器会以 CORS 为由拦截 ES 模块，这里给出明确提示
  if (location.protocol === 'file:') {
    window.addEventListener('DOMContentLoaded', function () {
      var d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;background:#faeeda;' +
        'color:#633806;padding:10px 16px;font-size:13px;line-height:1.6;font-family:sans-serif;' +
        'border-bottom:1px solid #ba7517';
      d.textContent = '预览提示：以 file:// 方式打开时浏览器会拦截 ES 模块，界面不会渲染。'
        + '请在扩展目录下运行 python -m http.server 8080，然后访问 http://localhost:8080/manager.html；'
        + '或直接在 Edge 的扩展页加载本扩展（推荐）。';
      document.body.appendChild(d);
    });
  }
})();
