// The app's base path: "" when served at the root, "/apps/chess" inside Vela.
// studio.py puts a relative <base href> in every page (see app_page), so the
// document's base URL is always the app root, whatever proxy prefix is in front.
export function appBasename(): string {
  const path = new URL(document.baseURI).pathname.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

// Absolute URL for a public asset, resolved against the app root. Needed for
// images fed to CSS via inline custom properties (e.g. mask-image): relative
// url() tokens in custom properties resolve against the consuming stylesheet
// in /assets/, not against the document base, so they 404 in the built app.
export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}
