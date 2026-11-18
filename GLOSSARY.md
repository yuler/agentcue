# agentcue

Visual feedback bridge that lets a developer pick elements on a rendered web page and push structured change requests directly to a local coding agent.

## Language

**Pin**:
A single selected DOM element on the rendered page paired with a short user note describing the desired change.
_Avoid_: Annotation, comment, marker, issue

**Cue**:
A batch of one or more Pins dispatched together in a single push to an Agent Target.
_Avoid_: Task, payload, ticket, submission

**Agent Target**:
A local coding agent CLI registered to receive and execute a Cue against the project workspace.
_Avoid_: Provider, model, backend, worker

**Pick Mode**:
The active browser inspection state in which pointer interactions select DOM elements to create or edit Pins instead of triggering the host page's own events.
_Avoid_: Inspect mode, edit mode, select mode
