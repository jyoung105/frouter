# @jyoung105/free-router (deprecated)

This package moved to [`@bytonylee/free-router`](https://www.npmjs.com/package/@bytonylee/free-router).

```bash
npm install -g @bytonylee/free-router
```

This package is now a compatibility shim. It depends on `@bytonylee/free-router`,
prints a rename notice, and forwards the `free-router` command.

## Publish

```bash
cd legacy-scope-shim/
npm publish --access public
cd ..
npm deprecate "@jyoung105/free-router@*" "Moved to @bytonylee/free-router. Install: npm i -g @bytonylee/free-router"
```

After publish, users who update `@jyoung105/free-router` will keep getting the
current CLI through the dependency on `@bytonylee/free-router`.
