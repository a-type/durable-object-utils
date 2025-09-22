import { TestObject } from './TestObject';

export interface Env {
	TEST_OBJECT: DurableObjectNamespace<TestObject>;
	SOCKET_SECRET: string;
}
