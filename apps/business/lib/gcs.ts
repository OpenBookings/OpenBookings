import { Storage } from "@google-cloud/storage";

declare global {
  // eslint-disable-next-line no-var
  var __gcsStorage: Storage | undefined;
}

function createStorage(): Storage {
  return new Storage({
    projectId: process.env.GCS_PROJECT_ID,
    credentials: {
      client_email: process.env.GCS_CLIENT_EMAIL,
      private_key: process.env.GCS_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
  });
}

const storage: Storage = globalThis.__gcsStorage ?? createStorage();
if (process.env.NODE_ENV !== "production") {
  globalThis.__gcsStorage = storage;
}

export function getBucket() {
  return storage.bucket(process.env.GCS_BUCKET_NAME!);
}
