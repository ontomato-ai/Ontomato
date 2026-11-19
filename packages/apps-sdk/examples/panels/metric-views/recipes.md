# Metric views: how this panel works

What a reader of the platform cannot work out from the panel itself. Its declaration and its projections say the rest,
and the platform describes those from their current definitions.

## What it covers

The domain's metric views: find one, change its definition, its bindings or its status, create a new one, or delete
one. A metric view's definition is one form, the metric owner's own: what the metric view is and the questions it
answers, the query that calculates it, and its bindings. Testing a definition, changing the status of several metric
views at once and generating one from a description are not part of this panel yet.

## Finding a metric view

The list is the domain's `platform:MetricView` objects. The search box narrows it to the metric views whose name or
description contains the text typed, in any case, and the count says how many match. Look for an existing metric view before
creating one: a metric view that already calculates the figure, perhaps with another binding, is the one to reuse.

Choosing one writes it into `selectedMetric` and the panel edits it (`mode` is `edit`); `backToList` lets go and the panel
returns to the list.

## Creating one

`newMetric` clears the selection and sets `mode` to `create`: the form then holds the owner's defaults for a new metric
view, pending review. Saving creates it and selects it. The owner removes a user's metric view that is still pending
review twelve hours after its last change (one adopted as a candidate stays until it is reviewed): publish it, or set it
to unused, to keep it.

## Changing the definition and its bindings

A binding is one named use of the metric view: its own name, description, matching questions and a value for each
parameter the query declares. Bindings share the metric view's calculation and its publication status, so a change to
the query, its column labels or the status applies to every binding at once; change a binding only for what is its
own. When the query's parameters change, each binding's parameter values follow them. Bindings are saved with the
metric view, in the same form and the same save; one binding is never saved alone.

The query is a function the metric view embeds. Other metric views may use the same function: saving changes it for them
too, and the owner checks their bindings against the new parameters before it saves anything.

Saving has no revision: the later save of a metric view replaces the earlier one.

## Changing the status

The status is a field of the form: pending review, published or unused. Changing it is an ordinary save; publishing
records the reader as the one who last published it.

## What the owner refuses

A system metric view cannot be changed or deleted. A metric view whose pending query comes from a workflow is changed in
that workflow, not here. The form shows which fields are read-only and why.

## Deleting

Deleting the chosen metric view deletes its bindings with it.

## How a change gets here from an agent

A run may write a draft for this page (`metric-view.update` for an existing metric view, `metric-view.create` for a new
one) and hand the reader a link. Opening it fills the form after the owner has checked the whole draft, marks the fields
it changed and leaves them unsaved; the reader saves. A draft the owner refuses is refused whole, with the fields and the
reasons.
