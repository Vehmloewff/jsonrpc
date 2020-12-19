import { createJsonrpcServer } from '../server.ts'
import { delay } from '../utils.ts'

interface IncommingParams {
	auth: string
}

const app = createJsonrpcServer({
	async clientAdded(params: IncommingParams) {
		if (params.auth !== 'secure') throw new Error('Test: Did not send params correctly')
		return String(Date.now())
	},
})

app.method('hello', () => {
	return 'goodbye'
})

app.emitter('hello', async (params, emit) => {
	if (params.username !== 'Vehmloewff') throw new Error('Test: emit params are not working')

	await delay(2000)
	emit(1)

	await delay(2000)
	emit(2)

	await delay(2000)
	emit(3)
})

app.listen({ port: 8000 })
