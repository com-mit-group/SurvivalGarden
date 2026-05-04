# Workflow endpoint ownership

Workflow-owned entities must not expose generic CRUD mutation endpoints.

## Policy

- Workflow-owned entities (currently segments, and batches once migration/cutover is complete) should accept writes via explicit command-style routes.
- Generic mutation shapes such as broad `PUT /api/{entity}/{id}` or `PATCH /api/{entity}/{id}` must not be introduced for those workflow-owned entities.
- Contract checks should guard this rule so route drift is caught during tests/review.
