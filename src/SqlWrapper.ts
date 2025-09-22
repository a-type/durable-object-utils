import { SQLMigrations } from 'durable-utils';
import {
	Compilable,
	CompiledQuery,
	DummyDriver,
	Kysely,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
} from 'kysely';
import { DurableObjectStorage, SqlStorageValue } from './cloudflareTypes';

export type QueryRow<T extends CompiledQuery<unknown>> =
	T extends CompiledQuery<infer R> ? R : never;

export class SqlWrapper {
	#sql;
	#migrations;
	constructor(
		storage: DurableObjectStorage,
		migrations: SQLMigrations.SQLSchemaMigration[],
	) {
		this.#sql = storage.sql;
		this.#migrations = new SQLMigrations.SQLSchemaMigrations({
			doStorage: storage,
			migrations,
		});
	}

	migrate = async () => {
		return this.#migrations.runAll();
	};

	run = async <O extends Record<string, SqlStorageValue>>(
		query: Compilable<O>,
		{
			debug,
		}: {
			debug?: boolean;
		} = {},
	): Promise<O[]> => {
		await this.#migrations.runAll();
		const compiled = query.compile();
		if (debug) {
			console.log('SQL:', compiled.sql);
			console.log('Parameters:', compiled.parameters);
		}
		return this.#sql
			.exec(compiled.sql, ...compiled.parameters)
			.toArray() as O[];
	};
}

export function createNoOpDb<Tables>() {
	return new Kysely<Tables>({
		dialect: {
			createAdapter: () => new SqliteAdapter(),
			createDriver: () => new DummyDriver(),
			createIntrospector: (db) => new SqliteIntrospector(db),
			createQueryCompiler: () => new SqliteQueryCompiler(),
		},
	});
}
