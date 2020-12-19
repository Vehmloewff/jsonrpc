import { desc, execute, run, sh, task } from 'https://deno.land/x/drake@v1.4.5/mod.ts'
import { Application, Router, send } from 'https://deno.land/x/oak@v6.4.0/mod.ts'
import { dirname, basename } from 'https://deno.land/std@0.81.0/path/mod.ts'

// Doesn't work.  denopack -o option does not work when the -d option is supplied.  -d option does not name the file.
// const tmpFile = await Deno.makeTempFile()
const tmpFile = `/tmp/client.js`

desc('Bundle the client')
task('bundle', [], async () => {
	console.log(`denopack -i ./test/client.ts -o ${basename(tmpFile)} -d ${dirname(tmpFile)}`)
	await sh(`denopack -i ./test/client.ts -o ${basename(tmpFile)} -d ${dirname(tmpFile)}`)
})

desc('Serve this stuff up')
task('serve', [], async () => {
	const template = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Live Test</title>
	<script defer src="/bundle.js"></script>
</head>
<body>Running some tests.  If there are no errors in the browser console after 10 seconds, you should be good.</body>
</html>`

	const app = new Application()

	const router = new Router()
	router
		.get('/', context => {
			context.response.body = template
		})
		.get('/bundle.js', async context => {
			const js = await Deno.readTextFile(tmpFile)
			context.response.body = js
		})
		.get('/bundle.js.map', async context => {
			const map = await Deno.readTextFile(tmpFile + '.map')
			context.response.body = map
		})

	app.use(router.routes())
	app.use(router.allowedMethods())

	await app.listen({ port: 3000 })
})

desc('Live test the entire thing')
task('live', ['bundle'], async () => {
	execute('serve')
	await sh('deno run --allow-net test/server.ts')
})

run()
