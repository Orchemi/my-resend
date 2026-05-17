/**
 * Unit tests for database Pool construction guard.
 *
 * `database.ts` constructs the Pool lazily on first access so that importing
 * the module for types / unit tests does not require DATABASE_URL — but the
 * first real use throws with a clear, actionable message instead of falling
 * through to libpq defaults.
 *
 * @jest-environment node
 */

describe('database module — DATABASE_URL guard', () => {
  const originalEnv = process.env.DATABASE_URL;

  afterEach(() => {
    jest.resetModules();
    if (originalEnv === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalEnv;
    }
  });

  it('throws a clear error when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;

    // Mock pg so the import itself does not pull a real driver at construction.
    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({ connect: jest.fn(), end: jest.fn() })),
    }));

    const { query } = await import('../database');

    await expect(query('SELECT 1')).rejects.toThrow(/DATABASE_URL is not set/);
  });

  it('constructs the Pool lazily when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    const poolFactory = jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [{ now: 'mock' }] }),
        release: jest.fn(),
      }),
      end: jest.fn(),
    }));
    jest.doMock('pg', () => ({ Pool: poolFactory }));

    const { query } = await import('../database');

    // Importing alone should not have constructed the Pool.
    expect(poolFactory).not.toHaveBeenCalled();

    await query('SELECT NOW() as now');

    expect(poolFactory).toHaveBeenCalledTimes(1);
    expect(poolFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgresql://test:test@localhost:5432/test',
      })
    );
  });

  it('disables SSL by default for plain connection strings', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    delete process.env.PGSSLMODE;

    const poolFactory = jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue({ query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() }),
    }));
    jest.doMock('pg', () => ({ Pool: poolFactory }));

    const { query } = await import('../database');
    await query('SELECT 1');

    expect(poolFactory).toHaveBeenCalledWith(expect.objectContaining({ ssl: false }));
  });

  it('enables SSL (no cert verification) when sslmode=require is in the URL', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@example.com:5432/test?sslmode=require';
    delete process.env.PGSSLMODE;

    const poolFactory = jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue({ query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() }),
    }));
    jest.doMock('pg', () => ({ Pool: poolFactory }));

    const { query } = await import('../database');
    await query('SELECT 1');

    expect(poolFactory).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: false } })
    );
  });

  it('enables strict SSL when sslmode=verify-full is in the URL', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@example.com:5432/test?sslmode=verify-full';
    delete process.env.PGSSLMODE;

    const poolFactory = jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue({ query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() }),
    }));
    jest.doMock('pg', () => ({ Pool: poolFactory }));

    const { query } = await import('../database');
    await query('SELECT 1');

    expect(poolFactory).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: true } })
    );
  });

  it('PGSSLMODE env takes precedence over the URL parameter', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@example.com:5432/test?sslmode=disable';
    process.env.PGSSLMODE = 'require';

    const poolFactory = jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue({ query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() }),
    }));
    jest.doMock('pg', () => ({ Pool: poolFactory }));

    const { query } = await import('../database');
    await query('SELECT 1');

    expect(poolFactory).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: false } })
    );

    delete process.env.PGSSLMODE;
  });

  it('does not reconstruct the Pool on subsequent queries', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    const poolFactory = jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      }),
      end: jest.fn(),
    }));
    jest.doMock('pg', () => ({ Pool: poolFactory }));

    const { query } = await import('../database');

    await query('SELECT 1');
    await query('SELECT 2');
    await query('SELECT 3');

    expect(poolFactory).toHaveBeenCalledTimes(1);
  });
});
