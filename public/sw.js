self.addEventListener("install", function (event) {
  // 新しいバージョンをすぐに有効化する（古いSWが居座り続けるのを防ぐ）
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  // 有効化したら、開いているタブの制御もすぐに引き継ぐ
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "練習ノート", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "練習ノート";
  const options = {
    body: data.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
