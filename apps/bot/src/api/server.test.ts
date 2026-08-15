import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer } from './server.js';

let app: Awaited<ReturnType<typeof createApiServer>> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('API server', () => {
  it('starts with the dashboard and API routes registered once', async () => {
    const server = await createApiServer();
    app = server;
    await server.ready();

    const [dashboard, health] = await Promise.all([
      server.inject({ method: 'GET', url: '/' }),
      server.inject({ method: 'GET', url: '/api/health' }),
    ]);

    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.body).toContain('<title>ApexBot</title>');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok' });
  });
});
