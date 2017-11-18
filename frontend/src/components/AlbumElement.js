// vim: tabstop=2 shiftwidth=2 expandtab
//

import React, { Component } from 'react';
import Gallery from 'react-photo-gallery';

class AlbumElement extends Component {

  componentDidMount() {

    if (!(this.props.album in this.props.thumbs)) {
      this.props.addThumbs(this.props.album, this.props.authtoken);
    }

  }

  photos = () => {
    if (!(this.props.album in this.props.thumbs)) {
      return [];
    }
    let imagelist = [];
    let thumbs = Object.keys(this.props.thumbs[this.props.album]);
    for (let i = 0; i < thumbs.length; i++) {
      let thumbkey = thumbs[i];
      let thumburl = this.props.thumbs[this.props.album][thumbkey].base64tag;
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

