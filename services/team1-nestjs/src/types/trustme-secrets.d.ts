declare module 'trustme-secrets' {
  export class TrustMeError extends Error {}

  export interface TrustMeClient {
    readonly appId: string;
    fetch(secretName: string): Promise<string>;
  }

  export function using(keyFile?: string, password?: string): Promise<TrustMeClient>;
  export function forget(keyFile: string): Promise<boolean>;
  export function get(secretName: string): Promise<string>;

  const trustme: {
    get: typeof get;
    using: typeof using;
    forget: typeof forget;
    TrustMeError: typeof TrustMeError;
  };
  export default trustme;
}
