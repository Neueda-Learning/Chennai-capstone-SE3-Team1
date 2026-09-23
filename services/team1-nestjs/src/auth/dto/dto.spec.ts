import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterRequestDto } from './register-request.dto';
import { LoginRequestDto } from './login-request.dto';
import { RefreshRequestDto } from './refresh-request.dto';

describe('RegisterRequestDto validation', () => {
  it('accepts a valid registration body', async () => {
    const dto = plainToInstance(
      RegisterRequestDto,
      {
        username: 'priya.menon',
        password: 'correct horse battery staple',
        accountId: 1,
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
        accountId: 1,
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
        accountId: 1,
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
        accountId: 1,
      },
      { enableImplicitConversion: true },
    ) as RegisterRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejects a non-positive accountId', async () => {
    const dto = plainToInstance(
      RegisterRequestDto,
      {
        username: 'priya.menon',
        password: 'correct horse battery staple',
        accountId: 0,
      },
      { enableImplicitConversion: true },
    ) as RegisterRequestDto;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'accountId')).toBe(true);
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
    expect(errors.some((e) => e.property === 'accountId')).toBe(true);
  });

  it('rejects roles values outside the Role enum', async () => {
    const dto = plainToInstance(
      RegisterRequestDto,
      {
        username: 'priya.menon',
        password: 'correct horse battery staple',
        accountId: 1,
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
