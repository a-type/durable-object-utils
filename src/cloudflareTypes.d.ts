export type DurableObjectId = any;
export interface DurableObjectState {
	getWebSockets: () => any[];
	acceptWebSocket: (socket: any) => void;
	id: any;
}
export type DurableObjectStorage = any;
export type SqlStorageValue = string | number | boolean | null;

declare global {
	const WebSocketPair: {
		new (): {
			0: any;
			1: any;
		};
	};

	interface WebSocket {
		serializeAttachment: (data: any) => void;
		deserializeAttachment: () => any;
	}
}
