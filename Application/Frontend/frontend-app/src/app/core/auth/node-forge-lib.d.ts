// node-forge ships types only for its index; these are the sub-paths credential-envelope.ts
// imports so the bundle carries just AES, RSA and SHA-256.
declare module 'node-forge/lib/forge' {
  import forge from 'node-forge';
  export default forge;
}
declare module 'node-forge/lib/aes';
declare module 'node-forge/lib/rsa';
declare module 'node-forge/lib/sha256';
