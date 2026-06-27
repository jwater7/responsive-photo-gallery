# vendored-image-toolkit Specification

## Purpose
TBD - created by archiving change frontend-perf-and-prod-readiness. Update Purpose after archive.
## Requirements
### Requirement: Libraries vendored in-tree as source of truth
The project SHALL contain `fast-image-processing` and `jwt-user-auth` as in-tree
packages rather than `github:jwater7/*` dependencies, and the application SHALL
consume the in-tree copies. The first commit introducing each vendored package
SHALL be a verbatim copy of the upstream release (`fast-image-processing` v0.0.5,
`jwt-user-auth` v0.0.3) so it is diffable against upstream; modifications SHALL land
in subsequent commits.

#### Scenario: Application resolves the in-tree library
- **WHEN** the backend imports `fast-image-processing` or `jwt-user-auth`
- **THEN** it resolves to the in-tree package, not a GitHub-pinned dependency

#### Scenario: Verbatim first commit
- **WHEN** the diff between the initial vendored copy and the upstream release tag is taken
- **THEN** there are no functional differences (provenance is auditable)

### Requirement: Sprite-sheet and collage primitives
`fast-image-processing` SHALL expose primitives to compose a sprite sheet from
multiple source images packed into uniform cells, and to compose a collage/montage
cover from a set of source images, returning the output image and the geometry of
each placed cell. Each source image SHALL be decoded once to obtain its capture date
(EXIF), dimensions, and resized cell in a single pass.

#### Scenario: Build a sprite sheet
- **WHEN** the primitive is given a list of images, a cell size, and a layout
- **THEN** it returns a single composed image plus, for each image, the cell's x/y/w/h and the source's oriented dimensions

#### Scenario: Build a collage cover
- **WHEN** the collage primitive is given an album's images and a target canvas
- **THEN** it returns a single composed cover image suitable for the home preview

#### Scenario: Single decode per image
- **WHEN** an image is processed during a sprite/collage build
- **THEN** its EXIF capture date and dimensions are obtained from the same decode used to produce its cell

### Requirement: Widened JWT signing key
`jwt-user-auth` SHALL generate signing/secret material with at least 256 bits of
entropy when it generates a key, replacing the prior 96-bit (`randomBytes(3*4)`)
generation. An operator-supplied `PRIVATE_KEY` SHALL continue to take precedence, and
the token format SHALL remain compatible (same HS256 secret-based signing).

#### Scenario: Generated key entropy
- **WHEN** the library generates a signing key because none is supplied or persisted
- **THEN** the key has at least 256 bits of entropy

#### Scenario: Supplied key still honored
- **WHEN** `PRIVATE_KEY` (or the persisted DB key) is present
- **THEN** the library uses it unchanged and existing tokens remain valid

