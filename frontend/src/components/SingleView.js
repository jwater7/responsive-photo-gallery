// vim: tabstop=2 shiftwidth=2 expandtab
//

import qs from 'query-string';
import React from 'react';
import { Breadcrumb, Row, Col } from 'react-bootstrap';

export const SingleView = (props) => {

  const getURLParams = () => {
    // find the image
    if (!props.location.search) {
      return undefined;
    }

    //const params = new URLSearchParams(props.location.search);
    const params = qs.parse(props.location.search);
    const imageurl = params['imageurl'];
    const thumburl = params['thumburl'];

    return {
      imageurl,
      thumburl,
    };
  }

  let {imageurl, thumburl} = getURLParams();
  return (
      <div>
        <Breadcrumb>
          <Breadcrumb.Item onClick={ e => props.history.push("/albums")}>Albums</Breadcrumb.Item>
          <Breadcrumb.Item onClick={ e => props.history.push("/list/" + props.match.params.album)}>Collections</Breadcrumb.Item>
          <Breadcrumb.Item active>View</Breadcrumb.Item>
        </Breadcrumb>
        <Row>
          <Col xs={12}>
            <video controls={true} autoPlay={true} muted={true} playsInline={false} style={{width: '100%'}} className="video-background" poster={thumburl}>
              <source src={imageurl} type="video/mp4"/>
            </video>
          </Col>
        </Row>
      </div>
    );
}

export default SingleView;

