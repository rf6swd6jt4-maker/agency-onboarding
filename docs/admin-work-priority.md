# Admin work priority

The Admin Work tab is a calculated, single-assignee execution queue. It does not persist a rank: it recalculates from current OKR measurements, expected movement, elapsed time, work history, dependencies, schedules, and timing priorities.

## Required forecast

Every new link between work and a committed Key Result requires:

- `expected_movement`: a positive, probability-weighted forecast expressed in the KR's unit.
- `impact_hypothesis`: a short explanation of why completing the work should cause that movement.

The forecast affects priority only. Completing work never writes an OKR measurement.

## KR attention

Raw currency, percentage, duration, and count gaps are not comparable. Each KR therefore receives a dimensionless attention value:

```text
remaining_progress = 1 - progress_percentage / 100
remaining_time = working_time_remaining / total_working_time
attention = remaining_progress / remaining_time
```

An attention of `1` means remaining progress matches remaining time. Above `1` means the KR is behind its required pace. Queue pressure is capped to `0.25..3` so an overdue KR matters without making every other objective disappear.

Active objectives have equal weight. Within each objective, its weight is shared equally by incomplete KRs; completed KRs consume no weight.

## Work value and rate

For each work-to-KR link:

```text
credited_movement = min(expected_movement, remaining_KR_gap)
normalized_movement = credited_movement / abs(target - baseline)
priority_value = objective_and_KR_weight * normalized_movement * attention_pressure * 100
```

A work item's values are summed when it credibly contributes to multiple KRs. Its selection rate is:

```text
impact_rate = priority_value / predicted_remaining_working_hours
```

The queue simulates completion one item at a time. After selecting work, its expected movement is subtracted from the projected KR gap before scoring the next item. This prevents several overlapping ideas from each receiving full credit for closing the same gap.

## Duration prediction

Duration is not entered manually. The queue learns from Admin work with both an actual start and actual completion:

- Median duration predicts expected time.
- The 80th percentile supplies the conservative scheduling time.
- Work-kind history is geometrically shrunk toward all Admin history until enough same-kind examples exist.
- With no history, the defaults are four expected hours and six conservative hours.
- An in-progress item's elapsed working time is removed from its remaining prediction.

Calculations currently use a deterministic Monday-Friday, 09:00-17:00 UTC working-time frame because workspaces do not yet store a timezone or working calendar.

## Timing and dependency rules

Manual priority is a timing constraint, not a competing rank:

- `Must do now`: latest safe start is now.
- `Can be done tomorrow`: must conservatively finish by the end of the next workday.
- `Can be done this week`: must conservatively finish by the end of Friday.
- `Backlog`: no priority horizon.
- An explicit due date/time adds another horizon; the earliest horizon wins.
- Critical maintenance behaves as `Must do now`.

Dependency deadlines propagate backward through prerequisites. Unfinished prerequisites block their dependants and inherit the best downstream impact rate, allowing enabling work to surface before the valuable item it unlocks.

At each queue position the selector applies this order:

1. Work whose latest safe start has arrived.
2. Already in-progress work, when it fits before the next safe start.
3. The highest projected impact rate that fits before the next safe start.
4. The next timing obligation.
5. Remaining backlog in stable priority/creation order.

Blocked, waiting, and future-start work remains visible outside the actionable rank. Completed and canceled work is retained below the queue because its actual timing supplies future duration evidence.
