import { Injectable } from '@nestjs/common';
import { hash, verify, parseOptions, Algorithm } from '@node-rs/argon2';
import { ARGON2_PARAMS, Argon2Params } from './password.constants';

@Injectable()
export class PasswordService {
  readonly currentParams: Argon2Params = ARGON2_PARAMS;

  async hash(password: string): Promise<string> {
    return hash(password, this.currentParams);
  }

  /**
   * A stored value that is not an argon2 hash (the seed's placeholder, for one) is a
   * failed login, not a crash: the caller must answer AUTH-401 either way.
   */
  async verify(password: string, storedHash: string): Promise<boolean> {
    try {
      return await verify(storedHash, password);
    } catch {
      return false;
    }
  }

  needsRehash(storedHash: string): boolean {
    try {
      const opts = parseOptions(storedHash);
      return (
        opts.memoryCost !== this.currentParams.memoryCost ||
        opts.timeCost !== this.currentParams.timeCost ||
        opts.parallelism !== this.currentParams.parallelism ||
        opts.algorithm !== Algorithm.Argon2id
      );
    } catch {
      return true;
    }
  }
}
