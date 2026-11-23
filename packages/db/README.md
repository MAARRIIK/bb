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
Daemon events carry the provider and generation captured by their originating
runtime process. Insertion preserves that source, independently of the current
thread assignment, and the server rejects stale sources before persistence.

`threads.provider_session_id` selects a provider session generation within a
stable BB thread. `events.provider_session_id` preserves that generation on
insertion and history copying. Null means the legacy generation; migration 0167
leaves existing threads and events there. Session lookup requires matching
generations, including when a thread returns to the same provider. The visible
event history is not filtered by generation.

Generation activation is not exposed yet. Protocol 279 carries the originating
generation through events, tool calls and interactive requests. Legacy null
generations remain supported; requests without a source cannot act on a thread
with an explicit generation. Switching still requires transactional preparation,
context transfer and lifecycle barriers before it can be exposed.
