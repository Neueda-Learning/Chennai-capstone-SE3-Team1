import { Algorithm, Options } from '@node-rs/argon2';

export const ARGON2_PARAMS: Options = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
  algorithm: Algorithm.Argon2id,
} as const;

export type Argon2Params = typeof ARGON2_PARAMS;
