// Variables mínimas para que config.ts valide.
// Los tests unitarios no necesitan base de datos (DATABASE_URL falsa).
// Los de integración (tests/integration) usan una base REAL si defines TEST_DATABASE_URL:
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5433/educa_test pnpm test
process.env.NODE_ENV     = 'test'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET   = 'x'.repeat(48)
