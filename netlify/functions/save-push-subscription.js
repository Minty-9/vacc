// Called by the browser right after a student grants notification permission.
// Stores the PushSubscription under push_subscriptions/{uid}/devices/{deviceId}
// so send-push.js can look up every device belonging to every student later.
// Same uid-trust pattern as claim-payment.js — no Firebase ID token check here,
// consistent with the rest of this app's functions.
const crypto = require('crypto');
const admin = require('./_firebaseAdmin');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body' }) };
  }

  const { uid, subscription } = payload;
  if (!uid || !subscription || !subscription.endpoint) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing uid or subscription' }) };
  }

  try {
    const db = admin.firestore();
    // Device id is a hash of the endpoint so resubscribing (e.g. after the
    // browser rotates the push endpoint) overwrites the old row instead of
    // piling up duplicates.
    const deviceId = crypto.createHash('sha256').update(subscription.endpoint).digest('hex').slice(0, 40);
    await db.collection('push_subscriptions').doc(uid).collection('devices').doc(deviceId)
      .set({
        subscription,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('save-push-subscription error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server error saving subscription' }) };
  }
};
