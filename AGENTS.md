<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Shared UI vocabulary

Before adding pills, badges, tags, assignee treatments, labels, statuses, panel-tab headers, quick statistics, filters, or lists, read `docs/ui-standards.md`. Use the primitives exported by `components/ui`, `components/panel`, and `components/list`; do not invent page-local variants when a shared primitive covers the meaning. A collection of comparable records must be checked against the documented `List` definition before it receives a custom repeated-row layout. If the design language changes, update the primitive, existing uses, and the standards document together so the change propagates consistently.
