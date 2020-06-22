// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import { Breadcrumb, Row, Col, Button } from 'react-bootstrap';
import { getURLParams } from '../utils';

export const SingleView = (props) => {

  let {imageurl, thumburl, imageIndex, collection} = getURLParams(props.location.search, {imageurl: null, thumburl: null, imageIndex: null, collection: null});
  return (
      <div>
        <Row>
          <Col xs={10}>
            <Breadcrumb>
              <Breadcrumb.Item onClick={ e => props.history.push("/albums")}>Albums</Breadcrumb.Item>
              <Breadcrumb.Item onClick={ e => props.history.push("/list/" + props.match.params.album + "?openAtCollection=" + collection + "&startIndex=" + imageIndex)}>Collections</Breadcrumb.Item>
              <Breadcrumb.Item active>View</Breadcrumb.Item>
            </Breadcrumb>
          </Col>
          <Col xs={2}>
            <Button block onClick={ e => props.history.push("/list/" + props.match.params.album + "?openAtCollection=" + collection + "&startIndex=" + imageIndex)}>X</Button>
          </Col>
        </Row>
        <Row>
          <Col xs={12}>
            <video controls={true} autoPlay={true} muted={true} playsInline={true} style={{width: '100%'}} className="video-background" poster={thumburl}>
              <source src={imageurl} type="video/mp4"/>
            </video>
          </Col>
        </Row>
      </div>
    );
}

export default SingleView;

