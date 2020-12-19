import type { ServerRequest } from 'https://deno.land/std@0.80.0/http/mod.ts'
import { WebSocket, acceptWebSocket, isWebSocketPingEvent, isWebSocketCloseEvent } from 'https://deno.land/std@0.80.0/ws/mod.ts'
import { ErrorResponse, Parameters, paramsEncoder } from './shared.ts'
import { makeArray, asyncForEach, lazyJSONParse } from './utils.ts'
import { v4 } from 'https://deno.land/std@0.80.0/uuid/mod.ts'
import { Middleware } from 'https://deno.land/x/oak@v6.4.0/mod.ts'
import { Server, serve } from 'https://deno.land/std@0.80.0/http/server.ts'

export interface CreateConnectionParams {
	conn: Deno.Conn
	bufWriter: ServerRequest['w']
	bufReader: ServerRequest['r']
	headers: Headers
}

export interface RpcServerOptions {
	/**
	 * Creates an id for a specific client.
	 *
	 * If `{error: ErrorResponse}` is returned, the client will be sent that error and the connection will be closed.
	 *
	 * If a string is returned, it will become the client's id
	 *
	 * If `null` is returned, or if this function is not specified, the clientid will be set to a uuid
	 */
	clientAdded?(params: Parameters, socket: WebSocket): Promise<{ error: ErrorResponse } | string | null>

	/**
	 * The path to listen for connections at.
	 * If '*' is specified, all incoming ws requests will be used
	 * @default '/' // upgrade all connections
	 */
	path?: string
}

export interface ListenParams {
	port: number
	host?: string
}

interface JsonRpcRequest {
	method: string
	id?: string
	params: Parameters
}

/**
 * Creates a jsonrpc reciever using websockets.
 */
