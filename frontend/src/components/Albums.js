// vim: tabstop=2 shiftwidth=2 expandtab
//

import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { Breadcrumb, Row, Col } from 'react-bootstrap';
import AlbumElementContainer from './AlbumElementContainer';

class Albums extends Component {

  componentDidMount() {

    if (Object.keys(this.props.albums).length === 0) {
      this.props.loadAlbums(this.props.authtoken);
    }

  }

  render() {
    return (
      <div>
        <Breadcrumb>
          <Breadcrumb.Item active>Albums</Breadcrumb.Item>
        </Breadcrumb>
        <Row>
          <Col xs={12}>
            {Object.keys(this.props.albums).map((album) => (
              <Link key={album} to={`/list/${album}`}>
                <h5 style={{overflow: 'hidden',}}>{this.props.albums[album].description}</h5>
                <AlbumElementContainer album={album} {...this.props} />
              </Link>
            ))}
          </Col>
        </Row>
      </div>
    );
  }
}

export default Albums;

