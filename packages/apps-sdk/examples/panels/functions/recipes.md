# Functions: how this panel works

What a reader of the platform cannot work out from the panel itself. Its declaration and its projections say the rest,
and the platform describes those from their current definitions.

## What it covers

The domain's functions: find one, change its definition, create a new one, or delete one. A function's definition is one
form, the function owner's own. A read function queries data through its query package; a write function updates data
through its code, with the parameters it takes and the classes it returns. The panel neither runs nor tests a function.

## Finding a function

The list is the domain's `platform:Function` objects with their operation type. The search box narrows it to the
functions whose name or description contains the text typed, in any case, and the count says how many match.

Choosing one writes it into `selectedFunction` and the panel edits it (`mode` is `edit`); `backToList` lets go and the
panel returns to the list.

## Creating one

`newFunction` clears the selection and sets `mode` to `create`: the form then holds the owner's defaults for a new
function, a read function. Choose the operation type first: changing it changes the fields the form shows, and once the
function is saved its type no longer changes. Saving creates it and selects it.

The owner removes a user's function that no metric view, action or scheduled task uses twelve hours after its last
change: a function is kept only while something uses it.

## Functions in use cannot change

A function that a metric view, an action or a scheduled task uses can be neither changed nor deleted: its form is
read-only with the kind of use that holds it, and the owner refuses a save or a delete. A metric view's query is changed
from that metric view, not here. To change or delete a function an action or a scheduled task uses, change what uses it
first.

System functions and the source functions products publish cannot be changed or deleted either. The form shows which
fields are read-only and why.

Saving has no revision: the later save of a function replaces the earlier one.

## How a change gets here from an agent

A run may write a draft for this page (`function.update` for an existing function, `function.create` for a new one) and
hand the reader a link. Opening it fills the form after the owner has checked the whole draft, marks the fields it
changed and leaves them unsaved; the reader saves. A draft the owner refuses is refused whole, with the fields and the
reasons.
