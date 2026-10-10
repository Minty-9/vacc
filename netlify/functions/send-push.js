// Called by the admin dashboard right after an announcement is published.
// Sends a real push notification (lock-screen/OS-level, works even with the
// app closed) to every student who has granted notification permission.
// Plain Web Push (VAPID) — not Firebase Cloud Messaging.
//
// Needs two things set up once:
//   1. Netlify env vars VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
//      (VAPID_PUBLIC_KEY must match the one hardcoded in index.html).
//   2. This function is admin-only: it checks the caller's Firebase ID token
//      for the admin custom claim before sending anything, since it can reach
//      every subscribed student at once.
const webpush = require('web-push');
const admin = require('./_firebaseAdmin');

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  vapidConfigured = true;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Missing Authorization header' }) };
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!decoded.admin) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Admin only' }) };
    }
  } catch (err) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid or expired session' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body' }) };
  }

  const { title, body, url } = payload;
  if (!title) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing title' }) };
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Push notifications are not configured yet (missing VAPID keys).' }) };
  }
  ensureVapid();

  try {
    const db = admin.firestore();
    const usersSnap = await db.collection('push_subscriptions').listDocuments();
    const notifPayload = JSON.stringify({ title, body: body || '', url: url || '/' });

    let sent = 0, removed = 0, failed = 0;
    for (const userDocRef of usersSnap) {
      const devicesSnap = await userDocRef.collection('devices').get();
      for (const deviceDoc of devicesSnap.docs) {
        const { subscription } = deviceDoc.data();
        try {
          await webpush.sendNotification(subscription, notifPayload);
          sent++;
        } catch (err) {
          // 404/410 = the browser dropped this subscription (uninstalled, revoked
          // permission, etc). Clean it up so we stop trying it forever.
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            await deviceDoc.ref.delete();
            removed++;
          } else {
            console.error('send-push: failed for one device:', err && err.message);
            failed++;
          }
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, sent, removed, failed }) };
  } catch (err) {
    console.error('send-push error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server error sending push notifications' }) };
  }
};
