import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterRequestDto } from './register-request.dto';
import { LoginRequestDto } from './login-request.dto';
import { RefreshRequestDto } from './refresh-request.dto';
import { EmailRequestDto } from './email-request.dto';
import { VerifyOtpRequestDto } from './verify-otp-request.dto';
import { ResetPasswordRequestDto } from './reset-password-request.dto';

describe('RegisterRequestDto validation', () => {
  it('accepts a valid registration body', async () => {
    const dto = plainToInstance(
      RegisterRequestDto,
      {
        username: 'priya.menon',
        password: 'correct horse battery staple',
        email: 'priya.menon@example.com',
      },
      { enableImplicitConversion: true },
    ) as RegisterRequestDto;
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a username with illegal characters', async () => {
    const dto = plainToInstance(
      RegisterRequestDto,
      {
        username: 'priya@menon!',
        password: 'correct horse battery staple',
        email: 'priya.menon@example.com',
      },
      { enableImplicitConversion: true },
    ) as RegisterRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'username')).toBe(true);
  });

  it('rejects a username shorter than 3 characters', async () => {
    const dto = plainToInstance(
      RegisterRequestDto,
      {
        username: 'ab',
        password: 'correct horse battery staple',
        email: 'priya.menon@example.com',
      },
      { enableImplicitConversion: true },
    ) as RegisterRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'username')).toBe(true);
  });

  it('rejects a password under 12 characters', async () => {
    const dto = plainToInstance(
      RegisterRequestDto,
      {
        username: 'priya.menon',
        password: 'short',
        email: 'priya.menon@example.com',
      },
      { enableImplicitConversion: true },
    ) as RegisterRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejects a malformed email', async () => {
    const dto = plainToInstance(
      RegisterRequestDto,
      {
        username: 'priya.menon',
        password: 'correct horse battery staple',
        email: 'not-an-email',
      },
      { enableImplicitConversion: true },
    ) as RegisterRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('normalises the email to trimmed lower case', () => {
    const dto = plainToInstance(RegisterRequestDto, {
      username: 'priya.menon',
      password: 'correct horse battery staple',
      email: '  Priya.Menon@Example.COM ',
    }) as RegisterRequestDto;
    expect(dto.email).toBe('priya.menon@example.com');
  });

  it('rejects a missing required field', async () => {
    const dto = plainToInstance(
      RegisterRequestDto,
      {
        username: 'priya.menon',
        password: 'correct horse battery staple',
      },
      { enableImplicitConversion: true },
    ) as RegisterRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects roles values outside the Role enum', async () => {
    const dto = plainToInstance(
      RegisterRequestDto,
      {
        username: 'priya.menon',
        password: 'correct horse battery staple',
        email: 'priya.menon@example.com',
        roles: ['SUPERUSER'],
      },
      { enableImplicitConversion: true },
    ) as RegisterRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'roles')).toBe(true);
  });
});

describe('LoginRequestDto validation', () => {
  it('accepts a valid login body', async () => {
    const dto = plainToInstance(
      LoginRequestDto,
      {
        username: 'priya.menon',
        password: 'correct horse battery staple',
      },
      { enableImplicitConversion: true },
    ) as LoginRequestDto;
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing password', async () => {
    const dto = plainToInstance(
      LoginRequestDto,
      { username: 'priya.menon' },
      { enableImplicitConversion: true },
    ) as LoginRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});

describe('RefreshRequestDto validation', () => {
  it('rejects a missing refreshToken', async () => {
    const dto = plainToInstance(
      RefreshRequestDto,
      {},
      { enableImplicitConversion: true },
    ) as RefreshRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'refreshToken')).toBe(true);
  });

  it('accepts a refreshToken', async () => {
    const dto = plainToInstance(
      RefreshRequestDto,
      {
        refreshToken: 'some-opaque-token',
      },
      { enableImplicitConversion: true },
    ) as RefreshRequestDto;
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('EmailRequestDto validation', () => {
  it('lower-cases and trims the address, so codes match however it was typed', async () => {
    const dto = plainToInstance(
      EmailRequestDto,
      { email: '  Priya.Menon@Example.com ' },
      { enableImplicitConversion: true },
    ) as EmailRequestDto;
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.email).toBe('priya.menon@example.com');
  });

  it('rejects an address that is not an email', async () => {
    const dto = plainToInstance(
      EmailRequestDto,
      { email: 'not-an-email' },
      { enableImplicitConversion: true },
    ) as EmailRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});

describe('VerifyOtpRequestDto validation', () => {
  it('accepts an email plus six digits', async () => {
    const dto = plainToInstance(
      VerifyOtpRequestDto,
      { email: 'priya.menon@example.com', otp: '123456' },
      { enableImplicitConversion: true },
    ) as VerifyOtpRequestDto;
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a code that is not exactly six digits', async () => {
    const dto = plainToInstance(
      VerifyOtpRequestDto,
      { email: 'priya.menon@example.com', otp: '12345' },
      { enableImplicitConversion: true },
    ) as VerifyOtpRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'otp')).toBe(true);
  });

  it('rejects letters where digits belong', async () => {
    const dto = plainToInstance(
      VerifyOtpRequestDto,
      { email: 'priya.menon@example.com', otp: '12345a' },
      { enableImplicitConversion: true },
    ) as VerifyOtpRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'otp')).toBe(true);
  });
});

describe('ResetPasswordRequestDto validation', () => {
  const valid = {
    email: 'priya.menon@example.com',
    otp: '123456',
    newPassword: 'correct horse battery7',
  };

  it('accepts an email, a code and a long-enough password', async () => {
    const dto = plainToInstance(ResetPasswordRequestDto, valid, {
      enableImplicitConversion: true,
    }) as ResetPasswordRequestDto;
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a new password under 12 characters', async () => {
    const dto = plainToInstance(
      ResetPasswordRequestDto,
      { ...valid, newPassword: 'short' },
      { enableImplicitConversion: true },
    ) as ResetPasswordRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'newPassword')).toBe(true);
  });

  it('rejects a missing code', async () => {
    const dto = plainToInstance(
      ResetPasswordRequestDto,
      { email: valid.email, newPassword: valid.newPassword },
      { enableImplicitConversion: true },
    ) as ResetPasswordRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'otp')).toBe(true);
  });
});
