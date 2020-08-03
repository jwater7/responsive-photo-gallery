// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import { Breadcrumb, Row, Col, Button } from 'react-bootstrap';
import { getURLParams } from '../utils';

import Edit from './Edit';

const pageNameMap = {
  view: 'View',
  edit: 'Edit',
};

export const SingleView = (props) => {
  const pageName = pageNameMap[props.action]
    ? pageNameMap[props.action]
    : 'UNKNOWN';

  let { imageurl, thumburl, imageIndex, collection, image } = getURLParams(
    props.location.search,
    {
      imageurl: null,
      thumburl: null,
      imageIndex: null,
      collection: null,
      image: null,
    }
  );

  return (
    <div>
      <Row>
        <Col xs={10}>
          <Breadcrumb>
            <Breadcrumb.Item onClick={(e) => props.history.push('/albums')}>
              Albums
            </Breadcrumb.Item>
            <Breadcrumb.Item
              onClick={(e) =>
                props.history.push(
                  '/list/' +
                    props.match.params.album +
                    '?openAtCollection=' +
                    collection +
                    '&startIndex=' +
                    imageIndex
                )
              }
            >
              Collections
            </Breadcrumb.Item>
            <Breadcrumb.Item active>{pageName}</Breadcrumb.Item>
          </Breadcrumb>
        </Col>
        <Col xs={2}>
          <Button
            block
            onClick={(e) =>
              props.history.push(
                '/list/' +
                  props.match.params.album +
                  '?openAtCollection=' +
                  collection +
                  '&startIndex=' +
                  imageIndex
              )
            }
          >
            X
          </Button>
        </Col>
      </Row>
      <Row>
        <Col xs={12}>
          {props.action === 'edit' ? (
            <Edit
              history={props.history}
              album={props.match.params.album}
              image={image}
              imageIndex={imageIndex}
              collection={collection}
            />
          ) : (
            <video
              controls={true}
              autoPlay={true}
              muted={true}
              playsInline={true}
              style={{ width: '100%' }}
              className="video-background"
              poster={thumburl}
            >
              <source src={imageurl} type="video/mp4" />
            </video>
          )}
        </Col>
      </Row>
    </div>
  );
};

export default SingleView;
