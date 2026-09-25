/**
 * `html2canvas` is an optional peer dependency reached only through a dynamic
 * import, so it may legitimately be absent at build time. Declaring its export
 * as `unknown` rather than letting it default to `any` keeps the narrowing in
 * `screenshot.ts` honest: the value is checked before it is ever called.
 */
declare module "html2canvas" {
  const html2canvas: unknown;
  export default html2canvas;
}
