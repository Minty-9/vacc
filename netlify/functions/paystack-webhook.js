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
    const guestEmail = meta.guestEmail;

    try {
      const db = admin.firestore();
      if (uid && courseId) {
        // Logged-in checkout: unlock the enrollment directly.
        await unlockEnrollment(db, uid, courseId, (data.amount || 0) / 100, data.reference);
      } else if (guestEmail && courseId) {
        // Guest checkout (e.g. a bank transfer that didn't confirm in time for
        // verify-guest-payment's short retry window). Record the pending payment
        // the same way verify-guest-payment.js does, so claim-payment.js can pick
        // it up whenever the student finishes signing up — merge, never overwrite,
        // in case verify-guest-payment already wrote it first.
        await db.collection('pending_payments').doc(data.reference).set({
          email: String(guestEmail).toLowerCase().trim(),
          course_id: courseId,
          amount: (data.amount || 0) / 100,
          payment_ref: data.reference,
          claimed: false,
          created_at: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    } catch (err) {
      // Log for manual follow-up, but still acknowledge receipt below so Paystack
      // doesn't retry indefinitely on an error that's on our end, not theirs.
      console.error('paystack-webhook unlock error:', err);
    }
  }

  return { statusCode: 200, body: 'ok' };
};
