// vim: tabstop=2 shiftwidth=2 expandtab
//
// Hidden albums & folders (the admin exclude list). Fully self-contained:
// loads the current excludes + the visible album list, edits a working copy,
// and saves the whole list at once (the server normalizes, reaps
// newly-excluded albums' build cache, and fires a background enrichment reap).

import { useState, useEffect } from 'react'
import {
  Row,
  Col,
  Button,
  Card,
  Alert,
  Form,
  InputGroup,
} from 'react-bootstrap'
import { albums as fetchAlbums, getExcludes, setExcludes } from '../../lib/api'
import InfoTip from './InfoTip'

export default function ExcludesPanel({ loggedIn }) {
  // `excludes` is the working copy (null while loading); `albumNames` is the
  // list of currently-VISIBLE albums (the /albums route already hides excluded
  // ones, so the full top-level set = visible names ∪ top-level excludes).
  const [excludes, setExcludesState] = useState(null)
  const [albumNames, setAlbumNames] = useState([])
  const [excludesBusy, setExcludesBusy] = useState(false)
  const [excludesMsg, setExcludesMsg] = useState(null)
  const [newPath, setNewPath] = useState('')

  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    ;(async () => {
      try {
        const [ex, al] = await Promise.all([getExcludes(), fetchAlbums()])
        if (cancelled) return
        setExcludesState(ex)
        // The album universe shown as checkboxes. /albums already HIDES excluded
        // albums, so a currently-excluded top-level album is absent from `al` and
        // only re-enters the list via the excludes. Fold the loaded top-level
        // excludes in here so the universe is stable: unchecking one removes it
        // from the working excludes without making it vanish from the list (it
        // stays a visible, now-unticked checkbox until Save).
        const topEx = (ex || []).filter((e) => !e.includes('/'))
        setAlbumNames(
          Array.from(new Set([...Object.keys(al || {}), ...topEx])).sort()
        )
      } catch (err) {
        if (!cancelled) setExcludesState([]) // show the panel; albums may be empty
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loggedIn])

  const toggleAlbum = (name) => {
    setExcludesState((cur) => {
      const set = new Set(cur || [])
      if (set.has(name)) set.delete(name)
      else set.add(name)
      return Array.from(set)
    })
  }

  const addNested = () => {
    const p = newPath.trim()
    if (!p) return
    setExcludesState((cur) => Array.from(new Set([...(cur || []), p])))
    setNewPath('')
  }

  const removeEntry = (entry) => {
    setExcludesState((cur) => (cur || []).filter((e) => e !== entry))
  }

  const saveExcludes = async () => {
    setExcludesBusy(true)
    setExcludesMsg(null)
    try {
      const saved = await setExcludes(excludes || [])
      setExcludesState(saved) // server-normalized
      setExcludesMsg({
        variant: 'success',
        text: 'Saved. Excluded albums are now hidden; cache and index cleanup run in the background.',
      })
    } catch (err) {
      setExcludesMsg({ variant: 'danger', text: 'Could not save excludes.' })
    } finally {
      setExcludesBusy(false)
    }
  }

  const topLevelExcludes = (excludes || []).filter((e) => !e.includes('/'))
  const nestedExcludes = (excludes || []).filter((e) => e.includes('/'))
  const allAlbums = Array.from(
    new Set([...albumNames, ...topLevelExcludes])
  ).sort()

  return (
    <Card>
      <Card.Body>
        <Card.Title>
          Hidden albums &amp; folders{' '}
          <InfoTip
            id="excludes-help"
            label="What does excluding a directory do?"
          >
            Excluded folders are invisible everywhere: the album list, the
            thumbnail/sprite cache, and search/map enrichment.
            <hr className="my-2" />
            Tick a top-level album to hide the whole album. Add a{' '}
            <strong>nested path</strong> (e.g. <code>work/scans</code>) to hide
            just a subfolder while the album still shows.
            <hr className="my-2" />
            Paths are relative to the photo root, using <code>/</code>{' '}
            separators. Changes take effect on Save (cache + index cleanup run
            in the background).
          </InfoTip>
        </Card.Title>

        {excludesMsg && (
          <Alert
            variant={excludesMsg.variant}
            dismissible
            onClose={() => setExcludesMsg(null)}
          >
            {excludesMsg.text}
          </Alert>
        )}

        {excludes === null ? (
          <Card.Text>Loading…</Card.Text>
        ) : (
          <>
            <div className="mb-3">
              <strong>Albums</strong>
              <div className="text-muted small mb-2">
                Tick an album to hide it everywhere.
              </div>
              {allAlbums.length === 0 ? (
                <span className="text-muted">No albums found.</span>
              ) : (
                <Row>
                  {allAlbums.map((name) => (
                    <Col xs={12} sm={6} md={4} key={name}>
                      <Form.Check
                        type="checkbox"
                        id={`exclude-${name}`}
                        label={name}
                        checked={topLevelExcludes.includes(name)}
                        onChange={() => toggleAlbum(name)}
                      />
                    </Col>
                  ))}
                </Row>
              )}
            </div>

            <div className="mb-3">
              <strong>Nested paths</strong>
              <div className="text-muted small mb-2">
                Hide a subfolder inside an otherwise-visible album.
              </div>
              {nestedExcludes.length > 0 && (
                <ul className="list-unstyled mb-2">
                  {nestedExcludes.map((entry) => (
                    <li key={entry} className="mb-1">
                      <code>{entry}</code>{' '}
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        className="py-0 px-1 ms-1"
                        onClick={() => removeEntry(entry)}
                        aria-label={`Remove ${entry}`}
                      >
                        ✕
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <InputGroup style={{ maxWidth: '24rem' }}>
                <Form.Control
                  placeholder="e.g. work/scans"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addNested()
                    }
                  }}
                />
                <Button
                  variant="outline-secondary"
                  onClick={addNested}
                  disabled={!newPath.trim()}
                >
                  Add
                </Button>
              </InputGroup>
            </div>

            <Button onClick={saveExcludes} disabled={excludesBusy}>
              {excludesBusy ? 'Saving…' : 'Save excludes'}
            </Button>
          </>
        )}
      </Card.Body>
    </Card>
  )
}
