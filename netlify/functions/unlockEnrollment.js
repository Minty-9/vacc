// Shared logic for turning a confirmed Paystack payment into an unlocked enrollment.
// Used by both verify-payment.js (browser callback) and paystack-webhook.js (server-to-server),
// so a payment confirmed twice (both paths firing) never wipes a student's progress.
const admin = require('./_firebaseAdmin');

async function unlockEnrollment(db, uid, courseId, amountNaira, reference) {
  const ref = db.collection('enrollments').doc(uid + '_' + courseId);
  const existing = await ref.get();
  if (existing.exists) {
    // Already enrolled (e.g. webhook + browser callback both fired) — update payment
    // details only, never touch their lesson progress.
    await ref.update({ paid: true, amount: amountNaira, payment_ref: reference });
  } else {
    await ref.set({
      user_id: uid,
      course_id: courseId,
      enrolled_at: admin.firestore.FieldValue.serverTimestamp(),
      completed: [],
      paid: true,
      amount: amountNaira,
      payment_ref: reference
    });
  }
}

module.exports = { unlockEnrollment };
