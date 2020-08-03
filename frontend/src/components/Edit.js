// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import API from '../api';
import { Row, Col, Button } from 'react-bootstrap';

export const Edit = (props) => {
  return (
    <div>
      <Row>
        <Col xs={12}>
          <Button
            block
            onClick={async (e) => {
              const ret = await API.tag({
                album: props.album,
                image: props.image,
                tags: ['favorite'],
              });
              if (!ret) {
                return;
              }
              return props.history.push(
                '/list/' +
                  props.album +
                  '?openAtCollection=' +
                  props.collection +
                  '&startIndex=' +
                  props.imageIndex
              );
            }}
          >
            Favorite
          </Button>
        </Col>
      </Row>
      <Row>
        <Col xs={12}>
          <Button
            block
            onClick={async (e) => {
              const ret = await API.tag({
                album: props.album,
                image: props.image,
                tags: [],
              });
              if (!ret) {
                return;
              }
              return props.history.push(
                '/list/' +
                  props.album +
                  '?openAtCollection=' +
                  props.collection +
                  '&startIndex=' +
                  props.imageIndex
              );
            }}
          >
            Clear Favorite
          </Button>
        </Col>
      </Row>
    </div>
  );
};

export default Edit;
