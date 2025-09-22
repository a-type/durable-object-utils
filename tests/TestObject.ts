import { SQLSchemaMigration } from 'durable-utils/sql-migrations';
import z from 'zod';
import {
	scheduledTaskMigration,
	ScheduledTaskTable,
	Scheduler,
} from '../src/Scheduler.js';
import { SocketHandler, SocketSessionInfo } from '../src/SocketHandler.js';
import { createNoOpDb, SqlWrapper } from '../src/SqlWrapper.js';
import { Env } from './types.js';
// @ts-ignore - can't really do the right way of typing things in this lib...
import { DurableObject } from 'cloudflare:workers';

const migrations: SQLSchemaMigration[] = [
	{
		description: 'Test data',
		idMonotonicInc: 1,
		sql: `
			CREATE TABLE IF NOT EXISTS TestData (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL
			);
		`,
	},
	{
		description: 'Scheduler tables',
		idMonotonicInc: 2,
		sql: scheduledTaskMigration,
	},
];

interface Tables {
	TestData: {
		id?: number;
		name: string;
	};
	ScheduledTask: ScheduledTaskTable;
}

const db = createNoOpDb<Tables>();

type Task = {
	type: 'create';
	data: { name: string };
};

const clientMessageShape = z.object({
	type: z.literal('echo'),
	messageId: z.string(),
	content: z.string(),
});
type ClientMessage = z.infer<typeof clientMessageShape>;

const serverMessageShape = z.object({
	type: z.literal('echoResponse'),
	messageId: z.string(),
	content: z.string(),
});
type ServerMessage = z.infer<typeof serverMessageShape>;

export class TestObject extends DurableObject {
	['__DURABLE_OBJECT_BRAND'] = undefined as never;
	#sql;
	#scheduler;
	#sockets;

	constructor(state: any, env: Env) {
		super(state, env);
		this.#sql = new SqlWrapper(state.storage, migrations);
		this.#scheduler = new Scheduler(
			this.#sql,
			state.storage,
			this.#onScheduledTask,
		);
		this.#sockets = new SocketHandler(state, {
			tokenSecret: env.SOCKET_SECRET,
			clientMessageShape,
			serverMessageShape,
			messageHandlers: {
				echo: this.#handleEcho,
			},
		});
	}

	// required boilerplate
	async alarm() {
		this.#scheduler.handleAlarm();
	}
	fetch(req: Request) {
		return this.#sockets.fetch(req);
	}
	webSocketMessage(
		ws: WebSocket,
		message: string | ArrayBuffer,
	): void | Promise<void> {
		return this.#sockets.onMessage(ws, message);
	}
	webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean,
	): void | Promise<void> {
		return this.#sockets.onClose(ws, code, reason, wasClean);
	}
	webSocketError(ws: WebSocket, error: unknown): void | Promise<void> {
		return this.#sockets.onError(ws, error);
	}

	async create(name: string) {
		const query = db.insertInto('TestData').values({ name }).returningAll();
		try {
			const result = await this.#sql.run(query);
			return result[0];
		} catch (e) {
			console.error('Error creating TestData:', e, query.compile().sql);
			throw e;
		}
	}

	async list() {
		return this.#sql.run(db.selectFrom('TestData').selectAll());
	}

	async scheduleCreate(name: string, time: Date) {
		console.log('Scheduling create', name, 'at', time);
		return this.#scheduler.scheduleTask(time, {
			type: 'create',
			data: { name },
		});
	}

	#onScheduledTask = async (task: Task) => {
		console.log('alarm', task);
		if (task.type === 'create') {
			await this.create(task.data.name);
		}
	};

	#handleEcho = async (msg: ClientMessage, info: SocketSessionInfo) => {
		const response = {
			type: 'echoResponse' as const,
			messageId: msg.messageId,
			content: msg.content,
		};
		await this.#sockets.send(response, {
			to: [info.audience],
		});
	};
}
