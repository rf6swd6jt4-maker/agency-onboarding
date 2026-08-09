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

## PanelTabHeader

`PanelTabHeader` is the canonical heading block for a workspace panel tab. It names the active tab and its primary content, not the wider panel that contains it.

```tsx
<PanelTabHeader
    title="Leads"
    description="Qualified owner-phone leads from the latest poll."
    actions={<NewPollButton />}
    tabs={<PanelTabs items={leadGenTabs} active="leads" ariaLabel="Lead Gen panel" />}
/>
```

- A panel home route uses the home tab or list name: `Work Queue`, never `Admin`; `Leads`, never `Lead Gen`.
- The description directly explains the active tab's content, ordering, or purpose. It must not summarize every capability in the parent panel. Begin with stable copy that identifies the list; a following sentence may adapt to the current list contents.
- When the panel contains multiple tabs, `PanelTabs` occupy a dedicated row immediately beneath the description and above `QuickStats`, filters, or tab content. They remain horizontally scrollable on mobile.
- The title-to-description gap is always fixed. On desktop the description occupies a stable two-line-minimum slot with its copy aligned to the top; sibling tabs therefore keep actions and tabs at the same vertical position without creating extra space between a one-line description and its title.
- Optional primary actions occupy the header's right-hand action slot on desktop and anchor to the bottom of that stable description slot. This prevents actions and tabs jumping vertically when descriptions differ by one line.
- Put one principal action in this slot, such as `New Poll` or `Start new relationship`. Supplementary metadata may sit immediately before it, but the primary action remains the final, rightmost control.
- On mobile the action slot follows the description and uses the full available width without displacing the title or tab row.
- Do not place tab navigation beside the title, inside the action slot, below statistics, or in page-local wrappers with different spacing.
- A tab containing a list has exactly one page heading. Do not repeat the list name or add another explanatory list header between the panel tabs and the list.
- If a tab changes its principal content through a tab query such as Admin Work/OKRs, the heading and description change with the selected tab.

The standard vertical order is:

1. `PanelTabHeader`: title and description/action row, then `PanelTabs` when the panel has tabs.
2. `QuickStats` or another approved analytical summary.
3. One or more `FilterRail` rows.
4. The list itself.

Do not place filters above quick statistics when both are present.

A list tab must not insert a page-specific summary, capacity note, explanatory paragraph, owner roll-up, or other bespoke information block between these standard elements. Put stable explanatory copy in the tab description, append genuinely useful dynamic context to that description, express a compact measurement through `QuickStats`, or omit it. Transactional errors and actionable warnings use the platform's approved notice treatment and are not list summaries.

## QuickStats

`QuickStats` is the canonical compact summary strip above a list. The Polls tab is the visual reference. It communicates a small set of immediately useful counts or short measurements; it is not a filter and its boxes are not individually clickable.

```tsx
<QuickStats items={[
    { label: "Running", value: runningCount },
    { label: "History", value: pollCount },
    { label: "Source checks", value: checkCount, hideOnMobile: true },
    { label: "Raw returned", value: rawCount },
]} />
```

- Use three visible statistics on mobile. A fourth lower-priority statistic may set `hideOnMobile` and return from `sm` upward.
- Mobile renders one consolidated, bordered strip with internal dividers. Desktop separates the same statistics into evenly sized bordered boxes.
- Labels are short neutral text; values are prominent, tabular, and limited to one line.
- Prefer current list facts such as actionable count, reserved time, open failures, or poll results. Do not fill the strip with decorative totals.
- Capacity and forecast information belongs here when it can be expressed compactly, for example `Capacity — 10h late`; do not repeat it in a prose block beneath the filters.
- `QuickStats` summarizes the currently meaningful list scope. Filtering may update the values when that makes the summary more truthful.
- Use `StatusStat` for small inline status counts inside a settings or status context; use `QuickStats` for the top-of-list summary strip.

## FilterRail

`FilterRail` is the canonical list-filtering mechanic. Its appearance and behaviour come from the Relationships lifecycle rail.

