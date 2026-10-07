import { loadDotEnv } from './secrets';

// Imported first by main.ts, so the repository's .env is in process.env before AppModule (and its
// ConfigModule) is evaluated. A real environment variable always wins over the file.
loadDotEnv();
