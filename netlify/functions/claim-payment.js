// Called by the main app right after someone creates an account (or logs in)
// following a guest checkout. Looks up the pending payment by reference,
// confirms it belongs to this account's email, and turns it into a real
// enrollment — the same unlock path real logged-in payments use.
const admin = require('./_firebaseAdmin');
const { unlockEnrollment } = require('./_unlockEnrollment');

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

  const { reference, uid } = payload;
  if (!reference || !uid) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing reference or uid' }) };
  }

  try {
    const db = admin.firestore();
    const payRef = db.collection('pending_payments').doc(reference);
    const paySnap = await payRef.get();
    if (!paySnap.exists) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'No pending payment found for this reference' }) };
    }
    const pay = paySnap.data();
    if (pay.claimed) {
      return { statusCode: 200, body: JSON.stringify({ success: false, error: 'This payment has already been claimed' }) };
    }

    const userRecord = await admin.auth().getUser(uid);
    if (userRecord.email && pay.email && userRecord.email.toLowerCase() !== pay.email.toLowerCase()) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'This payment was made with a different email address than this account' }) };
    }

    await unlockEnrollment(db, uid, pay.course_id, pay.amount, reference);
    await payRef.update({ claimed: true, claimed_by: uid, claimed_at: admin.firestore.FieldValue.serverTimestamp() });

    return { statusCode: 200, body: JSON.stringify({ success: true, courseId: pay.course_id }) };
  } catch (err) {
    console.error('claim-payment error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server error claiming payment' }) };
  }
};
