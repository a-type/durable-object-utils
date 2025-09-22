import { SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';

it('should respond to a basic request (test env works)', async () => {
	const resp = await SELF.fetch('http://localhost/');
	expect(resp.status).toBe(200);
	const text = await resp.text();
	expect(text).toBe('Hello, world!');
});

it('should store and retrieve SQL data', async () => {
	const createResp = await SELF.fetch('http://localhost/test/a/create', {
		method: 'post',
		body: JSON.stringify({ name: 'Alice' }),
		headers: { 'Content-Type': 'application/json' },
	});
	expect(createResp.status).toBe(200);
	const createText = await createResp.json();
	expect(createText).toEqual({ id: 1, name: 'Alice' });

	const listResp = await SELF.fetch('http://localhost/test/a/list');
	expect(listResp.status).toBe(200);
	const listText = await listResp.json();
	expect(listText).toEqual([{ id: 1, name: 'Alice' }]);
});

it('should schedule and run a task', async () => {
	const scheduleResp = await SELF.fetch('http://localhost/test/a/schedule', {
		method: 'post',
		body: JSON.stringify({
			name: 'Bob',
			delay: 1,
		}),
	});
	expect(scheduleResp.status).toBe(200);
	const scheduleText = await scheduleResp.text();
	expect(scheduleText).toBe('Scheduled user Bob');

	const preTaskResp = await SELF.fetch('http://localhost/test/a/list');
	expect(preTaskResp.status).toBe(200);
	const preTaskBody = await preTaskResp.json();
	expect(preTaskBody.some((u: any) => u.name === 'Bob')).toBe(false);

	// wait a bit for the task to run
	await new Promise((resolve) => setTimeout(resolve, 2000));

	const listResp = await SELF.fetch('http://localhost/test/a/list');
	expect(listResp.status).toBe(200);
	const listBody = await listResp.json();
	expect(listBody.some((u: any) => u.name === 'Bob')).toBe(true);
});

it('should handle a second task scheduled for after a pending one', async () => {
	const scheduleResp1 = await SELF.fetch('http://localhost/test/a/schedule', {
		method: 'post',
		body: JSON.stringify({
			name: 'Charlie',
			delay: 2,
		}),
	});
	expect(scheduleResp1.status).toBe(200);
	const scheduleText1 = await scheduleResp1.text();
	expect(scheduleText1).toBe('Scheduled user Charlie');

	const scheduleResp2 = await SELF.fetch('http://localhost/test/a/schedule', {
		method: 'post',
		body: JSON.stringify({
			name: 'Dave',
			delay: 1,
		}),
	});
	expect(scheduleResp2.status).toBe(200);
	const scheduleText2 = await scheduleResp2.text();
	expect(scheduleText2).toBe('Scheduled user Dave');

	const preTaskResp = await SELF.fetch('http://localhost/test/a/list');
	expect(preTaskResp.status).toBe(200);
	const preTaskBody = await preTaskResp.json();
	expect(preTaskBody.some((u: any) => u.name === 'Charlie')).toBe(false);
	expect(preTaskBody.some((u: any) => u.name === 'Dave')).toBe(false);

	// wait a bit for the tasks to run
	await new Promise((resolve) => setTimeout(resolve, 3000));

	const listResp = await SELF.fetch('http://localhost/test/a/list');
	expect(listResp.status).toBe(200);
	const listBody = await listResp.json();
	expect(listBody.some((u: any) => u.name === 'Charlie')).toBe(true);
	expect(listBody.some((u: any) => u.name === 'Dave')).toBe(true);
});

it.skip('should handle websocket connections', async () => {
	const tokenResp = await SELF.fetch(
		'http://localhost/test/a/socket-token?user=Alice',
	);
	expect(tokenResp.status).toBe(200);
	const tokenJson = (await tokenResp.json()) as any;
	expect(tokenJson.token).toBeDefined();
	const ws = new WebSocket(
		`ws://localhost/test/a/socket?user=Alice&token=${tokenJson.token}`,
	);
	await new Promise((resolve, reject) => {
		ws.onopen = () => resolve(true);
		ws.onerror = (err) => reject(err);
	});
	expect(ws.readyState).toBe(WebSocket.OPEN);

	// send a message
	ws.send(JSON.stringify({ type: 'echo', messageId: '1', text: 'Hello' }));

	const msg = await new Promise((resolve) => {
		ws.onmessage = (event) => resolve(event.data);
	});
	expect(msg).toBe(JSON.stringify({ type: 'echo', text: 'Hello' }));

	ws.close();
});

it.skip('should reject websocket connections with invalid token', async () => {
	// create a websocket connection with an invalid token
	const ws = new WebSocket(
		'ws://localhost/test/a/socket?user=Alice&token=invalidtoken',
	);
	const err = await new Promise((resolve) => {
		ws.onerror = (event) => resolve(event);
	});
	expect(err).toBeDefined();
	expect((err as any).message).toBe(
		'Received network error or non-101 status code.',
	);
});
