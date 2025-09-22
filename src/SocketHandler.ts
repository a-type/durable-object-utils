import { Hono } from 'hono';
import { ZodType } from 'zod';
import { DurableObjectState } from './cloudflareTypes.js';
import { verifySocketToken } from './socketTokens.js';

export interface SocketSessionInfo {
	audience: string;
	subject: string;
	socketId: string;
	status: 'pending' | 'ready' | 'closed';
}

export interface BaseMessage {
	type: string;
	messageId: string;
}

export class SocketHandlerError extends Error {
	constructor(message: string, public code: number) {
		super(message);
		this.name = 'SocketHandlerError';
	}
}

export interface SocketHandlerConfig<
	TServerMessage extends BaseMessage,
	TClientMessage extends BaseMessage,
> {
	tokenSecret: string;
	clientMessageShape: ZodType<TClientMessage>;
	serverMessageShape: ZodType<TServerMessage>;
	messageHandlers: Record<
		TClientMessage['type'],
		(
			msg: TClientMessage,
			info: SocketSessionInfo,
			ws: WebSocket,
		) => Promise<void> | void
	>;
	connectHandler?: (
		info: SocketSessionInfo,
		ws: WebSocket,
	) => Promise<void> | void;
	disconnectHandler?: (
		info: SocketSessionInfo,
		ws: WebSocket,
		error?: Error,
	) => Promise<void> | void;
}

export class SocketHandler<
	TServerMessage extends BaseMessage,
	TClientMessage extends BaseMessage,
