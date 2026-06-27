import Link from 'next/link'
import { Breadcrumb } from 'react-bootstrap'

export default function NotFound() {
  return (
    <div>
      <main>
        <Breadcrumb>
          <Breadcrumb.Item linkAs={Link} href="/home">
            Home
          </Breadcrumb.Item>
          <Breadcrumb.Item active>Not found</Breadcrumb.Item>
        </Breadcrumb>
        <h4>404 — Page not found</h4>
        <p>That page doesn’t exist.</p>
        <Link href="/home">Back to your albums</Link>
      </main>
    </div>
  )
}
