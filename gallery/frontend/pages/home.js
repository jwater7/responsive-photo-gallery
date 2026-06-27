import Link from 'next/link'
import { Breadcrumb, Container, Row, Col } from 'react-bootstrap';

import { usePing } from "../data/use-ping";
import { useAlbums } from '../data/use-albums';

import { AlbumElement } from "../components/AlbumElement"

export default function Home() {
  const { loggedIn, isLoading: isPingLoading } = usePing({redirect: '/'});
  const { albums, isLoading: isAlbumsLoading } = useAlbums();

  if (isPingLoading) {
    return (<></>)
  }
  if (!loggedIn) {
    return (<>Redirecting...</>);
  }

  return (
    <div>
      <main>
        {/* Container fluid cancels the Bootstrap Row's negative margins, which
            otherwise poke past the body edge and cause a horizontal scroll. */}
        <Container fluid>
          <Breadcrumb>
            <Breadcrumb.Item active>Home</Breadcrumb.Item>
          </Breadcrumb>
          {!albums || isAlbumsLoading ? (<>Loading...</>) : (
            <Row>
              <Col xs={12}>
                {Object.keys(albums).map((album) => (
                  <Link key={album} href={{ pathname: '/album', query: { album } }}>
                    <h5 style={{ overflow: 'hidden' }}>
                      {albums[album].description}
                    </h5>
                    <AlbumElement album={album} />
                  </Link>
                ))}
              </Col>
            </Row>
          )}
        </Container>
      </main>
    </div >
  );
}
