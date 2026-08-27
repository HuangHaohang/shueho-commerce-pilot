# Creative Space Foundation

## Product Boundary

Creative Space is the AI content-creator workbench for planning, shooting, editing, and reviewing short-form commerce content. A content project is the container for one core topic or content direction. Content remains the primary object; Codex threads, Skills, and tools provide capabilities inside or alongside that context.

The phase-one information architecture is:

```text
Creative Space
├── My Work
├── Content Projects
├── Inspiration & Cases
└── AI Toolbox
    ├── Copywriting
    ├── Script generation
    ├── Image generation
    └── Video generation
```

`My Work` is a derived personal view and is not a persisted business entity. A project may have one lead and multiple participating members. One project may contain multiple script, edit, and platform-release versions, but it must not combine unrelated core topics.

## Project Chapters

The project-level chapter index is `Overview`, `Requirements`, `Product`, `Topic`, `Format`, `Script`, `Shooting`, `Editing`, `Final`, `Data`, and `Review`. AI pre-review, final shooting script, and video review belong inside their relevant chapters rather than becoming project-level stages.

The chapter index is navigational, not an approval workflow. Users can move freely between chapters, and the UI must read as a growing creative document rather than a project-management record.

## Integration Boundaries

- A content project may have zero or one source task; one task may create multiple content projects.
- Project creation can begin from either New Task or Creative Space. Phase one implements only the Creative Space mock interaction.
- Research and knowledge-library records will be referenced rather than copied into project fields.
- Project history retains working output automatically. Publishing selected results to the team knowledge library requires explicit human confirmation; AI may recommend but may not publish automatically.
- Tenant, workspace, membership, and RLS boundaries remain authoritative. Phase one does not add a project-specific permission system.
- Codex App Server remains authoritative for thread and Turn lifecycle. A future project may bind several purpose-specific threads; a project must not be modeled as if it were itself a Codex thread.

## Phase-One Implementation

The browser uses typed adapter boundaries with in-memory mock implementations. `CreativeSpaceAdapter` owns mock projects, people, products, inspiration, and project creation. `my-creative-adapter` derives the personal dashboard from those projects plus short-video task facts, including production stages, next actions, collaboration activity, and recent outputs. This keeps task-system mapping and future role-based ordering outside page components while the BFF contract is pending. No database schema or persistence claim is introduced in this phase.

`My Work` is presented as a creator dashboard rather than a team or task-system dashboard. Its production track filters the next-action list, its focus area selects the most valuable content to continue, and its activity and recent-output sections link back to existing content projects. Search, time, role, stage, focus switching, and recent-content tabs are client-side interactions over adapter data in this phase.

The existing conversational copywriting Task Recipe remains unchanged and is opened from AI Toolbox. The other toolbox entries are visibly unavailable until their real backend behavior exists.
