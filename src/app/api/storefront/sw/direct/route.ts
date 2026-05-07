import { NextResponse } from 'next/server';

import { env } from '@/lib/config/env';

export const runtime = 'nodejs';

const serviceWorkerSource = `
importScripts('https://www.gstatic.com/firebasejs/9.2.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.2.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: '${env.NEXT_PUBLIC_FIREBASE_API_KEY}',
  authDomain: '${env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}',
  projectId: '${env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}',
  storageBucket: '${env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}',
  messagingSenderId: '${env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}',
  appId: '${env.NEXT_PUBLIC_FIREBASE_APP_ID}',
  measurementId: '${env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID}'
});

firebase.messaging();

function sendTrackingBeacon(trackUrl) {
  if (!trackUrl) {
    return Promise.resolve();
  }

  return fetch(trackUrl, {
    method: 'GET',
    mode: 'no-cors',
    credentials: 'omit',
    cache: 'no-store',
    keepalive: true,
  }).catch(function() {
    // Ignore tracking failures so click-through always works.
  });
}

function buildPushEagleActions(payload) {
  const notificationActions = Array.isArray(payload.notification?.actions)
    ? payload.notification.actions
    : [];

  if (notificationActions.length > 0) {
    return notificationActions.slice(0, 2).filter(function(action) {
      return action && action.action && action.title;
    });
  }

  const data = payload.data || {};
  const fallbackActions = [];

  if (data.action1Title && data.button1Url) {
    fallbackActions.push({ action: 'btn_1', title: String(data.action1Title) });
  }
  if (data.action2Title && data.button2Url) {
    fallbackActions.push({ action: 'btn_2', title: String(data.action2Title) });
  }

  return fallbackActions;
}

self.addEventListener('push', function(event) {
  if (!event.data) {
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch (_parseError) {
    payload = { notification: { title: event.data.text() } };
  }

  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || 'Push Eagle';
  const url = data.url || '';
  const button1Url = data.button1Url || '';
  const button2Url = data.button2Url || '';
  const trackPrimaryUrl = data.trackPrimaryUrl || '';
  const trackButton1Url = data.trackButton1Url || '';
  const trackButton2Url = data.trackButton2Url || '';

  const options = {
    body: notification.body,
    icon: notification.icon,
    badge: notification.badge,
    image: notification.image,
    tag: notification.tag || 'push-eagle-notification',
    requireInteraction: false,
    actions: buildPushEagleActions(payload),
    data: {
      url,
      button1Url,
      button2Url,
      trackPrimaryUrl,
      trackButton1Url,
      trackButton2Url
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = '';

  if (event.action === 'btn_1' && data.button1Url) {
    targetUrl = data.button1Url;
    sendTrackingBeacon(data.trackButton1Url);
  } else if (event.action === 'btn_2' && data.button2Url) {
    targetUrl = data.button2Url;
    sendTrackingBeacon(data.trackButton2Url);
  } else {
    targetUrl = data.url;
    sendTrackingBeacon(data.trackPrimaryUrl);
  }

  if (targetUrl) {
    event.waitUntil(clients.matchAll({ type: 'window' }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    }));
  }
});
`;

export async function GET(request: Request) {
  const response = new NextResponse(serviceWorkerSource, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });

  return response;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
