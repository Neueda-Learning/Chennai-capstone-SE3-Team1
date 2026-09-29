# Generated API clients

Everything under this folder is written by [OpenAPI Generator](https://openapi-generator.tech),
never by hand. Two contracts, two subdirectories:

| Subdirectory | Contract | Generator config |
|---|---|---|
| `auth-client/` | `../../../../sprint-06-api/contracts/auth-api.yaml` | `openapi-generator/auth-client.config.json` |
| `trade-client/` | `../../../../sprint-06-api/contracts/trade-api.yaml` | `openapi-generator/trade-client.config.json` |

Both use the `typescript-angular` generator, producing tree-shakable
`@Injectable({ providedIn: 'root' })` service classes (`AuthService`,
`AccountsService`, `OrdersService`, ...) plus a `provideApi()` helper for
`ApplicationConfig` — no `NgModule` involved, so it fits this workspace's
standalone-only setup as-is.

## Regenerating

```bash
npm run generate:clients          # both contracts
npm run generate:auth-client      # auth-api.yaml only
npm run generate:trade-client     # trade-api.yaml only
```

Run this every time either `.yaml` contract changes, and commit the result
in the same change as the contract edit. The generator version is pinned in
`openapitools.json` (`generator-cli.version`) and the npm wrapper is pinned
exact in `package.json` (`@openapitools/openapi-generator-cli`), so two
people running the same command against the same contract get byte-identical
output.

## Rules for this tree

- **Never hand-edit a file in here.** If the generated shape is awkward to
  consume, wrap it in a service under `../core/services/` instead of patching
  the generated file — the wrapper survives regeneration, a hand edit doesn't.
- **Commit the output.** It's checked in on purpose (see the note in the
  root `.gitignore`); this is not build output to ignore.
- Every file below this README came from the generator. If you find one that
  didn't, it doesn't belong here.

## Known, deliberate generator-validation override

Both contracts are OpenAPI 3.1 and set `info.license.name` without
`info.license.identifier` — legal under the OAS 3.1 License Object (`name` is
the only required field). OpenAPI Generator 7.25.0's bundled spec validator
disagrees and fails the build over it. The contracts aren't ours to edit to
please the generator, so both generator configs set `"validateSpec": false`
deliberately, not reflexively — that is the *only* validation this project
turns off, and it's scoped to this one known false positive.
