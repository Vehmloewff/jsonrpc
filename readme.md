# jsonrpc

A JsonRPC library for Deno - client and server

## Usage

```ts
// Server
import { createJsonrpcServer } from 'https://denopkg.com/Vehmloewff/jsonrpc/server.ts'

const app = createJsonrpcServer()

app.method('greet', ({ name }) => `Hello, ${name}!`)

app.listen({ port: 3000 }) // You can use `app.oakMiddleware()` or `app.addToHttpServer(server)` to use an existing server.

// Client
import { connect } from 'https://denopkg.com/Vehmloewff/jsonrpc/client.ts'

const connection = connect('ws:localhost:3000')

await connection.call('greet', { name: 'Vehmloewff' }) // -> Hello, Vehmloewff!
```

There is a more complete example in the [test](/test) folder.

## Contributing

Of course!

You can run the tests like this:

```sh
git clone https://github.com/Vehmloewff/jsonrpc
cd jsonrpc
alias drake="deno run -A .config/Drakefile.ts"
drake live
```

The live tests should be running on http://localhost:3000
