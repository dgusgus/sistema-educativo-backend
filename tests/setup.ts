// Variables mínimas para que config.ts valide sin necesitar un .env ni PostgreSQL.
process.env.NODE_ENV     = 'test'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET   = 'x'.repeat(48)