export function createJsonrpcServer(options: RpcServerOptions = {}) {
	const socks: Map<string, WebSocket> = new Map()
	const methods: Map<string, (params: Parameters, clientId: string) => Promise<any>> = new Map()
	const emitters: Map<string, (params: Parameters, emit: (data: any) => void, clientId: string) => void> = new Map()

	async function handleRequest(client: string, raw: string) {
		const sock = socks.get(client)

		if (!sock) return console.warn(`Warn: recieved a request from and undefined connection`)

		const requests = parseRequest(raw)
		if (requests === 'parse-error') return send(sock, { id: null, error: { code: -32700, message: 'Parse error' } })

		const responses: any[] = []

		await asyncForEach(requests, async request => {
			if (request === 'invalid') return responses.push({ id: null, error: { code: -32600, message: 'Invalid Request' } })

			if (!request.method.endsWith(':')) {
				// It's a method
				const handler = methods.get(request.method)

				if (!handler)
					if (request.id !== undefined)
						return responses.push({ error: { code: -32601, message: 'Method not found' }, id: request.id })
					else return
				const result = await handler(request.params, client)

				if (request.id !== undefined) responses.push({ id: request.id, result })
			} else {
				// It's an emitter
				const handler = emitters.get(request.method)

				if (!handler)
					if (request.id !== undefined)
						return responses.push({ error: { code: -32601, message: 'Emitter not found' }, id: request.id })
					else return

				// Because emitters can return a value at any time, we are going to have to send messages on their schedule.
				// This may break batches, but I don't think that is a big deal
				handler(
					request.params,
					data => {
						send(sock, { result: data, id: request.id })
					},
					client
				)
			}
		})

		send(sock, responses)
	}

	function send(sock: WebSocket, message: any) {
		const messages = makeArray(message)
		messages.forEach(message => {
			message.jsonrpc = '2.0'
			if (messages.length === 1) sock.send(JSON.stringify(message))
		})
		if (messages.length !== 1) sock.send(JSON.stringify(messages))
	}

	function parseRequest(json: string): (JsonRpcRequest | 'invalid')[] | 'parse-error' {
		try {
			const arr = makeArray(JSON.parse(json))
			const res: (JsonRpcRequest | 'invalid')[] = []

			for (let obj of arr) {
				if (typeof obj !== 'object') res.push('invalid')
				else if (!obj) res.push('invalid')
				else if (obj.jsonrpc !== '2.0') res.push('invalid')
				else if (typeof obj.method !== 'string') res.push('invalid')
				else res.push(obj)
			}

			if (!res.length) return ['invalid']

			return res
		} catch (e) {
			return 'parse-error'
		}
	}

	/**
	 * Upgrades a particular request to a websocket and integrates it into jsonrpc.
	 * 
	 * ```ts
	 * for await (const req of server) {
		if (req.url === '/special-json-rpc/path')
			createConnection({
				conn: req.conn,
				bufReader: req.r,
				bufWriter: req.w,
				headers: req.headers,
			})
	 * }
	 * ```
	 */
	async function createConnection(params: CreateConnectionParams) {
		const sock = await acceptWebSocket(params)

		const protocolHeader = params.headers.get('sec-websocket-protocol')
		const incomingParamaters = protocolHeader ? lazyJSONParse(paramsEncoder.decrypt(protocolHeader)) : {}

		let clientId = await (options.clientAdded || (() => v4.generate()))(incomingParamaters, sock)

		if (!clientId) clientId = v4.generate()

		if (typeof clientId === 'object') {
			send(sock, { id: null, error: clientId.error })
			return sock.close()
		}

		socks.set(clientId, sock)

		// Close the socket once it has been open for an entire day
		setTimeout(() => sock.close(), 1000 * 60 * 60 * 24)

		try {
			for await (const ev of sock) {
				if (typeof ev === 'string') {
					// text message
					handleRequest(clientId, ev)
				} else if (ev instanceof Uint8Array) {
					// binary message
					console.warn('Warn: an invalid jsonrpc message was sent.  Skipping.')
				} else if (isWebSocketPingEvent(ev)) {
					// ping
				} else if (isWebSocketCloseEvent(ev)) {
					// close
					socks.delete(clientId)
				}
			}
		} catch (err) {
			console.error(`failed to receive frame: ${err}`)

			if (!sock.isClosed) {
				await sock.close(1000).catch(console.error)
			}
		}
	}

	/**
	 * Registers a new method for the client to use.
	 *
	 * ```ts
	 * app.method('greet', (params) => `Hello, ${params.name}!`)
	 * ```
	 */
	function method<Req = Parameters, Res = any>(method: string, listener: (params: Req, clientId: string) => Promise<Res> | Res) {
		methods.set(method, async (params, client) => await listener(params, client))
	}

	/**
	 * Registers a new emitter for the client to use.
	 * 
	 * Emitters are different that pure methods because they can return multipule results on their own schedule.
	 * 
	 * ```ts
	 * app.emitter('hello', async (params, emit) => {
	 * 	if (params.username !== 'Vehmloewff') throw new Error('Test: emit params are not working')
	 * 
	 * 	await delay(2000)
	 * 	emit(1)
	 * 
	 * 	await delay(2000)
	 *	emit(2)
	 
	 *  await delay(2000)
	 *	emit(3)
	 * })
	 * ```
	 * 
	 * Clients can listen to these different emmitions using the `connection.listen` method.
	 */
	function emitter<Req = Parameters, Res = any>(
		method: string,
		listener: (params: Req, emit: (res: Res) => void, clientId: string) => Promise<void> | void
	) {
		emitters.set(method + ':', listener)
	}

	/**
	 * Adds the jsonrpc functionality to an existing oak application
	 */
	function oakMiddleware(): Middleware {
		return (context, next) => {
			if (context.request.url.pathname === (options.path || '/'))
				try {
					createConnection({
						conn: context.request.serverRequest.conn,
						bufReader: context.request.serverRequest.r,
						bufWriter: context.request.serverRequest.w,
						headers: context.request.serverRequest.headers,
					})
				} catch (e) {
					next()
				}
			else next()
		}
	}

	/**
	 * Adds the jsonrpc functionality to an existing `http` server
	 */
	async function addToHttpServer(server: Server) {
		for await (const req of server) {
			if (req.url === (options.path || '/'))
				try {
					createConnection({
						conn: req.conn,
						bufReader: req.r,
						bufWriter: req.w,
						headers: req.headers,
					})
				} catch (e) {}
		}
	}

	/**
	 * Creates a standalone http listener for this jsonrpc server
	 */
	async function listen(params: ListenParams) {
		await addToHttpServer(serve(params))
	}

	return {
		method,
		emitter,
		createConnection,
		oakMiddleware,
		addToHttpServer,
		listen,
	}
}
