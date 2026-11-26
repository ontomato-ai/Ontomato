# Scheduled tasks panel: how this scenario works

What this panel is for, and the few things about it a reader of the platform cannot work out from the panel itself. The
panel's declaration (its state and the projections it composes) and its projections say the rest, and the platform
describes those from their current definitions.

## What it covers

One of the reader's scheduled tasks, from the task's own application: pick it, see it, change it through the form its
application declares, save it, and run it now. It does not create, delete, enable, disable or list runs.

## How a task is chosen

The list is the platform's own `platform:Trigger` objects — the reader's tasks in the service's order. Choosing a
row writes that task into the panel's `selectedTask`, and the summary, the form and the button take it from there. A
second click on the chosen row lets go of it.

The choice belongs to the panel instance, not to the panel: two readers, or two pages of the same reader, keep their own.

## How the form changes

The form is the task's application's own: which fields it has, which of them a change makes the others depend on, and
what a save accepts are all the application's answers. Changing such a field asks the application again, and its whole
answer replaces the fields and their values — a field the new answer removed disappears with its value.

Only one application's form changes with a field today: the operations application, whose first field chooses between
running automated tests and running an inspection, each with its own fields.

## How a change gets here from an agent

An assistant beside this page selects the task via `present`, fills explicit fields in the mounted form via `fill_form`
(marking changed fields and keeping the form unsaved), and submits via `page_action` when requested (confirming in
conversation by default). Nothing is written until saved.

## What a save and a run act on

Both act on the task currently selected in the panel instance. Saving writes it through its application's own interface
with the task's own revision, so a task somebody else changed meanwhile is refused rather than overwritten. Running it
now starts one execution and leaves the schedule as it is.
