---
name: application-design
description: Design coherent Ontomato applications and demos using the platform SDK, shared theme and reusable product assets.
metadata:
  ontomato.title: Application design
---

# Application design

Use this guidance when creating or refining a platform application. Read the current SDK documentation before choosing components. Discover existing product assets and capabilities; reuse them where their behavior fits.

## Plan the work surface

Identify the reader, their main task and the next action. Give each page one clear title, a useful default view and one primary action. A demo should present real business data and a complete path from overview to detail and action. Keep technical IDs, revisions, SDK details and implementation explanations out of the normal interface.

The personal home contains the reader's shortcuts and continued work. The application gallery discovers applications and agents. Business apps contain business workflows and resources. Do not recreate the gallery, platform navigation or personal home inside every app.

## Use the platform's visual language

Use the SDK's Vue, Element Plus and platform components; follow the host theme and locale. Use semantic CSS variables for text, surfaces, borders and interaction. Do not hard-code a light theme or load external fonts, styles or scripts.

Prefer continuous work surfaces, compact toolbars and clear section headings. Use 8px for related controls, 12–16px within content groups and 20px between independent modules. Match existing platform controls and overlays before inventing local ones. Avoid redundant titles, nested cards, decorative badges and repeated icons. Choose distinct, meaningful icons where they help identify resource types.

Use subtle borders and supported small radii for content panels; reserve shadows for floating menus, dialogs and composers. Do not add gradients, colored shadows or excessive rounded cards to make a demo look sophisticated. Visual polish should clarify hierarchy, not obscure the task.

## Render and interact correctly

Read published MetricViews and execute published Actions through the SDK. Business calculations and authorization never belong in page conditions. Render Action forms from their declared fields. After a successful write, refresh the affected results and show the actual outcome. Disable busy actions explicitly rather than silently ignoring clicks.

Give charts the available plot area, retain enough room for labels and legends, and choose a chart suited to the data. Do not drop categories to solve layout problems without telling the reader. Use the platform chart theme and renderer. Avoid duplicate metrics on the same work surface.

Handle loading, empty, unavailable and failed states separately. A failure must not look like zero or an empty successful query. Keep the last successful useful state when an auxiliary refresh fails.

## Verify the result

Check a normal desktop, a short window and a narrow viewport. Each area should have one intentional scroll owner, with min-height:0 in flex layouts. Embedded content grows with its content; full-page editors fill the remaining height. Check fixed headers, bottom controls, long labels and dropdown placement. Use keyboard-accessible buttons and visible focus, explicit labels and adequate contrast.

Verify the actual application path: open, select/filter, inspect a detail, return, and pin or remove a home shortcut where appropriate. Do not report a visual review or successful write unless it was actually performed.