> {
	#hono;
	#socketInfo = new Map<WebSocket, SocketSessionInfo>();
	#messageBacklogs = new Map<string, TServerMessage[]>();

	constructor(
		private ctx: DurableObjectState,
		private config: SocketHandlerConfig<TServerMessage, TClientMessage>,
	) {
		this.#hono = this.#createHono();

		// if we've come back from hibernation, we have to repopulate our socket map
		ctx.getWebSockets().forEach((ws) => {
			const data = ws.deserializeAttachment();
			if (data) {
				this.#socketInfo.set(ws, data);
			}
		});
	}

	#createHono = () => {
		return new Hono().all('*', async (ctx) => {
			// expect to receive a Websocket Upgrade request
			const upgradeHeader = ctx.req.header('Upgrade');
			if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
				throw new SocketHandlerError(
					'Expected a WebSocket upgrade request',
					400,
				);
			}

			// validate token and read game session id and user to connect to
			const token = ctx.req.query('token');
			if (!token) {
				throw new SocketHandlerError('Missing token', 400);
			}
			const tokenInfo = await verifySocketToken({
				token,
				secret: this.config.tokenSecret,
				audience: this.ctx.id.toString(),
			});

			const webSocketPair = new WebSocketPair();
			const [client, server] = Object.values(webSocketPair);

			this.ctx.acceptWebSocket(server);

			// map the socket to the token info for later reference.
			const socketInfo: SocketSessionInfo = {
				audience: tokenInfo.aud,
				subject: tokenInfo.sub,
				status: 'pending',
				socketId: crypto.randomUUID(),
			};
			this.#updateSocketInfo(server, socketInfo);

			this.config.connectHandler?.(socketInfo, server);

			return new Response(null, {
				status: 101,
				webSocket: client,
			} as any);
		});
	};

	#updateSocketInfo = (ws: WebSocket, info: SocketSessionInfo) => {
		this.#socketInfo.set(ws, info);
		ws.serializeAttachment(info);
	};

	fetch = (req: Request) => {
		return this.#hono.fetch(req);
	};

	send = async (
		msg: TServerMessage,
		{
			to,
			notTo,
		}: {
			/** A list of subjects to deliver to. When specified, only connected sockets with these subjects will receive the message. */
			to?: string[];
			/** A list of subjects to exclude from delivery. When specified, connected sockets with these subjects will NOT receive the message, but all others will. When `to` is also specified, this filters against `to`. */
			notTo?: string[];
		} = {},
	) => {
		const parsed = this.config.serverMessageShape.safeParse(msg);
		if (!parsed.success) {
			throw new SocketHandlerError(
				'Invalid server message shape: ' + parsed.error,
				500,
			);
		}
		const sockets = Array.from(this.#socketInfo.entries());
		for (const [ws, { subject: subject, status, socketId }] of sockets) {
			if (to && !to.includes(subject)) {
				continue;
			}
			if (notTo && notTo.includes(subject)) {
				continue;
			}
			if (status === 'pending') {
				// push to backlog
				let backlog = this.#messageBacklogs.get(socketId);
				if (!backlog) {
					backlog = [];
					this.#messageBacklogs.set(socketId, backlog);
				}
				backlog.push(parsed.data);
			} else if (status === 'closed') {
				this.#socketInfo.delete(ws);
				console.error(
					`Cannot send message to closed socket: { subject: ${subject}, socketId: ${socketId} }`,
				);
			} else {
				ws.send(JSON.stringify(parsed.data));
			}
		}
	};

	getIsConnected = (subject: string) => {
		const sockets = Array.from(this.#socketInfo.values());
		for (const { subject: id, status } of sockets) {
			if (id === subject) {
				return status === 'ready';
			}
		}
		return false;
	};

	onMessage = (ws: WebSocket, message: ArrayBuffer | string) => {
		// any message is sufficient to confirm the socket is open
		const info = this.#socketInfo.get(ws);
		if (!info) {
			console.warn(
				'Received message from untracked socket',
				ws.deserializeAttachment(),
			);
			return;
		}
		if (info.status === 'pending') {
			this.#updateSocketInfo(ws, { ...info, status: 'ready' });
			console.log(
				'Socket ready',
				info.socketId,
				info.subject,
				'sending backlog',
			);
			this.#messageBacklogs.get(info.socketId)?.forEach((msg) => {
				ws.send(JSON.stringify(msg));
			});
		}
		try {
			const asObject = JSON.parse(message.toString());
			const parsed = this.config.clientMessageShape.safeParse(asObject);
			if (!parsed.success) {
				console.error(
					'Invalid message',
					parsed.error,
					'at',
					parsed.error.issues?.[0]?.path?.join('.'),
					message.toString(),
				);
				ws.send(
					JSON.stringify({
						type: 'error',
						message: 'Invalid message format',
						responseTo: null,
					}),
				);
				return;
			} else {
				this.#onClientMessage(parsed.data, ws, info);
			}
		} catch (err) {
			console.error(
				'Error parsing or handling message',
				err,
				message.toString(),
			);
			ws.send(
				JSON.stringify({
					type: 'error',
					message: 'Error handling message',
					responseTo: null,
				}),
			);
		}
	};

	#onClientMessage = async (
		msg: TClientMessage,
		ws: WebSocket,
		info: SocketSessionInfo,
	) => {
		try {
			const handler =
				this.config.messageHandlers[msg.type as TClientMessage['type']];
			if (!handler) {
				console.warn('No handler for message type', msg.type);
			} else {
				await handler(msg, info, ws);
			}
			// ack the message for the client
			ws.send(JSON.stringify({ type: 'ack', responseTo: msg.messageId }));
		} catch (err) {
			console.error('Error handling message', err);
			const message = err instanceof Error ? err.message : 'An error occurred';
			ws.send(
				JSON.stringify({
					type: 'error',
					message,
					responseTo: msg.messageId,
				}),
			);
		}
	};

	onClose = (
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean,
	) => {
		ws.close(code, 'Goodbye');
		this.#onWebSocketCloseOrError(ws);
	};

	async onError(ws: WebSocket, error: unknown) {
		console.error('Websocket error', error);
		this.#onWebSocketCloseOrError(
			ws,
			error instanceof Error ? error : new Error('Unknown error'),
		);
	}

	#onWebSocketCloseOrError = async (ws: WebSocket, error?: Error) => {
		const info = this.#socketInfo.get(ws);
		if (info) {
			// inform other clients that this user has left
			this.config.disconnectHandler?.(info, ws, error);
		}
		this.#socketInfo.delete(ws);
	};
}
