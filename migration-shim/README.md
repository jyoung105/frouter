# frouter (deprecated)

This package has been renamed to [`free-router`](https://www.npmjs.com/package/free-router).

```bash
npm install -g free-router
```

This `frouter` package on npm is a thin shim that depends on `free-router` and re-execs it, so existing installs keep working until you migrate. It will be removed in a future release.

## How to publish this shim

The shim is a separate npm package from `free-router`. Publish from this directory:

```bash
cd migration-shim/
npm publish --otp=<code>
cd ..
npm deprecate "frouter@*" "frouter has been renamed to free-router. Install: npm i -g free-router"
```

After publish, `npm view frouter version` should report `1.2.0`. Existing users who run `npm update -g frouter` will pull `free-router@^1.2.0` transitively and the shim will print a rename notice on every invocation.
