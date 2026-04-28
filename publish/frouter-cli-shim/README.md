# frouter-cli (deprecated)

This package moved to [`@bytonylee/free-router`](https://www.npmjs.com/package/@bytonylee/free-router).

```bash
npm install -g @bytonylee/free-router
```

This package is now a compatibility shim. It depends on `@bytonylee/free-router`,
prints a rename notice, and forwards the `free-router` command.

## Publish

```bash
cd publish/frouter-cli-shim/
npm publish --access public
cd ../..
npm deprecate "frouter-cli@*" "Moved to @bytonylee/free-router. Install: npm i -g @bytonylee/free-router"
```

After publish, users who update `frouter-cli` will keep getting the current CLI
through the dependency on `@bytonylee/free-router`.
