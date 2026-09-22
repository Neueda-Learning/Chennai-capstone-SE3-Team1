import { Test, TestingModule } from '@nestjs/testing';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PasswordService],
    }).compile();

    service = module.get<PasswordService>(PasswordService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('correct password verifies', async () => {
    const hash = await service.hash('StrongPass123!');
    expect(await service.verify('StrongPass123!', hash)).toBe(true);
  });

  it('incorrect password fails verification', async () => {
    const hash = await service.hash('StrongPass123!');
    expect(await service.verify('WrongPass123!', hash)).toBe(false);
  });

  it('does not use MD5/SHA - uses argon2id', async () => {
    const hash = await service.hash('password');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toMatch(/^[a-f0-9]{32}$/); // MD5
    expect(hash).not.toMatch(/^[a-f0-9]{40}$/); // SHA1
    expect(hash).not.toMatch(/^[a-f0-9]{64}$/); // SHA256
  });

  it('verification takes ~100ms (defensible cost)', async () => {
    const hash = await service.hash('password');
    const start = Date.now();
    await service.verify('password', hash);
    const elapsed = Date.now() - start;
    // Lower threshold for CI environments; argon2id with m=65536,t=3,p=4 targets ~100ms
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThanOrEqual(200);
  });

  it('needsRehash detects old version', () => {
    const oldHash = '$argon2id$v=19$m=16384,t=1,p=1$salt$hash';
    expect(service.needsRehash(oldHash)).toBe(true);
  });

  it('needsRehash returns false for current params', async () => {
    const hash = await service.hash('password');
    expect(service.needsRehash(hash)).toBe(false);
  });
});
