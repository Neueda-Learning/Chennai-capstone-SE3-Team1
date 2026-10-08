import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';
import {
  resetServicesConfig,
  serviceAddress,
  serviceHost,
  servicePort,
  serviceSetting,
  servicesConfig,
  servicesConfigFile,
  serviceUrl,
} from './service-config';

describe('service-config', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    resetServicesConfig();
  });

  function configIn(content: string): string {
    const root = mkdtempSync(join(tmpdir(), 'services-config-'));
    const dir = join(root, 'Application', 'Config');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'services.env');
    writeFileSync(file, content);
    process.env.SERVICES_CONFIG_FILE = file;
    resetServicesConfig();
    return file;
  }

  it('builds hosts, ports, addresses and URLs from the HOST and PORT of a service', () => {
    configIn('TRADE_API_HOST=trade.example\nTRADE_API_PORT=8081\n');

    expect(serviceHost('TRADE_API')).toBe('trade.example');
    expect(servicePort('TRADE_API')).toBe(8081);
    expect(serviceAddress('TRADE_API')).toBe('trade.example:8081');
    expect(serviceUrl('TRADE_API')).toBe('http://trade.example:8081');
    expect(serviceUrl('TRADE_API', 'https')).toBe('https://trade.example:8081');
  });

  it('prefers an environment variable (which is where .env ends up) over the file', () => {
    configIn('KAFKA_PORT=29092\n');
    process.env.KAFKA_PORT = '39092';

    expect(servicePort('KAFKA')).toBe(39092);
  });

  it('says where a missing value belongs instead of guessing one', () => {
    configIn('KAFKA_PORT=29092\n');
    delete process.env.NO_SUCH_SERVICE_PORT;

    expect(() => serviceSetting('NO_SUCH_SERVICE_PORT')).toThrow(/Application\/Config\/services\.env/);
  });

  it('uses SERVICES_CONFIG_FILE when it is set, and nothing when that file does not exist', () => {
    const file = configIn('A=1\n');
    expect(servicesConfigFile()).toBe(file);
    expect(servicesConfig().A).toBe('1');

    process.env.SERVICES_CONFIG_FILE = join(tmpdir(), 'no-such-services.env');
    resetServicesConfig();
    expect(servicesConfigFile()).toBeNull();
    expect(servicesConfig()).toEqual({});
  });

  it('finds the repository services.env by walking up from the working directory', () => {
    delete process.env.SERVICES_CONFIG_FILE;
    resetServicesConfig();

    const file = servicesConfigFile() as string;
    expect(basename(file)).toBe('services.env');
    expect(basename(dirname(file))).toBe('Config');
    expect(servicePort('AUTH_SERVICE')).toBeGreaterThan(0);
  });
});
