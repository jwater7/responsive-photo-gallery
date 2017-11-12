import React, { Component } from 'react';
import API from '../api';
import Gallery from 'react-photo-gallery';

class List extends Component {

  state = {
    albums: {},
    files: {},
  };

  componentDidMount() {

    API.albums((albums) => {
      this.setState({
        albums: albums,
      })
    }, {
      token: this.props.authtoken,
    });

    API.list((files) => {
      this.setState({
        files: files,
      })
    }, {
      token: this.props.authtoken,
      album: 'dir',
    });

  }

  photos = () => {
    return([
      {src: 'https://source.unsplash.com/2ShvY8Lf6l0/800x599', width: 4, height: 1},
    ]);
  }

  render() {
    return (
      <div>
        <h1>List:</h1>
        <Gallery photos={this.photos()} />
      </div>
    );
  }
}

export default List;

