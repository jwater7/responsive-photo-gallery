// vim: tabstop=2 shiftwidth=2 expandtab
//

import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import AlbumElementContainer from './AlbumElementContainer';

class Albums extends Component {

  componentDidMount() {

    this.props.loadAlbums(this.props.authtoken);

  }

  render() {
    return (
      <div>
        <h1>Albums:</h1>
        {Object.keys(this.props.albums).map((album) => (
          <Link key={album} to={`/list/${album}`}>
            <h2>{this.props.albums[album].description}</h2>
            <AlbumElementContainer album={album} {...this.props} />
          </Link>
        ))}
      </div>
    );
  }
}

export default Albums;

