# 0003. Use the REST search API for assigned issues in v0.1

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

v0.1 needs "open issues assigned to me", optionally limited to some repositories, in one
request. v0.2 adds GitHub Projects (v2), which is only available through GraphQL.

## Options considered

1. **REST `GET /search/issues`** with `is:open is:issue assignee:@me archived:false` plus
   optional `repo:` qualifiers (which GitHub ORs together). One request, returns the total
   count, sorts by `updated`. Rate limit: 30 searches/minute, far above our needs.
2. **REST `GET /issues?filter=assigned`** — includes pull requests (must filter client side)
   and has no repo filter, so it needs extra requests per repo.
3. **GraphQL now** — one API for everything, but more code and a more complex query for
   the MVP.

## Decision

Use REST search for v0.1. Introduce GraphQL in v0.2 for Projects, and reconsider moving
issues to GraphQL then.

## Consequences

- Simple, testable query builder in `lib/model.js`.
- Search results can lag a few seconds behind GitHub's UI; acceptable for a 10-minute poll.
- `GitHubClient` should be shaped so a GraphQL method can be added without changing callers.
