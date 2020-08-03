// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';

class ImageList extends React.Component {
  render() {
    const photos = this.props.photos;
    return (
      <div>
        {photos.map((item) => (
          <img
            key={item.key}
            src={item.src}
            height={item.height}
            width={item.width}
            alt={item.key}
            onClick={this.props.onClick}
          />
        ))}
      </div>
    );
  }
}

export default ImageList;
