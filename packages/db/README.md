# @bb/db

## Migration Workflow

Schema changes must be checked in as generated SQL migrations:

```sh
pnpm --filter @bb/db db:generate
```

Review the generated SQL before committing it. `db:push` is intentionally not
exposed for this package because it mutates the target database directly and can
hide migration drift in persistent BB data directories.

## Event provider provenance

`events.provider_id` records the provider when an event is inserted, independently
of the thread's current provider. History copies preserve the source value.
Provider session ownership uses this value, so changing `threads.provider_id`
does not transfer a historical session to another provider. An identity with an
unknown provider is invalid and requires explicit context recovery.

Migration `0166_event_provider_provenance` backfills existing events from their
thread's provider. This is valid before in-place provider switching is exposed.
Current daemon events capture provenance at insertion; switching also requires
tagging events at their origin so delayed delivery cannot misattribute events.
