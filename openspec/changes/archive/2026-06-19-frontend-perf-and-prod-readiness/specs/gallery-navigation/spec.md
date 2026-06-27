## ADDED Requirements

### Requirement: Skip-to-month navigation
The album page SHALL render a navigation control per date group that scrolls the grid
to that group, driven by the manifest's groups.

#### Scenario: Jump to a month
- **WHEN** a user activates a date-group navigation control
- **THEN** the grid scrolls to the start of that group

### Requirement: Deep-link to a specific image
The album page SHALL accept URL parameters that open the lightbox at a specific image,
and SHALL update the URL as the user pages through the lightbox, so a specific image is
shareable and restored on back/forward navigation.

#### Scenario: Open a shared deep link
- **WHEN** a user navigates to an album URL that references a specific image
- **THEN** the lightbox opens at that image

#### Scenario: URL reflects the viewed image
- **WHEN** a user pages to another image in the lightbox
- **THEN** the URL updates to reference the currently viewed image

### Requirement: Custom 404 page
The application SHALL serve a custom not-found page for unknown routes instead of the
framework default.

#### Scenario: Unknown route
- **WHEN** a user navigates to a route that does not exist
- **THEN** the custom 404 page is shown

### Requirement: Dead collection link removed
The album page SHALL NOT link to a `/collection/<album>` route. The scalable sprite
album view is the path to full-size images; the previously dead link SHALL be removed
so no navigation leads to a non-existent page.

#### Scenario: No dead collection navigation
- **WHEN** a user views an album
- **THEN** there is no link to a `/collection/<album>` page (no 404 path is reachable from the album view)
