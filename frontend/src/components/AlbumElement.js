// vim: tabstop=2 shiftwidth=2 expandtab
//

import React, { Component } from 'react';
import API from '../api';
import Gallery from 'react-photo-gallery';

class AlbumElement extends Component {

  state = {
    thumbs: {},
  };

  componentDidMount() {

    API.thumbnails((thumbs) => {
      this.setState({
        thumbs: thumbs,
      })
    }, {
      token: this.props.authtoken,
      album: this.props.album,
      thumb: '40x40',
    });
  }

  photos = () => {
    let imagelist = [];
    let thumbs = Object.keys(this.state.thumbs);
    for (let i = 0; i < thumbs.length; i++) {
      let thumbkey = thumbs[i];
      let thumburl = this.state.thumbs[thumbkey].base64tag;
      if(!thumburl) {
        continue;
      }
      let imageobj = {key: thumbkey, src: thumburl, width: 1, height: 1};
      imagelist.push(imageobj);
    }
    if (!imagelist) {
      return [];
    }
    return(imagelist);
  }

  render() {
    return (
      <div>
        <Gallery columns={30} margin={.5} photos={this.photos()} />
        {/*<Gallery columns={10} photos={this.photos()} />*/}
        {/*<Gallery columns={4} photos={this.photos()} />*/}
      </div>
    );
  }
}

export default AlbumElement;

