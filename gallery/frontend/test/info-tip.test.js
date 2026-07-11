// vim: tabstop=2 shiftwidth=2 expandtab
//
// Smoke test for component rendering: proves the harness compiles the app's
// JSX-in-.js components (the panels all lean on this) and pins InfoTip's
// accessibility contract — a focusable, labelled help affordance.

import { test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import InfoTip from '../components/admin/InfoTip'

test('renders a focusable, labelled help symbol', () => {
  render(
    <InfoTip id="t" label="What is this?">
      helper text
    </InfoTip>
  )
  const tip = screen.getByRole('button', { name: 'What is this?' })
  expect(tip).toHaveProperty('tabIndex', 0)
  expect(tip.textContent).toBe('ⓘ')
})
