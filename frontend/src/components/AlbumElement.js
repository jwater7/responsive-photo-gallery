// vim: tabstop=2 shiftwidth=2 expandtab
//

import React, { Component } from 'react';
//import Gallery from 'react-photo-gallery';
import ImageList from './ImageList';

class AlbumElement extends Component {

  thumbDim = '40x40';

  componentDidMount() {

    if (!(this.props.album in this.props.thumbs) || !(this.thumbDim in this.props.thumbs[this.props.album])) {
      this.props.addThumbs(this.props.album, this.thumbDim, this.props.authtoken);
    }

  }

  photos = () => {

    const [width, height] = this.thumbDim.split('x');
    if (!(this.props.album in this.props.thumbs) || !(this.thumbDim in this.props.thumbs[this.props.album])) {
      return [];
    }
    let imagelist = [];
    let thumbs = Object.keys(this.props.thumbs[this.props.album][this.thumbDim]);
    for (let i = 0; i < thumbs.length; i++) {
      let thumbkey = thumbs[i];
      let thumburl = this.props.thumbs[this.props.album][this.thumbDim][thumbkey].base64tag;
      if(!thumburl) {
        continue;
      }
      let imageobj = {key: thumbkey, src: thumburl, width, height};
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
        <ImageList photos={this.photos()} />
        {/*<Gallery columns={30} margin={.5} photos={this.photos()} />*/}
      </div>
    );
  }
}

export default AlbumElement;