```tsx
<FilterRail ariaLabel="Filter relationships by lifecycle stage">
    <FilterRailLink href={allHref} selected={!phase}>All <FilterRailCount>{allCount}</FilterRailCount></FilterRailLink>
    <FilterRailLink href={leadHref} selected={phase === "lead"}>Lead <FilterRailCount>{leadCount}</FilterRailCount></FilterRailLink>
</FilterRail>
```

- Each rail represents one filtering dimension. Use a second rail with `spacing="tight"` when a list genuinely needs another dimension, such as Maintenance state plus category.
- The selected option uses plain white text and a white underline. Unselected options remain neutral and acquire only a restrained hover underline.
- Counts sit beside labels in subdued tabular text and should reflect the other currently selected filter dimensions.
- Prefer `FilterRailLink` and URL-backed query parameters so filters survive refresh, back/forward navigation, sharing, and tab restoration.
- Use `FilterRailButton` only for local interactive state that cannot reasonably be URL-backed, such as the live Work Queue's Business/My work view.
- Rails never wrap. They scroll horizontally on mobile while preserving option order.
- Do not recreate filter pills, segmented boxes, dropdowns, or page-local category chips when the available choices fit a rail.
- When `QuickStats` and `FilterRail` are both present, every stats block comes first and the first rail follows beneath it.

## List

`List` is the canonical presentation for a collection of comparable records that people need to scan, open, and act on. Leads, polls, and relationships are the reference implementations. A list is not a gallery, settings form, navigation rail, timeline, disclosure log, or nested planning structure such as OKRs.

### Anatomy

Use the primitives in `components/list`:

```tsx
<List ariaLabel="Polls">
    <ListItem>
        <MobileListActionSurface actions={actions}>
            <ListPrimaryRow>
                <ListTitle href={itemHref}>Item name</ListTitle>
                {/* categorical labels */}
                <Status label="In progress" tone="yellow" className="ml-auto" />
            </ListPrimaryRow>
            <ListSecondaryRow>
                {/* flexible domain metadata */}
                <ListTrailing>
                    {/* ID, time, creator, desktop actions */}
                </ListTrailing>
            </ListSecondaryRow>
        </MobileListActionSurface>
    </ListItem>
</List>
```

- `List` owns the consolidated black surface, `rounded-2xl` outer corners, neutral border, clipping, and list semantics.
- `ListItem` owns the divider between records and the restrained hover highlight. Its divider uses `border-neutral-800`, exactly matching the outer list border. Do not wrap every item in its own floating card.
- `ListPrimaryRow` is the identity and state band. It has the subtly tinted surface and an internal `border-neutral-900` divider.
- `ListSecondaryRow` is the supporting-information band. It is always one line and never wraps.
- `ListTitle` is the primary identity, always placed first and given the flexible width. Link it whenever the record has a canonical destination. It truncates rather than displacing state or actions.
- `ListTrailing` is the stable audit/action cluster at the end of the supporting row.

### Information order

The primary row follows this order:

1. Primary item name on the left.
2. Stable categorical labels immediately after the name, such as `Test`, `Manual`, or `RelationshipStage`.
3. Exactly one operational `Status` aligned to the right. A compact companion such as poll duration may sit beside it.

The secondary row follows this order:

1. Domain-specific supporting information in descending importance.
2. Measurements, contact routes, source information, or assigned-item pills where relevant.
3. `ListTrailing`, ordered as short ID, relevant relative time, creator, then overflow actions.

The meaning of the time may vary—created, updated, or latest activity—but its position and subdued treatment do not. Use the creator tooltip to disclose whether an item was created or added and its exact timestamp.

### Content and density

- Lists are intentionally two rows. Do not flatten them into a dense one-row table at wide breakpoints.
- Keep the primary row calm. It contains identity, categorical labels, and one operational status—not general metadata.
- The secondary row is flexible rather than column-prescriptive. Omit unavailable fields cleanly; do not render empty column placeholders.
- Use `text-sm` and neutral supporting colours. Reserve `text-base font-medium` for the primary name.
- Use the shared `Status`, pill, stage, creator, and action components. Do not recreate their appearance locally.
- Use short, scannable values. Longer explanation belongs on the detail page or in an intentionally designed preview field.
- Keep one obvious primary destination and move secondary operations into `ListActionMenu`.

