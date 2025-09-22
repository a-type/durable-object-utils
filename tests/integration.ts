import { Hono } from 'hono';
import { ContentfulStatusCode } from 'hono/utils/http-status';
import { getSocketToken } from '../src/socketTokens.js';
import { Env } from './types.js';

// Need to export all Durable Objects so the runtime can find it
export { TestObject } from './TestObject.js';

const app = new Hono<{ Bindings: Env }>()
	.get('/', (c) => c.text('Hello, world!'))
	.post('/test/:id/create', async (c) => {
		const doId = c.env.TEST_OBJECT.idFromName(c.req.param('id')!);
		const stub = c.env.TEST_OBJECT.get(doId);
		const body = await c.req.json();
		const resp = await stub.create(body.name);
		return c.json(resp);
	})
	.get('/test/:id/list', async (c) => {
		const doId = c.env.TEST_OBJECT.idFromName(c.req.param('id')!);
		const stub = c.env.TEST_OBJECT.get(doId);
		const resp = await stub.list();
		return c.json(resp);
	})
	.post('/test/:id/schedule', async (c) => {
		const doId = c.env.TEST_OBJECT.idFromName(c.req.param('id')!);
		const stub = c.env.TEST_OBJECT.get(doId);
		const { name, delay = 1 } = await c.req.json();
		if (!name) {
			return c.text('Missing name parameter', 400);
		}
		const when = new Date(Date.now() + delay * 1000);
		await stub.scheduleCreate(name, when);
		return c.text(`Scheduled user ${name}`);
	})
	.get('/test/:id/socket-token', async (c) => {
		const url = new URL(c.req.url);
		const user = url.searchParams.get('user');
		if (!user) {
			return c.text('Missing user parameter', 400);
		}
		const id = c.req.param('id')!;
		return c.json({
			token: getSocketToken(user, id, c.env.SOCKET_SECRET),
		});
	})
	.all('/test/:id/socket', async (c) => {
		const url = new URL(c.req.url);
		const user = url.searchParams.get('user');
		if (!user) {
			return c.text('Missing user parameter', 400);
		}
		const doId = c.env.TEST_OBJECT.idFromName(c.req.param('id')!);
		const stub = c.env.TEST_OBJECT.get(doId);
		const resp = await stub.fetch(c.req.raw as any);
		if (resp.status !== 200) {
			return c.text(
				'Failed to get WebSocket URL',
				resp.status as ContentfulStatusCode,
			);
		}
		const text = await resp.text();
		return c.text(text);
	});

export default app;
