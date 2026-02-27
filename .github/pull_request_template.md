## Summary

<!-- What changed and why? -->

## Linked issue

<!-- Required for governance check -->

Closes #

## Scope

- [ ] frouter CLI
- [ ] site
- [ ] both

## SemVer impact

- [ ] patch
- [ ] minor
- [ ] major (breaking change)

## Branch flow check

- [ ] This PR targets `dev` from a feature/fix/chore/docs/refactor/test/ci branch.
- [ ] This PR targets `main` from `release/*` or `hotfix/*`.

## Verification

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `node --test dist/tests/unit/*.test.js dist/tests/security/*.test.js`
- [ ] `node --test dist/tests/integration/*.test.js` (Ubuntu lane)
- [ ] `npm run perf:baseline && npm run test:perf` (Ubuntu Node 22 lane)
- [ ] `npm --prefix site run build` (if site changed)

## Breaking change notes (required for major)

<!-- Describe migration impact for users/scripts -->
