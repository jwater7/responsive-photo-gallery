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

      let first = Object.keys(albums)[0];
      if (!first) {
        return;
      }

      API.list((files) => {
        this.setState({
          files: files,
        })
      }, {
        token: this.props.authtoken,
        album: first,
      });

    }, {
      token: this.props.authtoken,
    });

  }

  photos = () => {
    let first = Object.keys(this.state.albums)[0];
    if (!first) {
      return [];
    }
    let imagelist = [];
    let filelist = Object.keys(this.state.files);
    for (let i = 0; i < filelist.length; i++) {
      let filename = filelist[i];
      let imageurl = API.imageurl({
        token: this.props.authtoken,
        album: first,
        image: filename,
      })
      if(!imageurl) {
        continue;
      }
      let thumburl = API.appendThumbnail(imageurl, {
        size: '50x50',
      })
      let imageobj = {src: thumburl, width: 1, height: 1, orig: imageurl};
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
        <h1>List:</h1>
        <Gallery columns={30} margin={.5} photos={this.photos()} onClick={this.handleOnClick} />
        {/*<Gallery columns={10} photos={this.photos()} />*/}
        {/*<Gallery columns={4} photos={this.photos()} />*/}
      </div>
    );
  }
}

export default List;

