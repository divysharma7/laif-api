process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/laif-test-not-used'
process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-long-enough'
process.env.CORS_ORIGINS = 'http://localhost:3000'
process.env.LOG_LEVEL = 'silent'
delete process.env.DEV_USER_ID
