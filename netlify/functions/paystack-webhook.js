// Paystack calls this directly from their servers the moment a payment succeeds —
// independent of the student's browser, so it still works even if they close the
// tab right after paying. This is the reliable backup to verify-payment.js.
//
// Once deployed, paste this function's URL into Paystack Dashboard →
// Settings → API Keys & Webhooks → Webhook URL.
const crypto = require('crypto');
const admin = require('./_firebaseAdmin');
const { unlockEnrollment } = require('./_unlockEnrollment');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : (event.body || '');

  // Confirm this request genuinely came from Paystack, not someone hitting the URL directly.
  const signature = event.headers['x-paystack-signature'] || event.headers['X-Paystack-Signature'];
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  if (!signature || signature !== expected) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (payload.event === 'charge.success') {
    const data = payload.data || {};
    const meta = data.metadata || {};
    const uid = meta.uid;
    const courseId = meta.courseId;
    if (uid && courseId) {
      try {
        const db = admin.firestore();
        await unlockEnrollment(db, uid, courseId, (data.amount || 0) / 100, data.reference);
      } catch (err) {
        // Log for manual follow-up, but still acknowledge receipt below so Paystack
        // doesn't retry indefinitely on an error that's on our end, not theirs.
        console.error('paystack-webhook unlock error:', err);
      }
    }
  }

  return { statusCode: 200, body: 'ok' };
};