### Responsive behaviour

- Preserve the same two semantic rows at every breakpoint.
- Each semantic row is exactly one visual line high. Neither text nor a UI element may wrap beneath another item inside that row; a two-line primary or secondary band is not permitted.
- The title receives flexible space and truncates first. Primary labels, stages, and statuses are single-line, non-wrapping elements.
- On the secondary row, preserve the most important domain value on mobile and progressively reveal lower-priority values at `sm`, `md`, `lg`, and `xl`. Do not attempt to retain every desktop field by wrapping it.
- Mobile priority is: the short ID, one useful non-sensitive core measurement where appropriate, then the relative time and creator. The short ID is always visible. Secondary descriptive metadata, locations, and assigned-item pills appear only when the available breakpoint can accommodate them on the same line.
- Relationship phone numbers, WhatsApp numbers, and email addresses are never shown in the mobile list. They return at their documented wider breakpoints and remain available as copy actions in the mobile action popup.
- Assigned services use `MobileAssignedServices` below `sm`: show the first unique service as an emerald `RoundPill`, followed by a plain `+N` count when more unique services are assigned. Never render a second service pill on the mobile row. When none are assigned, show `No assigned services` in neutral supporting text rather than leaving an unexplained gap.
- Mobile and desktop service renderers must be mutually exclusive. Put responsive `hidden`/display classes on a wrapper around desktop pills, never directly on `RoundPill`; the primitive owns `inline-flex`, so using it as the responsive switch can leak desktop pills into the mobile row and displace `ListTrailing`.
- Truncation is for flexible text values such as names, phone numbers, email addresses, and locations. Fixed semantic controls—`Status`, `RelationshipStage`, pills, creator, and actions—must remain intact rather than compressing or splitting.
- When several values share a band, order them by importance so overflow removes the least important information first. Do not use horizontal scrolling to expose ordinary list metadata.
- The outer list remains one consolidated collection on mobile and desktop; do not switch between separate cards and a table at an arbitrary breakpoint.
- Mobile rows use slightly tighter vertical padding than desktop rows. Preserve the shared `py-2 sm:py-2.5` rhythm rather than overriding row height per feature.

The two divider colours are deliberately different: the darker `border-neutral-900` separates the primary and secondary bands within one record, while the stronger `border-neutral-800` separates records and matches the list perimeter. This alternating rhythm must remain visible on mobile and desktop.

### Interaction and exceptional state

- Every `ListItem` receives the shared subtle hover background so the active record is easy to track across a wide row.
- On mobile, `MobileListActionSurface` makes the entire item one accessible action target. Tapping anywhere opens the item's action popup; it does not navigate immediately. The canonical `Open …` action is first, followed by secondary and destructive actions.
- The three-dot `ListActionMenu` is hidden on mobile. From `sm` upward, the action surface disappears, the linked title is the default navigation affordance, and the three-dot menu is restored as the final element.
- Destructive operations remain inside the action popup and keep their confirmation behaviour at every breakpoint.
- Creator avatars in lists use the stable, versioned `/api/profile-avatars/[username]` rendition rather than direct signed upload URLs. This keeps the displayed file small and cacheable across tab openings; do not restore per-render signed URLs in list implementations.
- A genuine failed or critical record may add a very faint semantic wash to `ListItem`, but this must not replace its `Status` or alter the standard geometry.

### Reference mappings

- Lead: owner and company; callability status; phone, source, industry, location, score; ID, created time, Betelgeze creator, actions.
- Poll: source summary; manual/automated label; poll status and duration; pipeline counts; ID, created time, creator, actions.
- Relationship: person and business; Test and lifecycle labels; work status; role, contact routes, location and assigned services; ID, updated time, creator, actions.

When a new list cannot fit this anatomy, first determine whether it is actually a list. Do not extend the standard merely to make galleries, timelines, settings rows, evidence disclosures, or nested planning structures resemble one.

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
