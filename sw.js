/*
 * 间隔复习助手 —— Service Worker
 *
 * 目标：把应用外壳缓存起来，断网也能打开、也能查数据（业务数据在 IndexedDB 里）。
 *
 * 策略：
 *   install  ：预缓存核心资源（HTML / manifest / 图标），装完立刻接管
 *   activate ：清理旧版本缓存
 *   fetch    ：页面导航「先网络后缓存」——能连网时拿最新版，断网时回退缓存的 index.html
 *              静态资源「先缓存后网络」——秒开，同时后台更新
 *   SPA 回退 ：/library、/calendar 这类前端路由，离线时统一回到 index.html
 */

const CACHE_VERSION = "spaced-review-v3";

/**
 * 部署根路径：SW 自己的地址是 <base>sw.js，所以取它的目录即可。
 * 根域名部署 → "/"，GitHub Pages 项目站点 → "/仓库名/"。
 */
const BASE = new URL("./", self.location).pathname;

/** 核心资源：应用外壳，安装时缓存 */
const APP_SHELL = [
  BASE,
  `${BASE}index.html`,
  `${BASE}manifest.json`,
  `${BASE}icons/icon.svg`,
  `${BASE}icons/icon-192.png`,
  `${BASE}icons/icon-512.png`,
  `${BASE}icons/icon-maskable-512.png`,
  `${BASE}icons/apple-touch-icon.png`,
];

const INDEX_URL = `${BASE}index.html`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // 逐个缓存：个别资源失败不影响整个安装
      await Promise.all(
        APP_SHELL.map(async (path) => {
          try {
            await cache.add(new Request(path, { cache: "reload" }));
          } catch {
            // 忽略单个资源失败
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 只处理本站的 GET 请求
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // 1) 页面导航：先网络（拿到最新版本），失败回退缓存的 index.html
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // 深链接（/library 等）返回的也是 index.html，统一缓存成 index.html
          (await caches.open(CACHE_VERSION)).put(INDEX_URL, response.clone());
          return response;
        } catch {
          const cached = (await caches.match(INDEX_URL)) ?? (await caches.match(BASE));
          return (
            cached ??
            new Response("离线中，连网后即可继续使用。", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
    return;
  }

  // 2) 静态资源：先缓存后网络，同时后台更新
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.status === 200 && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached ?? network;
    })(),
  );
});

/** 页面可以主动要求「立即启用新版本」 */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/** 预留：将来接入服务端推送（真正的手机推送通知） */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "间隔复习助手", body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? "间隔复习助手", {
      body: payload.body ?? "今天有内容需要复习。",
      icon: `${BASE}icons/icon-192.png`,
      badge: `${BASE}icons/icon-192.png`,
    }),
  );
});
