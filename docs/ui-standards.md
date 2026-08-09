# Betelgeze UI standards

Repeated interface elements use the primitives exported from `components/ui`. New UI must not recreate them with page-local Tailwind classes.

## Status

`Status` communicates operational state, health, or progress. Its appearance follows the lead-generation poll UI: a Betelgeze diamond followed by plain text.

Statuses have exactly four tones:

| Tone | Meaning | Typical examples |
| --- | --- | --- |
| `grey` | Not started, inactive, unknown, or neutral | Initialising, queued, disabled |
| `yellow` | Active, waiting, or needs attention | In progress, pending, warning |
| `green` | Genuinely successful or ready | Successful, completed, verified |
| `red` | Failed, blocked, cancelled, or unavailable | Failed, error, blocked |

Do not add blue, violet, or other status colours. A configured, managed, or pending integration is not green unless the real path has been verified.

```tsx
<Status label="Initialising" tone="grey" />
<Status label="In progress" tone="yellow" />
<Status label="Successful" tone="green" />
<Status label="Failed" tone="red" />
```

In space-constrained visualisations such as Gantt bars, use `compact` to show only the canonical status mark. The component retains the status label for assistive technology and hover disclosure; do not recreate a local dot, circle, or icon treatment.

```tsx
<Status label="Overdue" tone="red" compact />
```

### StatusStat

`StatusStat` is the compact numerical sibling of `Status`. It uses the same four tone meanings and typography, but a bold tabular number takes the place of the Betelgeze diamond. Use it for small grouped state counts such as source-settings summaries; do not use a pill or a hand-built coloured count for this pattern.

```tsx
<StatusStat value={12} label="Enabled" tone="green" />
<StatusStat value={0} label="Disabled" tone="grey" />
<StatusStat value={8} label="Not mapped" tone="yellow" />
<StatusStat value={2} label="No config" tone="red" />
```

## RoundPill

`RoundPill` represents assigned or attached things: services, modules, people, categories, filters, or other compact metadata. Its aesthetic comes from the assigned service and module pills in onboarding detail.

Pill colours are fixed RGB values rather than translucent utilities, so they remain identical on every surface. The first two recipes are sampled directly from the approved RoundPills; the remaining recipes preserve the same dark face, chromatic edge, and pale text relationship:

| Tone | Border | Background | Text |
| --- | --- | --- | --- |
| `emerald` | `#014E38` | `#051C16` | `#A4F5CF` |
| `sky` | `#01426B` | `#051B29` | `#B6E4FC` |
| `yellow` | `#8A7D00` | `#2B2A08` | `#FFF3A3` |
| `amber` | `#6D2D00` | `#281206` | `#FEE685` |
| `red` | `#720810` | `#28090A` | `#FFC9C9` |
| `violet` | `#440D89` | `#1D0C39` | `#DDD6FF` |
| `neutral` | `#404040` | `#171717` | `#D4D4D4` |

These values are the palette definition. Do not substitute nearby framework colour tokens or recreate them with opacity.

`yellow` is the canonical tone for `Test` labels across the platform. It retains the same glassy, near-black chromatic face as the rest of the palette, but keeps its red and green channels close so it reads as yellow rather than amber or brown. `amber` is warmer and more orange; retain it for labels that need that distinction rather than using it as a substitute for `Test`.

Use `Assignee` when the attached thing is a person assigned to something. Its default is the canonical avatar-and-name form of `RoundPill`; do not assemble a separate profile-picture treatment for assignees. In space-constrained visualisations such as Gantt bars, use its `compact` avatar-only mode.

```tsx
<RoundPill tone="emerald">Paid Social</RoundPill>
<RoundPill tone="sky">Reporting</RoundPill>
<Assignee name="Alex Morgan" avatarSrc={avatarUrl} />
<Assignee name="Alex Morgan" avatarSrc={avatarUrl} compact />
<Assignee name="Alex Morgan" avatarSrc={avatarUrl} compact compactSize="md" />
```

## SquarePill

`SquarePill` is the boxier, rounded-corner label treatment. Use it for categorical labels such as `Stuck` or `Test`. It shares RoundPill's border, background, text, spacing, and colour palette; only its shape differs.

```tsx
<SquarePill tone="amber">Stuck</SquarePill>
<SquarePill tone="yellow">Test</SquarePill>
```

## RelationshipStage

`RelationshipStage` is reserved for relationship lifecycle stages. It reads its border, background, and text colours from the exact same `pillTones` definitions as `RoundPill`; it must never maintain a separate stage palette. It is otherwise identical in height, typography, border weight, and spacing. The only difference is its silhouette.

The silhouette is a rectangle with half of a Betelgeze diamond attached to each end. It is exactly 24px high. Each pointed end is 12px deep, so its upper and lower edges travel at 45 degrees and meet at the vertical midpoint. In polygon terms, the six outer points are: top-left after 12px, top-right before 12px, right midpoint, bottom-right before 12px, bottom-left after 12px, and left midpoint. Do not soften, round, shorten, or reinterpret these four diagonal edges.

Relationship stages are categorical labels, not operational statuses. Their stage-specific colours therefore do not expand or alter the four-colour `Status` meanings. Pass the lifecycle phase itself so the component owns both its canonical wording and colour.

The lifecycle palette assigns distinct tones to the active parent stages: Lead `sky`, Potential Client `amber`, Invoiced `yellow`, Onboarding `violet`, Onboarding Review `emerald`, Fulfilment `red`, and Retention `neutral`. These are categorical Gantt colours, not status meanings.

```tsx
<RelationshipStage phase="onboarding" />
<RelationshipStage phase="fulfilment" />
```

Do not use this shape for statuses, tests, warnings, services, modules, or arbitrary metadata.

## Shared rules

- Use sentence case; do not add uppercase tracking to ordinary pills or statuses.
- Pick pill colours by stable category. Status colours always retain the meanings above.
- Keep compact elements short. Put explanations in adjacent copy, a tooltip, or expanded detail.
- Extend a shared primitive when a new stable variant is required. Do not invent a one-off treatment in a page.
- When the design changes, update `components/ui`, this document, and existing uses together.
- A local exception must include a code comment explaining why the shared primitive cannot represent it.

## TrendChart

`TrendChart` is the canonical compact time-series graph. It owns the chart geometry, white trend line, fading area gradient, axes, emphasized reference ticks, optional red exception bands, responsive labels, and keyboard/pointer tooltip behaviour. Feature code supplies normalized positions, numeric values, and already-formatted labels; it must not recreate the SVG treatment locally.

Use the neutral white line for ordinary measurements and activity volume. Use `tone="red"` only when the series itself measures errors or critical failures; it changes both the line and its gradient. Red bands mark exceptional or missed periods behind another series and do not change the meaning of the measured line itself.

```tsx
<TrendChart
    ariaLabel="Messages sent over the last 30 days"
    points={points}
    startPoint={{ position: 0, value: previousValue }}
    domainEnd={30}
    min={0}
    max={100}
/>
```
