import { connect } from '../client.ts'

async function app() {
	const connection = await connect('ws://localhost:8000', { auth: 'secure' })

	if ((await connection.call('hello', null)) !== 'goodbye') throw new Error(`Test: expected to call the 'hello' method`)

	console.log('should be called three times')
	connection.listen('hello', {
		params: { username: 'Vehmloewff' },
		listener(data) {
			console.log('called:', data)

			if (data !== 1 && data !== 2 && data !== 3) throw new Error(`Test: expected to listen three times to the 'hello/repeat' method`)
		},
	})
}

app()
