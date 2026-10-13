// Wrangler bundles these: .wasm as a compiled WebAssembly.Module, fonts as raw bytes (see wrangler.jsonc rules).
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "*.ttf" {
  const bytes: ArrayBuffer;
  export default bytes;
}
