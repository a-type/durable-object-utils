# durable-object-utils

Personal collection of Cloudflare Durable Object tools

## SqlWrapper

A Kysely-based wrapper around DurableObject SQL for typed queries. Not a Kysely dialect; just helps write the queries and runs them using DO SQL.

Used by Scheduler.

```ts
export const migrations: SQLMigrations.SQLSchemaMigration[] = [
	{
		idMonotonicInc: 1,
		description: 'Add Dummy table',
		sql: `
			CREATE TABLE IF NOT EXISTS Dummy (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL
			);
		`,
	},
];

export interface Tables {
	Dummy: DummyTable;
}

const db = new Kysely<Tables>({
	dialect: {
		createAdapter: () => new SqliteAdapter(),
		createDriver: () => new DummyDriver(),
		createIntrospector: (db) => new SqliteIntrospector(db),
		createQueryCompiler: () => new SqliteQueryCompiler(),
	},
});

class MyObj extends DurableObject {
	#sql;
	constructor(ctx, env) {
		super(ctx, env);
		this.#sql = new SqlWrapper(ctx.storage, migrations);
	}

	async fetch() {
		await this.#sql.run(
			db.insertInto('Dummy').values({ id: '1', name: 'one' }),
		);
	}
}
```

## Scheduler

Kind of like PartyWhen, but compositional instead of extending DurableObject, so you can use it within another DO with other logic.

```ts
class MyObj extends DurableObject {
	#sql;
	#scheduler;

	constructor(ctx, env) {
		super(ctx, env);
		this.#sql = new SqlWrapper(ctx.storage, migrations);
		this.#scheduler = new Scheduler<TaskTypes>(
			this.#sql,
			ctx.storage,
			this.#handleScheduledTask,
		);
	}

	// required
	alarm() {
		return this.#scheduler.handleAlarm();
	}

	#handleScheduledTask = (task: TaskTypes) => {};
}
```

## SocketHandler

An abstraction to manage socket connection lifecycle and send/receive events without cluttering your DO with boilerplate.

Requires use of a simple authorization token to connect. The token embeds an audience (the ID of the DurableObject) and a subject (like a userId). When the token is received by a DO's socket connector, it checks that the DO ID matches the audience and associates the subject with the connection.

Validates incoming and outgoing messages to ensure consistency with your protocol.

```ts
class MyObj extends DurableObject {
	#sockets;

	constructor(ctx, env) {
		this.#sockets = new SocketHandler(ctx, {
			tokenSecret: env.SOCKET_SECRET,
			clientMessageShape: clientMessageSchema, // Zod schema
			serverMessageShape: serverMessageSchema,
			connectHandler: (ws, info) => {
				console.log(info.subject, 'connected');
			},
			disconnectHandler: (ws, info, error) => {
				console.log(info.subject, 'disconnected');
				if (error) console.error(error);
			},
			messageHandlers: {
				ping: this.#handlePing,
			},
		});
	}

	#handlePing = (msg: PingMessage, info: SocketSessionInfo) => {
		this.#sockets.send(
			{
				type: 'pong',
			},
			{ to: info.subject },
		);
	};

	// required: delegate to socket handler
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
}
```
