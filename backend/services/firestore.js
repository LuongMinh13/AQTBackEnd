/**
 * Client Firestore partagé (initialisation paresseuse).
 *
 * Le SDK `@google-cloud/firestore` n'est chargé qu'au premier appel à
 * `getFirestore()`. Quand `STORAGE=json` (local), cette fonction n'est jamais
 * invoquée et le SDK n'est pas exécuté — utile pour ne pas dépendre d'une
 * authentification GCP en environnement de dev.
 *
 * Authentification :
 *   - Sur Cloud Run : Application Default Credentials du service account
 *     associé au service. Aucune variable d'environnement requise au-delà
 *     éventuellement de GOOGLE_CLOUD_PROJECT.
 *   - En local (rare, on garde JSON) : `gcloud auth application-default login`.
 */

let _firestore = null;

export async function getFirestore() {
  if (_firestore) return _firestore;
  const { Firestore } = await import("@google-cloud/firestore");
  _firestore = new Firestore({
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      undefined,
    databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
  });
  return _firestore;
}

/**
 * Indique si le backend de persistance demandé est Firestore.
 * Lecture dynamique de la variable d'environnement à chaque appel pour
 * faciliter les tests (override possible dans un test runner).
 */
export function isFirestoreStorage() {
  return (process.env.STORAGE || "json").toLowerCase() === "firestore";
}
