// vim: tabstop=2 shiftwidth=2 expandtab
//

import React, { Component } from 'react';
import API from '../api';
import Gallery from 'react-photo-gallery';

class List extends Component {

  componentDidMount() {

    if (!(this.props.match.params.album in this.props.list)) {
      this.props.loadList(this.props.match.params.album, this.props.authtoken);
    }

    if (!(this.props.match.params.album in this.props.thumbs)) {
      this.props.addThumbs(this.props.match.params.album, this.props.authtoken);
    }
  }

  photos = () => {
    if (!this.props.match.params.album) {
      return [];
    }
    if (!(this.props.match.params.album in this.props.thumbs) || !(this.props.match.params.album in this.props.list)) {
      return [];
    }
    let imagelist = [];
    let filelist = Object.keys(this.props.list[this.props.match.params.album]);
    for (let i = 0; i < filelist.length; i++) {
      let filename = filelist[i];
      let imageurl = API.imageurl({
        token: this.props.authtoken,
        album: this.props.match.params.album,
        image: filename,
      })
      if(!imageurl) {
        continue;
      }
      if (!(filename in this.props.thumbs[this.props.match.params.album])) {
        continue;
      }
      let thumburl = this.props.thumbs[this.props.match.params.album][filename].base64tag;
      let imageobj = {key: filename, src: thumburl, width: 1, height: 1, orig: imageurl};
      //let imageobj = {src: thumburl, width: this.state.files[filename].width, height: this.state.files[filename].height};
      imagelist.push(imageobj);
    }
    if (!imagelist) {
      return [];
    }
    return(imagelist);
  }

  handleOnClick = (e, obj) => {
    //console.log(e.target);
    //console.log(obj);
    window.open(obj.photo.orig);
  }

  render() {
    return (
      <div>
        <h1>List for {this.props.match.params.album}:</h1>
        <Gallery columns={30} margin={.5} photos={this.photos()} onClick={this.handleOnClick} />
        {/*<Gallery columns={10} photos={this.photos()} />*/}
        {/*<Gallery columns={4} photos={this.photos()} />*/}
      </div>
    );
  }
}

export default List;

