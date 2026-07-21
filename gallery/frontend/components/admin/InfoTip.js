// vim: tabstop=2 shiftwidth=2 expandtab
//
// The admin cards' ⓘ help affordance: a hover/focus tooltip next to a card
// title. One component instead of the seven copies of the OverlayTrigger
// boilerplate the page grew.

import { OverlayTrigger, Tooltip } from 'react-bootstrap'

export default function InfoTip({ id, label, children }) {
  return (
    <OverlayTrigger
      placement="right"
      overlay={
        <Tooltip id={id}>
          <div className="text-start">{children}</div>
        </Tooltip>
      }
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={label}
        style={{ cursor: 'help', fontSize: '0.85rem' }}
        className="text-muted align-middle"
      >
        ⓘ
      </span>
    </OverlayTrigger>
  )
}
