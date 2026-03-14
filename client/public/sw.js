const CACHE_NAME = 'grammie-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  if (url.pathname === '/share-receiver' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }
});

async function handleShareTarget(request) {
  const formData = await request.formData();
  const files = formData.getAll('images');
  const text = formData.get('text') || '';
  const url = formData.get('url') || '';
  const title = formData.get('title') || '';
  
  const sharedData = {
    files: [],
    text: text.toString(),
    url: url.toString(),
    title: title.toString(),
    timestamp: Date.now(),
  };
  
  if (files && files.length > 0) {
    for (const file of files) {
      if (file instanceof File && file.size > 0) {
        const arrayBuffer = await file.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        sharedData.files.push({
          name: file.name,
          type: file.type,
          size: file.size,
          base64: base64,
        });
      }
    }
  }
  
  const cache = await caches.open('share-target-cache');
  await cache.put('pending-share', new Response(JSON.stringify(sharedData)));
  
  const existingClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  
  for (const client of existingClients) {
    client.postMessage({
      type: 'SHARE_TARGET_DATA',
      data: sharedData,
    });
  }
  
  return Response.redirect('/?shared=true', 303);
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CHECK_PENDING_SHARE') {
    handlePendingShare(event.source);
  }
});

async function handlePendingShare(client) {
  try {
    const cache = await caches.open('share-target-cache');
    const response = await cache.match('pending-share');
    if (response) {
      const data = await response.json();
      client.postMessage({
        type: 'SHARE_TARGET_DATA',
        data: data,
      });
      await cache.delete('pending-share');
    }
  } catch (e) {
    console.error('Error handling pending share:', e);
  }
}
