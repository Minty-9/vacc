// Shared Firebase Admin init — required by every function below.
// Reads the full service account JSON from the FIREBASE_SERVICE_ACCOUNT env var.
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

module.exports = admin;
