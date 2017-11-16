// vim: tabstop=2 shiftwidth=2 expandtab
//

import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import API from '../api';
import AlbumElement from './AlbumElement';

class Albums extends Component {

  state = {
    albums: {},
  };

  componentDidMount() {

    API.albums((albums) => {
      this.setState({
        albums: albums,
      })
    }, {
      token: this.props.authtoken,
    });

  }

  render() {
    return (
      <div>
        <h1>Albums:</h1>
        {Object.keys(this.state.albums).map((album) => (
          <Link key={album} to={`/list/${album}`}>
            <h2>{this.state.albums[album].description}</h2>
            <AlbumElement album={album} {...this.props} />
          </Link>
        ))}
      </div>
    );
  }
}

export default Albums;

