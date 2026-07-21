// vim: tabstop=2 shiftwidth=2 expandtab
//
// User accounts: list / create / delete accounts and reset passwords. Fully
// self-contained (own load + mutation state). Reset-password is an inline
// per-row input (toggled via `resetFor`) rather than a modal, to stay light.

import { useState, useEffect } from 'react'
import {
  Row,
  Col,
  Button,
  Card,
  Badge,
  Alert,
  Form,
  InputGroup,
} from 'react-bootstrap'
import {
  listUsers,
  createUser,
  setUserPassword,
  deleteUser,
} from '../../lib/api'
import InfoTip from './InfoTip'

export default function UsersPanel({ loggedIn }) {
  // `users` is null while loading.
  const [users, setUsers] = useState(null)
  const [usersMsg, setUsersMsg] = useState(null)
  const [userBusy, setUserBusy] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [resetFor, setResetFor] = useState(null)
  const [resetPw, setResetPw] = useState('')

  const loadUsers = async () => {
    try {
      setUsers(await listUsers())
    } catch (err) {
      setUsers([])
      setUsersMsg({ variant: 'danger', text: 'Could not load users.' })
    }
  }

  useEffect(() => {
    if (!loggedIn) return
    loadUsers()
  }, [loggedIn])

  const addUser = async () => {
    setUserBusy(true)
    setUsersMsg(null)
    try {
      await createUser(newUsername.trim(), newPassword)
      setNewUsername('')
      setNewPassword('')
      setUsersMsg({
        variant: 'success',
        text: `User "${newUsername.trim()}" created.`,
      })
      await loadUsers()
    } catch (err) {
      setUsersMsg({
        variant: 'danger',
        text: err.message || 'Could not create user.',
      })
    } finally {
      setUserBusy(false)
    }
  }

  const savePassword = async (username) => {
    setUserBusy(true)
    setUsersMsg(null)
    try {
      await setUserPassword(username, resetPw)
      setResetFor(null)
      setResetPw('')
      setUsersMsg({
        variant: 'success',
        text: `Password updated for "${username}".`,
      })
    } catch (err) {
      setUsersMsg({
        variant: 'danger',
        text: err.message || 'Could not set password.',
      })
    } finally {
      setUserBusy(false)
    }
  }

  const removeUser = async (username) => {
    setUserBusy(true)
    setUsersMsg(null)
    try {
      await deleteUser(username)
      setUsersMsg({ variant: 'success', text: `User "${username}" deleted.` })
      await loadUsers()
    } catch (err) {
      setUsersMsg({
        variant: 'danger',
        text: err.message || 'Could not delete user.',
      })
    } finally {
      setUserBusy(false)
    }
  }

  return (
    <Card>
      <Card.Body>
        <Card.Title>
          User accounts{' '}
          <InfoTip id="users-help" label="What can user accounts do?">
            Create and remove accounts and reset passwords. New passwords are
            stored hashed.
            <hr className="my-2" />
            There are no separate permission levels yet — every account can
            sign in and reach this admin page. You can’t delete your own
            account or the last remaining one.
          </InfoTip>
        </Card.Title>

        {usersMsg && (
          <Alert
            variant={usersMsg.variant}
            dismissible
            onClose={() => setUsersMsg(null)}
          >
            {usersMsg.text}
          </Alert>
        )}

        {users === null ? (
          <Card.Text>Loading…</Card.Text>
        ) : (
          <>
            {users.length === 0 ? (
              <Card.Text className="text-muted">No users.</Card.Text>
            ) : (
              <ul className="list-unstyled mb-3">
                {users.map((u) => (
                  <li key={u.username} className="mb-2">
                    <strong>{u.username}</strong>{' '}
                    {(u.roles || []).map((r) => (
                      <Badge bg="secondary" key={r} className="me-1">
                        {r}
                      </Badge>
                    ))}{' '}
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      className="py-0 px-1 ms-1"
                      onClick={() => {
                        setResetFor(resetFor === u.username ? null : u.username)
                        setResetPw('')
                      }}
                    >
                      Reset password
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="outline-danger"
                      className="py-0 px-1"
                      disabled={userBusy}
                      onClick={() => removeUser(u.username)}
                    >
                      Delete
                    </Button>
                    {resetFor === u.username && (
                      <InputGroup className="mt-1" style={{ maxWidth: '24rem' }}>
                        <Form.Control
                          type="password"
                          placeholder="New password"
                          value={resetPw}
                          onChange={(e) => setResetPw(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              if (resetPw) savePassword(u.username)
                            }
                          }}
                        />
                        <Button
                          variant="outline-secondary"
                          disabled={userBusy || !resetPw}
                          onClick={() => savePassword(u.username)}
                        >
                          Save
                        </Button>
                      </InputGroup>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <strong>Add a user</strong>
            <Row className="g-2 mt-1" style={{ maxWidth: '32rem' }}>
              <Col xs={12} sm={5}>
                <Form.Control
                  placeholder="Username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                />
              </Col>
              <Col xs={12} sm={5}>
                <Form.Control
                  type="password"
                  placeholder="Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (newUsername.trim() && newPassword) addUser()
                    }
                  }}
                />
              </Col>
              <Col xs="auto">
                <Button
                  onClick={addUser}
                  disabled={userBusy || !newUsername.trim() || !newPassword}
                >
                  {userBusy ? '…' : 'Add'}
                </Button>
              </Col>
            </Row>
          </>
        )}
      </Card.Body>
    </Card>
  )
}
