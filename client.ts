import { Parameters, ErrorResponse, paramsEncoder } from './shared.ts'
import { v4 } from 'https://deno.land/std@0.81.0/uuid/mod.ts'
import { makeArray } from './utils.ts'

export interface ListenOptions {
	/** @default null */
	params?: Parameters
	/** Called whenever a response is recieved */
	listener?: (data: Parameters) => void
	/** Called whenever an error response is recieved */
	errorHandler?: (error: ErrorResponse) => void
}

export interface ConnectOptions {
	/**
	 * Called when a general error is noticed.
	 * This can be because of a connection issue, or an error response
	 * from the server that was not targeted to a particular request.
	 */
	onGeneralError?(error: ErrorResponse): void

	/**
	 * The amount of times to retry a failed connection before erroring
	 * @default Infinity
	 */
	retryCount?: number
	/**
	 * The amount of time to delay before retrying a failed connection
	 */
	retryInterval?: number
}

export type Connection = ReturnType<typeof connect>

/**
 * Opens a websocket connection
 * @param url The url to connect to.  Should start with `ws:` or `wss:`
 * @param params Params sent over with the initial request.  These can be read in the `onClientAdded` hook of `createJsonrpcServer`
 *
 * ```ts
 * const connection = await onnect('ws://localhost:3000/some-path', { auth: '134jasjflaz984s' })
 * ```
 */
export async function connect(url: string, params: Parameters, options: ConnectOptions = {}) {
	const listeners: Map<string, (error?: ErrorResponse, data?: Parameters) => void> = new Map()
	let outgoing: string[] | null = []

	let newOutgoingMessageNotifier: () => void = () => {}
	let retryCount = 0

	function tryToConnect() {
		return new Promise<void>(resolve => {
			const ws = new WebSocket(url, paramsEncoder.encrypt(JSON.stringify(params)))

			const sendAllMessages = () => {
				if (!outgoing) return ws.close()
				outgoing.forEach(message => ws.send(message))
				outgoing = []
			}

			newOutgoingMessageNotifier = () => {
				if (ws.readyState === ws.OPEN) sendAllMessages()
			}

			ws.onopen = () => {
				sendAllMessages()
				resolve()
			}

			ws.onerror = () => {
				if (retryCount >= (options.retryCount || Infinity)) {
					if (options.onGeneralError) options.onGeneralError({ message: 'Failed to connect', code: 101 })
					else throw { message: 'Failed to connect', code: 101 }
				}
				retryCount++

				setTimeout(() => {
					if (outgoing) tryToConnect()
				}, options.retryInterval || 2000)
			}

			ws.onmessage = ev => {
				const res = parseResponse(ev.data)
				if (!res) return

				res.forEach(res => {
					if (res.id === null) {
						if (res.error)
							if (options.onGeneralError) options.onGeneralError(res.error)
							else throw res.error
					} else {
						const listener = listeners.get(res.id)
						if (listener) listener(res.error, res.result ?? null)
					}
				})
			}
		})
	}

	function sendMessage(method: string, params: Parameters, id?: string) {
		const message: any = { jsonrpc: '2.0', method, params }
		if (id) message.id = id

		if (!outgoing) throw new Error(`Cannot send message because the socket has been manually closed`)
		outgoing.push(JSON.stringify(message))
		newOutgoingMessageNotifier()
	}

	await tryToConnect()

	/**
	 * Calls a method on the server.  Returns a promise that resolves with the value that the server returns.
	 * @param method The method to call.  These are defined on the server with `server.method('some/method', ...)
	 * @param params The params to pass along with the method
	 */
	async function call(method: string, params: Parameters = null): Promise<Parameters> {
		return new Promise((resolve, reject) => {
			const id = v4.generate()

			listeners.set(id, (error, data) => {
				listeners.delete(id)

				if (error) reject(error)
				else if (data !== undefined) resolve(data)
			})

			sendMessage(method, params, id)
		})
	}

	/**
	 * Like `call`, except it doesn't expect a response back from the server
	 */
	function notify(method: string, params: Parameters = null) {
		sendMessage(method, params)
	}

	/**
	 * Calls a method on the server and expects multipule responses.
	 * @param method The method to call on the server.
	 *
	 * These can methods can be provided on the server with `server.emitter('some/method', ...)`.
	 *
	 * NOTE:
	 * `listen` and `call` are two different things.
	 * Behind the scenes `listen` ads a `:` at the end of the method to avoid
	 * conflicts with `call`.  Therefore, `listen('foo')` will have nothing to do with `call('foo')`.
	 */
	function listen(method: string, options: ListenOptions = {}) {
		const id = v4.generate()

		listeners.set(id, (error, data) => {
			if (options.errorHandler && error) options.errorHandler(error)
			if (options.listener && data) options.listener(data)
		})

		sendMessage(method + ':', options.params || null, id)
	}

	/**
	 * Closes the connection.
	 */
	function close() {
		outgoing = null
		newOutgoingMessageNotifier()
	}

	return {
		call,
		notify,
		listen,
		close,
	}
}

interface Response {
	id: string
	result?: Parameters
	error?: ErrorResponse
}

function parseResponse(json: any): Response[] | null {
	const warn = () => console.warn(`An invalid JSON rpc request was sent over.  Ignoring/..`)

	try {
		if (typeof json !== 'string') throw 'dummy'
		const obj = makeArray(JSON.parse(json))

		const res: Response[] = []
		obj.forEach(obj => {
			if (obj.hasOwnProperty('id') && (obj.hasOwnProperty('result') || obj.error))
				res.push({
					id: obj.id,
					result: obj.result,
					error: obj.error,
				})
			else warn()
		})
		return res
	} catch (_) {
		warn()
		return null
	}
}
