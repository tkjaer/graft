/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_CLIENT_ID: string;
  readonly VITE_AUTH_PROXY_URL: string;
  readonly VITE_SYNC_SERVER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
